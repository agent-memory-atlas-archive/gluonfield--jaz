package bots

import (
	"context"
	"errors"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/wins/jaz/backend/internal/sessionevents"
	"github.com/wins/jaz/backend/internal/storage"
)

const (
	maxRounds  = 2
	maxReplies = 6
	maxHistory = 20
)

var mentionPattern = regexp.MustCompile(`\]\(bot:([A-Za-z0-9_-]+)\)`)

// Post adds the user's message to a group; its members then take turns.
func (s *Service) Post(groupID, text string) error {
	text = strings.TrimSpace(text)
	if text == "" {
		return errors.New("message is required")
	}
	record, session, err := s.load(groupID)
	if err != nil {
		return err
	}
	if record.Kind != KindGroup {
		return errors.New("not a group")
	}
	return s.post(record, session.Title, sessionevents.RoomMessageEvent{Speaker: "user", Name: "You", Text: text}, mentions(text))
}

// post records a message and starts a new round, superseding any round still
// running for the group. Members named in the message answer; otherwise all
// members except the speaker may.
func (s *Service) post(group storage.BotRecord, name string, message sessionevents.RoomMessageEvent, mentioned []string) error {
	s.appendEvent(sessionevents.Event{SessionID: group.ThreadID, Type: sessionevents.TypeRoomMessage, RoomMessage: &message, At: time.Now().UTC()})
	responders := make([]string, 0, len(group.Members))
	for _, member := range group.Members {
		if member == message.BotID || len(mentioned) > 0 && !slices.Contains(mentioned, member) {
			continue
		}
		responders = append(responders, member)
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.mu.Lock()
	if s.rounds == nil {
		s.rounds = make(map[string]context.CancelFunc)
	}
	if previous := s.rounds[group.ThreadID]; previous != nil {
		previous()
	}
	s.rounds[group.ThreadID] = cancel
	s.mu.Unlock()
	go s.runRound(ctx, group.ThreadID, name, responders)
	return nil
}

// runRound gives every responder a turn at once, so one slow member holds up
// nobody, then a follow-up round to react to each other, stopping when a round
// passes in silence or the reply cap is reached.
func (s *Service) runRound(ctx context.Context, groupID, name string, responders []string) {
	replies := 0
	for range maxRounds {
		var mu sync.Mutex
		spoke := 0
		var wg sync.WaitGroup
		for _, member := range responders {
			wg.Go(func() {
				said, err := s.memberTurn(ctx, groupID, name, member)
				if err != nil && ctx.Err() == nil {
					s.Log.Warn("group turn failed", "group", groupID, "member", member, "error", err)
				}
				mu.Lock()
				spoke += len(said)
				mu.Unlock()
			})
		}
		wg.Wait()
		replies += spoke
		if ctx.Err() != nil || spoke == 0 || replies >= maxReplies {
			return
		}
	}
}

// memberTurn gives member a turn in the group and returns what it posted.
func (s *Service) memberTurn(ctx context.Context, groupID, name, member string) ([]string, error) {
	record, err := s.Store.LoadBot(groupID)
	if err != nil {
		return nil, err
	}
	events, err := s.Store.LoadSessionEvents(groupID)
	if err != nil {
		return nil, err
	}
	peers := make([]string, 0, len(record.Members))
	for _, other := range record.Members {
		if other != member {
			peers = append(peers, s.name(other))
		}
	}
	prompt := groupTurnPrompt(name, s.name(member), peers, unseen(events, member))
	return s.ask(ctx, member, groupID, prompt, sessionevents.BotActivityEvent{Kind: "group", Label: name, BotID: groupID})
}

// unseen returns the group messages posted since member last spoke.
func unseen(events []sessionevents.Event, member string) []sessionevents.RoomMessageEvent {
	var messages []sessionevents.RoomMessageEvent
	for _, event := range events {
		message := event.RoomMessage
		if message == nil {
			continue
		}
		if message.BotID == member {
			messages = messages[:0]
			continue
		}
		messages = append(messages, *message)
	}
	if len(messages) > maxHistory {
		messages = messages[len(messages)-maxHistory:]
	}
	return messages
}

func mentions(text string) []string {
	var ids []string
	for _, match := range mentionPattern.FindAllStringSubmatch(text, -1) {
		ids = append(ids, match[1])
	}
	return ids
}
