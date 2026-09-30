package bots

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/wins/jaz/backend/internal/sessionevents"
	"github.com/wins/jaz/backend/internal/storage"
)

const (
	// maxFollowUps bounds the turns bots wake in each other between two posts
	// from the user, so a mention ping-pong cannot run on.
	maxFollowUps = 6
	maxHistory   = 20
)

var mentionPattern = regexp.MustCompile(`\]\(bot:([A-Za-z0-9_-]+)\)`)

// Post adds the user's message to a group.
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
	return s.post(record, session.Title, sessionevents.RoomMessageEvent{Speaker: "user", Name: "You", Text: text})
}

// post records a message in a group and wakes the members it mentions, each in
// a turn of its own, all at once. A message that mentions nobody wakes every
// member when the user or an outsider wrote it, and nobody when a member did:
// bots follow up on each other only when addressed.
func (s *Service) post(group storage.BotRecord, name string, message sessionevents.RoomMessageEvent) error {
	s.appendEvent(sessionevents.Event{SessionID: group.ThreadID, Type: sessionevents.TypeRoomMessage, RoomMessage: &message, At: time.Now().UTC()})
	fromMember := slices.Contains(group.Members, message.BotID)
	wake := group.Members
	if mentioned := mentions(message.Text); len(mentioned) > 0 {
		wake = mentioned
	} else if fromMember {
		wake = nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.followUps == nil {
		s.followUps = make(map[string]int)
	}
	if !fromMember {
		s.followUps[group.ThreadID] = 0
	}
	for _, member := range wake {
		if member == message.BotID || !slices.Contains(group.Members, member) {
			continue
		}
		if fromMember {
			if s.followUps[group.ThreadID] >= maxFollowUps {
				break
			}
			s.followUps[group.ThreadID]++
		}
		go func() {
			if err := s.memberTurn(group.ThreadID, name, member); err != nil {
				s.Log.Warn("group turn failed", "group", group.ThreadID, "member", member, "error", err)
			}
		}()
	}
	return nil
}

// memberTurn gives member a turn in the group, in which it posts with
// send_message.
func (s *Service) memberTurn(groupID, name, member string) error {
	record, err := s.Store.LoadBot(groupID)
	if err != nil {
		return err
	}
	events, err := s.Store.LoadSessionEvents(groupID)
	if err != nil {
		return err
	}
	peers := make([]string, 0, len(record.Members))
	for _, other := range record.Members {
		if other != member {
			peers = append(peers, fmt.Sprintf("[@%s](bot:%s)", s.name(other), other))
		}
	}
	prompt := groupTurnPrompt(name, s.name(member), peers, unseen(events, member))
	_, err = s.ask(context.Background(), member, groupID, prompt, sessionevents.BotActivityEvent{Kind: "group", Label: name, BotID: groupID})
	return err
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
