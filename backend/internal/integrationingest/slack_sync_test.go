package integrationingest

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	slackconnector "github.com/wins/jaz/backend/internal/connectors/slack"
	"github.com/wins/jaz/backend/pkg/integrations"
	integrationoauth "github.com/wins/jaz/backend/pkg/integrations/oauth"
)

type capturedRecords struct {
	records []integrations.Record
}

func (c *capturedRecords) WriteRecords(_ context.Context, records []integrations.Record) error {
	c.records = append(c.records, records...)
	return nil
}

func TestSlackSyncerSkipsHistoryAndMarksOwnMessages(t *testing.T) {
	var matches string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/search.messages" || r.Header.Get("Authorization") != "Bearer access" {
			t.Fatalf("request = %s %q", r.URL.Path, r.Header.Get("Authorization"))
		}
		_, _ = fmt.Fprintf(w, `{"ok":true,"messages":{"matches":[%s]}}`, matches)
	}))
	defer server.Close()
	message := func(user, text string, at time.Time) string {
		return fmt.Sprintf(`{"channel":{"id":"C1","name":"eng"},"user":%q,"username":%q,"text":%q,"ts":"%d.000100"}`, user, user, text, at.Unix())
	}
	writer := &capturedRecords{}
	syncer := &SlackSyncer{
		Store: &fakeGmailSyncStore{
			connections: []integrations.Connection{{ID: "slack:acme", Provider: slackconnector.ProviderID, AccountID: "T1-U1"}},
			token:       integrationoauth.Token{AccessToken: "access", TokenType: "Bearer", Expiry: time.Now().Add(time.Hour)},
		},
		Writer:     writer,
		APIBaseURL: server.URL,
	}

	matches = message("U2", "old news", time.Now().Add(-time.Hour))
	if err := syncer.SyncOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(writer.records) != 0 {
		t.Fatalf("history was observed: %+v", writer.records)
	}
	later := time.Now().Add(2 * time.Second)
	matches = strings.Join([]string{message("U2", "deploy is red", later), message("U1", "on it", later)}, ",")
	if err := syncer.SyncOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(writer.records) != 2 {
		t.Fatalf("new messages = %+v", writer.records)
	}
	if strings.Contains(string(writer.records[0].Raw), `"from_me"`) || !strings.Contains(string(writer.records[1].Raw), `"from_me":true`) {
		t.Fatalf("own message not marked: %s / %s", writer.records[0].Raw, writer.records[1].Raw)
	}
	if err := syncer.SyncOnce(context.Background()); err != nil || len(writer.records) != 2 {
		t.Fatalf("messages observed twice: %d, %v", len(writer.records), err)
	}
}
