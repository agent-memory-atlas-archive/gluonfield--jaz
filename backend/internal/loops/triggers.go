package loops

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/wins/jaz/backend/pkg/integrations"
)

// triggerWindow bounds how old an observed message may be and still fire a
// trigger, so history backfills and resyncs stay quiet.
const triggerWindow = 15 * time.Minute

// observed is one incoming message, reduced to what triggers match on.
type observed struct {
	Kind    string
	ID      string
	From    string
	Subject string
	Text    string
	At      time.Time
}

// HandleRecords fires every active routine whose trigger matches a newly
// observed message. The user's own messages never fire a trigger.
func (s *Service) HandleRecords(ctx context.Context, records []integrations.Record) {
	now := s.now()
	var recent []observed
	for _, record := range records {
		if incoming, ok := incomingFrom(record); ok && now.Sub(incoming.At) <= triggerWindow {
			recent = append(recent, incoming)
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
	for _, incoming := range recent {
		for _, routine := range routines {
			if routine.Status != StatusActive || !routine.Trigger.matches(incoming) || incoming.At.Before(routine.CreatedAt) || !s.firstSighting(routine.ID, incoming.ID) {
				continue
			}
			if _, err := s.RunTriggered(ctx, routine.ID, incoming.describe()); err != nil {
				s.Log.Info("trigger did not start a run", "routine", routine.ID, "error", err)
			}
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

func (t *Trigger) matches(in observed) bool {
	return t != nil &&
		t.Kind == in.Kind &&
		containsFold(in.From, t.From) &&
		containsFold(in.Subject, t.Subject) &&
		containsFold(in.Subject+"\n"+in.Text, t.Contains)
}

func (in observed) describe() string {
	parts := []string{fmt.Sprintf("new %s message from %s", in.Kind, in.From)}
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

func incomingFrom(record integrations.Record) (observed, bool) {
	in := observed{ID: record.Provider + ":" + record.ExternalID, At: record.OccurredAt}
	switch record.Kind {
	case "gmail.message":
		var content struct {
			Message  gmailMessage `json:"message"`
			BodyText string       `json:"body_text"`
		}
		if json.Unmarshal(record.Raw, &content) != nil {
			return observed{}, false
		}
		message := content.Message
		if message.ID == "" && json.Unmarshal(record.Raw, &message) != nil {
			return observed{}, false
		}
		for _, label := range message.LabelIDs {
			if label == "SENT" {
				return observed{}, false
			}
		}
		in.Kind = TriggerGmail
		if len(message.From) > 0 {
			in.From = strings.TrimSpace(message.From[0].Name + " <" + message.From[0].Email + ">")
		}
		in.Subject = message.Subject
		in.Text = firstNonEmpty(content.BodyText, message.Snippet)
	case "whatsapp.message":
		var message struct {
			Sender   string `json:"sender"`
			PushName string `json:"push_name"`
			FromMe   bool   `json:"from_me"`
			Text     string `json:"text"`
		}
		if json.Unmarshal(record.Raw, &message) != nil || message.FromMe {
			return observed{}, false
		}
		in.Kind = TriggerWhatsApp
		in.From = strings.TrimSpace(message.PushName + " " + message.Sender)
		in.Text = message.Text
	case "telegram.message":
		var message struct {
			Out     bool   `json:"out"`
			Message string `json:"message"`
			FromID  any    `json:"from_id"`
		}
		if json.Unmarshal(record.Raw, &message) != nil || message.Out {
			return observed{}, false
		}
		in.Kind = TriggerTelegram
		in.From = fmt.Sprint(message.FromID)
		in.Text = message.Message
	case "slack.message":
		var message struct {
			Channel struct {
				Name string `json:"name"`
			} `json:"channel"`
			Username string `json:"username"`
			User     string `json:"user"`
			Text     string `json:"text"`
			FromMe   bool   `json:"from_me"`
		}
		if json.Unmarshal(record.Raw, &message) != nil || message.FromMe {
			return observed{}, false
		}
		in.Kind = TriggerSlack
		in.From = firstNonEmpty(message.Username, message.User)
		in.Subject = "#" + message.Channel.Name
		in.Text = message.Text
	default:
		return observed{}, false
	}
	return in, true
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

type gmailMessage struct {
	ID       string   `json:"id"`
	Subject  string   `json:"subject"`
	Snippet  string   `json:"snippet"`
	LabelIDs []string `json:"label_ids"`
	From     []struct {
		Name  string `json:"name"`
		Email string `json:"email"`
	} `json:"from"`
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
