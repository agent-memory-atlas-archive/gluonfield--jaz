package loops

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/wins/jaz/backend/internal/integrationingest"
)

// triggerWindow bounds how old an observed message may be and still fire a
// trigger, so history backfills and resyncs stay quiet.
const triggerWindow = 15 * time.Minute

// HandleIncoming fires every active routine whose trigger matches messages
// observed within the trigger window, once per batch with all its matches.
func (s *Service) HandleIncoming(ctx context.Context, messages []integrationingest.Incoming) {
	now := s.now()
	var recent []integrationingest.Incoming
	for _, message := range messages {
		if now.Sub(message.At) <= triggerWindow {
			recent = append(recent, message)
		}
	}
	if len(recent) == 0 {
		return
	}
	routines, err := s.Repo.ListLoops()
	if err != nil {
		s.Log.Warn("list routines for trigger failed", "error", err)
		return
	}
	for _, routine := range routines {
		var events []string
		for _, message := range recent {
			if routine.Status == StatusActive && routine.Trigger.matches(message) && !message.At.Before(routine.CreatedAt) && s.firstSighting(routine.ID, message.ID) {
				events = append(events, describe(message))
			}
		}
		if len(events) == 0 {
			continue
		}
		if _, err := s.RunTriggered(ctx, routine.ID, strings.Join(events, "\n\n")); err != nil {
			s.Log.Warn("trigger did not start a run", "routine", routine.ID, "error", err)
		}
	}
}

// firstSighting reports whether this routine has not yet fired for message id.
func (s *Service) firstSighting(routineID, id string) bool {
	key := routineID + "\x00" + id
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fired == nil || len(s.fired) > 10000 {
		s.fired = make(map[string]struct{})
	}
	if _, seen := s.fired[key]; seen {
		return false
	}
	s.fired[key] = struct{}{}
	return true
}

func (t *Trigger) matches(in integrationingest.Incoming) bool {
	return t != nil &&
		t.Kind == in.Provider &&
		containsFold(in.From, t.From) &&
		containsFold(in.Subject, t.Subject) &&
		containsFold(in.Subject+"\n"+in.Text, t.Contains)
}

func describe(in integrationingest.Incoming) string {
	parts := []string{fmt.Sprintf("new %s message from %s", in.Provider, in.From)}
	if in.Subject != "" {
		parts = append(parts, "subject: "+in.Subject)
	}
	if text := strings.TrimSpace(in.Text); text != "" {
		if runes := []rune(text); len(runes) > 2000 {
			text = string(runes[:2000]) + "…"
		}
		parts = append(parts, text)
	}
	return strings.Join(parts, "\n")
}

func containsFold(value, filter string) bool {
	return filter == "" || strings.Contains(strings.ToLower(value), strings.ToLower(filter))
}

// Watching reports whether an active routine listens for kind.
func (s *Service) Watching(kind string) bool {
	routines, err := s.Repo.ListLoops()
	if err != nil {
		return false
	}
	return slices.ContainsFunc(routines, func(routine Loop) bool {
		return routine.Status == StatusActive && routine.Trigger != nil && routine.Trigger.Kind == kind
	})
}
