package integrationingest

import (
	"encoding/json"
	"slices"
	"strings"
	"time"

	gmailconnector "github.com/wins/jaz/backend/internal/connectors/gmail"
	slackconnector "github.com/wins/jaz/backend/internal/connectors/slack"
	whatsappconnector "github.com/wins/jaz/backend/internal/connectors/whatsapp"
	"github.com/wins/jaz/backend/pkg/integrations"
)

// Incoming is a message someone else sent the user, reduced to what routines
// match on. Subject is the email subject or the Slack "#channel".
type Incoming struct {
	Provider string
	ID       string
	From     string
	Subject  string
	Text     string
	At       time.Time
}

func incoming(records []integrations.Record) []Incoming {
	var messages []Incoming
	for _, record := range records {
		if message, ok := incomingMessage(record); ok {
			messages = append(messages, message)
		}
	}
	return messages
}

func incomingMessage(record integrations.Record) (Incoming, bool) {
	in := Incoming{Provider: record.Provider, ID: record.Provider + ":" + record.ExternalID, At: record.OccurredAt}
	switch record.Kind {
	case gmailconnector.RecordKindMessage:
		var content gmailconnector.MessageContent
		if json.Unmarshal(record.Raw, &content) != nil {
			return Incoming{}, false
		}
		if content.Message.ID == "" && json.Unmarshal(record.Raw, &content.Message) != nil {
			return Incoming{}, false
		}
		message := content.Message
		if slices.Contains(message.LabelIDs, "SENT") {
			return Incoming{}, false
		}
		if len(message.From) > 0 {
			in.From = strings.TrimSpace(message.From[0].Name + " <" + message.From[0].Email + ">")
		}
		in.Subject = message.Subject
		in.Text = firstNonEmpty(content.BodyText, message.Snippet)
	case "whatsapp.message":
		var message whatsappconnector.MessageRecord
		if json.Unmarshal(record.Raw, &message) != nil || message.FromMe {
			return Incoming{}, false
		}
		in.From = strings.TrimSpace(message.PushName + " " + message.Sender)
		in.Text = message.Text
	case "telegram.message":
		var message struct {
			Out     bool   `json:"out"`
			Message string `json:"message"`
			FromID  string `json:"from_id"`
		}
		if json.Unmarshal(record.Raw, &message) != nil || message.Out {
			return Incoming{}, false
		}
		in.From = message.FromID
		in.Text = message.Message
	case slackconnector.RecordKindMessage:
		var message slackconnector.Message
		if json.Unmarshal(record.Raw, &message) != nil || message.FromMe {
			return Incoming{}, false
		}
		in.From = firstNonEmpty(message.Username, message.User)
		in.Subject = "#" + message.Channel.Name
		in.Text = message.Text
	default:
		return Incoming{}, false
	}
	return in, true
}
