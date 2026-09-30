package bots

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/wins/jaz/backend/internal/acp"
	"github.com/wins/jaz/backend/internal/sessionevents"
)

const turnTimeout = 30 * time.Minute

// voice is where a bot's messages go during a turn this service started for
// it: into group, or, with no group, back to the bot that wrote to it once the
// turn ends. Outside such a turn a bot talks in its own chat.
type voice struct {
	group string
	said  []string
}

// Message sends text from a thread to a bot or a group. A bot answers in a
// turn of its own and the answer returns to the sender as a new turn; a group
// gets the text as a post and its members take their turns.
func (s *Service) Message(fromThread, to, text string) error {
	text = strings.TrimSpace(text)
	if text == "" {
		return errors.New("message is required")
	}
	target, session, err := s.load(to)
	if err != nil {
		return err
	}
	sender := s.name(fromThread)
	if target.Kind == KindGroup {
		speaker := sessionevents.RoomMessageEvent{Speaker: "bot", BotID: fromThread, Name: sender, Text: text}
		return s.post(target, session.Title, speaker, mentions(text))
	}
	if to == fromThread {
		return errors.New("a bot cannot message itself")
	}
	s.announce(fromThread, sessionevents.BotActivityEvent{Kind: "message_sent", Label: session.Title, BotID: to})
	go s.deliver(fromThread, sender, to, session.Title, text)
	return nil
}

// Say posts a bot's message: into the group whose turn it is taking, to the
// bot it is answering, or else into its own chat.
func (s *Service) Say(threadID, text string) error {
	text = strings.TrimSpace(text)
	if text == "" {
		return errors.New("message is required")
	}
	record, session, err := s.load(threadID)
	if err != nil || record.Kind != KindBot {
		return errors.New("only a Jaz bot can send messages")
	}
	s.mu.Lock()
	turn := s.voices[threadID]
	if turn != nil {
		turn.said = append(turn.said, text)
	}
	s.mu.Unlock()
	room := threadID
	if turn != nil {
		if turn.group == "" {
			return nil
		}
		room = turn.group
	}
	message := sessionevents.RoomMessageEvent{Speaker: "bot", BotID: threadID, Name: session.Title, Text: text}
	s.appendEvent(sessionevents.Event{SessionID: room, Type: sessionevents.TypeRoomMessage, RoomMessage: &message, At: time.Now().UTC()})
	return nil
}

func (s *Service) deliver(fromThread, sender, to, recipient, text string) {
	ctx, cancel := context.WithTimeout(context.Background(), turnTimeout)
	defer cancel()
	said, err := s.ask(ctx, to, "", messagePrompt(sender, text), sessionevents.BotActivityEvent{Kind: "message_received", Label: sender, BotID: fromThread})
	if err != nil {
		s.Log.Warn("bot message failed", "from", fromThread, "to", to, "error", err)
		return
	}
	if fromThread == "" || len(said) == 0 {
		return
	}
	if _, err := s.Threads.StartInternalTurnWhenIdle(ctx, acp.InternalTurnRequest{Session: fromThread, Message: replyPrompt(recipient, strings.Join(said, "\n\n")), AllowSilence: true}); err != nil {
		s.Log.Warn("bot reply delivery failed", "from", to, "to", fromThread, "error", err)
		return
	}
	s.announce(fromThread, sessionevents.BotActivityEvent{Kind: "message_received", Label: recipient, BotID: to})
}

// ask runs one hidden turn in a bot's thread once it is free and returns what
// the bot said in it. The turn keeps its voice until it ends, even when ctx is
// cancelled first.
func (s *Service) ask(ctx context.Context, threadID, group, prompt string, activity sessionevents.BotActivityEvent) ([]string, error) {
	job, err := s.Threads.StartInternalTurnWhenIdle(ctx, acp.InternalTurnRequest{Session: threadID, Message: prompt, AllowSilence: true})
	if err != nil {
		return nil, err
	}
	turn := &voice{group: group}
	s.mu.Lock()
	if s.voices == nil {
		s.voices = make(map[string]*voice)
	}
	s.voices[threadID] = turn
	s.mu.Unlock()
	defer s.endTurn(threadID, turn)
	s.announce(threadID, activity)
	done, err := s.Threads.Wait(context.WithoutCancel(ctx), acp.WaitRequest{Session: job.ID, Timeout: turnTimeout})
	if err != nil {
		return nil, err
	}
	switch done.State {
	case acp.StateStarting, acp.StateRunning:
		return nil, fmt.Errorf("%s is still working", threadID)
	case acp.StateFailed:
		return nil, fmt.Errorf("%s failed: %s", threadID, done.Error)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(turn.said), nil
}

func (s *Service) endTurn(threadID string, turn *voice) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.voices[threadID] == turn {
		delete(s.voices, threadID)
	}
}

func (s *Service) announce(threadID string, activity sessionevents.BotActivityEvent) {
	if threadID == "" {
		return
	}
	s.appendEvent(sessionevents.Event{SessionID: threadID, Type: sessionevents.TypeBotActivity, BotActivity: &activity, At: time.Now().UTC()})
}

// appendEvent stores event and streams the stored copy, whose seq lets
// clients match it to the same event in history.
func (s *Service) appendEvent(event sessionevents.Event) {
	events := []sessionevents.Event{event}
	if err := s.Store.AppendSessionEvents(event.SessionID, events...); err != nil {
		s.Log.Warn("append bot event failed", "thread", event.SessionID, "type", event.Type, "error", err)
		return
	}
	s.Events.Publish(events[0])
}

// name is how a thread signs its messages: a bot by its name, any other
// thread as Jaz.
func (s *Service) name(threadID string) string {
	if _, session, err := s.load(threadID); err == nil {
		return session.Title
	}
	return "Jaz"
}
