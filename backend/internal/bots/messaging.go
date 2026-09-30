package bots

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/wins/jaz/backend/internal/acp"
	"github.com/wins/jaz/backend/internal/sessionevents"
)

const turnTimeout = 30 * time.Minute

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

func (s *Service) deliver(fromThread, sender, to, recipient, text string) {
	ctx, cancel := context.WithTimeout(context.Background(), turnTimeout)
	defer cancel()
	reply, err := s.ask(ctx, to, messagePrompt(sender, text), sessionevents.BotActivityEvent{Kind: "message_received", Label: sender, BotID: fromThread})
	if err != nil {
		s.Log.Warn("bot message failed", "from", fromThread, "to", to, "error", err)
		return
	}
	if fromThread == "" || reply == "" {
		return
	}
	if _, err := s.Threads.StartInternalTurnWhenIdle(ctx, acp.InternalTurnRequest{Session: fromThread, Message: replyPrompt(recipient, reply)}); err != nil {
		s.Log.Warn("bot reply delivery failed", "from", to, "to", fromThread, "error", err)
		return
	}
	s.announce(fromThread, sessionevents.BotActivityEvent{Kind: "message_received", Label: recipient, BotID: to})
}

// ask runs one hidden turn in a bot's thread once it is free and returns the
// turn's reply.
func (s *Service) ask(ctx context.Context, threadID, prompt string, activity sessionevents.BotActivityEvent) (string, error) {
	job, err := s.Threads.StartInternalTurnWhenIdle(ctx, acp.InternalTurnRequest{Session: threadID, Message: prompt})
	if err != nil {
		return "", err
	}
	s.announce(threadID, activity)
	done, err := s.Threads.Wait(ctx, acp.WaitRequest{Session: job.ID, Timeout: turnTimeout})
	if err != nil {
		return "", err
	}
	switch done.State {
	case acp.StateStarting, acp.StateRunning:
		return "", fmt.Errorf("%s is still working", threadID)
	case acp.StateFailed:
		return "", fmt.Errorf("%s failed: %s", threadID, done.Error)
	}
	return strings.TrimSpace(done.Assistant), nil
}

func (s *Service) announce(threadID string, activity sessionevents.BotActivityEvent) {
	if threadID == "" {
		return
	}
	s.appendEvent(sessionevents.Event{SessionID: threadID, Type: sessionevents.TypeBotActivity, BotActivity: &activity, At: time.Now().UTC()})
}

func (s *Service) appendEvent(event sessionevents.Event) {
	if err := s.Store.AppendSessionEvents(event.SessionID, event); err != nil {
		s.Log.Warn("append bot event failed", "thread", event.SessionID, "type", event.Type, "error", err)
		return
	}
	s.Events.Publish(event)
}

// name is how a thread signs its messages: a bot by its name, any other
// thread as Jaz.
func (s *Service) name(threadID string) string {
	if _, session, err := s.load(threadID); err == nil {
		return session.Title
	}
	return "Jaz"
}
