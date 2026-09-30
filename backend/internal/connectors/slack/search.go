package slack

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/wins/jaz/backend/pkg/integrations"
)

const (
	APIBaseURL                                = "https://slack.com/api"
	RecordKindMessage integrations.RecordKind = "slack.message"
)

// Message is a Slack message as search returns it.
type Message struct {
	Channel struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"channel"`
	User     string `json:"user"`
	Username string `json:"username"`
	Text     string `json:"text"`
	TS       string `json:"ts"`
	FromMe   bool   `json:"from_me,omitempty"`
}

// RecentMessages returns messages the user can see that were posted from the
// day before since onward, newest first.
func RecentMessages(ctx context.Context, client *http.Client, baseURL string, since time.Time) ([]Message, error) {
	query := url.Values{
		"query":    {"after:" + since.AddDate(0, 0, -1).Format("2006-01-02")},
		"sort":     {"timestamp"},
		"sort_dir": {"desc"},
		"count":    {"100"},
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSuffix(baseURL, "/")+"/search.messages?"+query.Encode(), nil)
	if err != nil {
		return nil, err
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	var body struct {
		OK       bool   `json:"ok"`
		Error    string `json:"error"`
		Messages struct {
			Matches []Message `json:"matches"`
		} `json:"messages"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		return nil, err
	}
	if !body.OK {
		return nil, fmt.Errorf("slack search: %s", body.Error)
	}
	return body.Messages.Matches, nil
}

// PostedAt is when message was posted.
func (m Message) PostedAt() time.Time {
	seconds, err := strconv.ParseFloat(m.TS, 64)
	if err != nil {
		return time.Time{}
	}
	return time.UnixMilli(int64(seconds * 1000)).UTC()
}

// MessageRecord observes message for connection, marking the user's own
// messages; a connection's account is "<team>-<user>".
func MessageRecord(connection integrations.Connection, message Message) integrations.Record {
	_, self, _ := strings.Cut(connection.AccountID, "-")
	message.FromMe = self != "" && message.User == self
	raw, _ := json.Marshal(message)
	return integrations.Record{
		Provider:     ProviderID,
		ConnectionID: connection.ID,
		AccountID:    connection.AccountID,
		Kind:         RecordKindMessage,
		ExternalID:   message.Channel.ID + ":" + message.TS,
		OccurredAt:   message.PostedAt(),
		Raw:          raw,
	}
}
