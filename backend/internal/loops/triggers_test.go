package loops

import (
	"strings"
	"testing"
	"time"

	"github.com/wins/jaz/backend/pkg/integrations"
)

func gmailRecord(raw string) integrations.Record {
	return integrations.Record{Provider: "gmail", Kind: "gmail.message", ExternalID: "m1", OccurredAt: time.Now(), Raw: []byte(raw)}
}

func TestGmailTriggerMatchesFiltersAndIgnoresSentMail(t *testing.T) {
	trigger := &Trigger{Kind: TriggerGmail, From: "ujjwal", Contains: "quote"}
	incoming, ok := incomingFrom(gmailRecord(`{"message":{"id":"m1","subject":"New quote","from":[{"name":"Ujjwal","email":"u@cas.com"}]},"body_text":"Numbers attached"}`))
	if !ok || !trigger.matches(incoming) {
		t.Fatalf("matching mail did not fire: %+v", incoming)
	}
	if !strings.Contains(incoming.describe(), "subject: New quote") {
		t.Fatalf("event description = %q", incoming.describe())
	}
	other, _ := incomingFrom(gmailRecord(`{"message":{"id":"m2","subject":"New quote","from":[{"email":"someone@else.com"}]}}`))
	if trigger.matches(other) {
		t.Fatal("mail from another sender fired a from-filtered trigger")
	}
	if _, ok := incomingFrom(gmailRecord(`{"message":{"id":"m3","label_ids":["SENT"],"from":[{"email":"me@x.com"}]}}`)); ok {
		t.Fatal("the user's own sent mail must not fire triggers")
	}
}

func TestChatTriggersIgnoreTheUsersOwnMessages(t *testing.T) {
	own := integrations.Record{Kind: "whatsapp.message", OccurredAt: time.Now(), Raw: []byte(`{"from_me":true,"text":"hi"}`)}
	if _, ok := incomingFrom(own); ok {
		t.Fatal("own WhatsApp message fired")
	}
	theirs := integrations.Record{Kind: "whatsapp.message", OccurredAt: time.Now(), Raw: []byte(`{"push_name":"Dennis","text":"visit on Friday?"}`)}
	incoming, ok := incomingFrom(theirs)
	if !ok || !(&Trigger{Kind: TriggerWhatsApp, Contains: "friday"}).matches(incoming) {
		t.Fatalf("incoming WhatsApp message did not match: %+v", incoming)
	}
}

func TestEventTriggerReplacesScheduleUntilCronIsSet(t *testing.T) {
	now := time.Date(2026, 9, 30, 9, 0, 0, 0, time.UTC)
	input, next, err := NormalizeCreate(CreateLoop{Prompt: "triage", Trigger: &Trigger{Kind: "Gmail"}}, now)
	if err != nil {
		t.Fatal(err)
	}
	if input.Schedule.Kind != ScheduleEvent || !next.IsZero() || input.Trigger.Kind != TriggerGmail {
		t.Fatalf("event routine = %+v next %s", input, next)
	}
	loop := Loop{Name: "triage", Prompt: "triage", Status: StatusActive, Runtime: RuntimeACP, Schedule: input.Schedule, Trigger: input.Trigger}
	updated, _, err := NormalizeUpdate(loop, UpdateLoop{Schedule: &Schedule{Expr: "0 8 * * 1-5", Timezone: "UTC"}}, now)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Trigger != nil || updated.Schedule.Kind != ScheduleCron || updated.NextRunAt.IsZero() {
		t.Fatalf("cron update kept the trigger: %+v", updated)
	}
}

func TestWebhookSecretIsReturnedOnceAndVerifiedByHash(t *testing.T) {
	loop := Loop{Trigger: &Trigger{Kind: TriggerWebhook}}
	secret := ensureWebhookSecret(&loop)
	if secret == "" || loop.WebhookHash == "" || loop.WebhookHash == secret {
		t.Fatalf("secret %q hash %q", secret, loop.WebhookHash)
	}
	if ensureWebhookSecret(&loop) != "" {
		t.Fatal("an existing secret was replaced")
	}
	if !VerifyWebhookSecret(loop, secret) || VerifyWebhookSecret(loop, secret+"x") || VerifyWebhookSecret(loop, "") {
		t.Fatal("webhook secret verification is wrong")
	}
}

func TestSlackTriggerMatchesChannelAndSkipsOwnMessages(t *testing.T) {
	record := func(raw string) integrations.Record {
		return integrations.Record{Kind: "slack.message", OccurredAt: time.Now(), Raw: []byte(raw)}
	}
	incoming, ok := incomingFrom(record(`{"channel":{"name":"eng"},"username":"dana","text":"deploy is red"}`))
	if !ok || !(&Trigger{Kind: TriggerSlack, Subject: "#eng", Contains: "deploy"}).matches(incoming) {
		t.Fatalf("channel message did not match: %+v", incoming)
	}
	if (&Trigger{Kind: TriggerSlack, Subject: "#sales"}).matches(incoming) {
		t.Fatal("a message in another channel matched")
	}
	if _, ok := incomingFrom(record(`{"channel":{"name":"eng"},"text":"on it","from_me":true}`)); ok {
		t.Fatal("the user's own Slack message fired")
	}
}
