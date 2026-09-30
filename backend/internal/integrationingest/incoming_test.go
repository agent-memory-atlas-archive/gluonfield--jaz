package integrationingest

import (
	"testing"
	"time"

	"github.com/wins/jaz/backend/pkg/integrations"
)

func TestIncomingSkipsTheUsersOwnMessages(t *testing.T) {
	record := func(provider, kind, raw string) integrations.Record {
		return integrations.Record{Provider: provider, Kind: integrations.RecordKind(kind), ExternalID: "m1", OccurredAt: time.Now(), Raw: []byte(raw)}
	}
	got := incoming([]integrations.Record{
		record("gmail", "gmail.message", `{"message":{"id":"m1","subject":"New quote","from":[{"name":"Ujjwal","email":"u@cas.com"}]},"body_text":"Numbers attached"}`),
		record("gmail", "gmail.message", `{"message":{"id":"m2","label_ids":["SENT"],"from":[{"email":"me@x.com"}]}}`),
		record("whatsapp", "whatsapp.message", `{"push_name":"Dennis","text":"visit on Friday?"}`),
		record("whatsapp", "whatsapp.message", `{"from_me":true,"text":"hi"}`),
		record("telegram", "telegram.message", `{"out":true,"message":"sent"}`),
		record("slack", "slack.message", `{"channel":{"name":"eng"},"username":"dana","text":"deploy is red"}`),
		record("slack", "slack.message", `{"channel":{"name":"eng"},"text":"on it","from_me":true}`),
		record("whatsapp", "whatsapp.contact", `{}`),
	})
	want := []Incoming{
		{Provider: "gmail", From: "Ujjwal <u@cas.com>", Subject: "New quote", Text: "Numbers attached"},
		{Provider: "whatsapp", From: "Dennis", Text: "visit on Friday?"},
		{Provider: "slack", From: "dana", Subject: "#eng", Text: "deploy is red"},
	}
	if len(got) != len(want) {
		t.Fatalf("incoming = %+v", got)
	}
	for i := range want {
		got[i].ID = ""
		got[i].At = time.Time{}
		if got[i] != want[i] {
			t.Fatalf("incoming[%d] = %+v, want %+v", i, got[i], want[i])
		}
	}
}
