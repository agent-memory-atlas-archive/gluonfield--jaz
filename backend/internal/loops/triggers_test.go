package loops

import (
	"strings"
	"testing"
	"time"

	"github.com/wins/jaz/backend/internal/integrationingest"
)

func TestTriggerFiltersMatchSenderSubjectAndText(t *testing.T) {
	mail := integrationingest.Incoming{Provider: "gmail", From: "Ujjwal <u@cas.com>", Subject: "New quote", Text: "Numbers attached"}
	trigger := &Trigger{Kind: TriggerGmail, From: "ujjwal", Contains: "quote"}
	if !trigger.matches(mail) {
		t.Fatalf("matching mail did not fire: %+v", mail)
	}
	if !strings.Contains(describe(mail), "subject: New quote") {
		t.Fatalf("event description = %q", describe(mail))
	}
	for _, other := range []integrationingest.Incoming{
		{Provider: "gmail", From: "someone@else.com", Subject: "New quote"},
		{Provider: "whatsapp", From: "Ujjwal", Text: "quote"},
	} {
		if trigger.matches(other) {
			t.Fatalf("%+v fired a trigger it does not match", other)
		}
	}
	channel := integrationingest.Incoming{Provider: "slack", From: "dana", Subject: "#eng", Text: "deploy is red"}
	if !(&Trigger{Kind: TriggerSlack, Subject: "#eng", Contains: "deploy"}).matches(channel) || (&Trigger{Kind: TriggerSlack, Subject: "#sales"}).matches(channel) {
		t.Fatal("slack channel filter is wrong")
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
	ensureWebhookSecret(&loop)
	secret, hash := loop.WebhookSecret, loop.WebhookHash
	if secret == "" || hash == "" || hash == secret {
		t.Fatalf("secret %q hash %q", secret, hash)
	}
	ensureWebhookSecret(&loop)
	if loop.WebhookHash != hash {
		t.Fatal("an existing secret was replaced")
	}
	if !VerifyWebhookSecret(loop, secret) || VerifyWebhookSecret(loop, secret+"x") || VerifyWebhookSecret(loop, "") {
		t.Fatal("webhook secret verification is wrong")
	}
}

func TestRunPromptLabelsThreadTurnsAndCarriesTheEvent(t *testing.T) {
	loop := Loop{Name: "Triage", Prompt: "Sort the inbox", Schedule: Schedule{Timezone: "UTC"}}
	now := time.Date(2026, 9, 30, 9, 5, 0, 0, time.UTC)
	for _, tc := range []struct {
		event    string
		inThread bool
		want     string
	}{
		{"", false, "Sort the inbox"},
		{"new mail", false, "Triggered by: new mail\n\nSort the inbox"},
		{"", true, "[routine] Triage · Wed 30 Sep 2026 09:05 UTC\n\nSort the inbox"},
		{"new mail", true, "[routine] Triage · Wed 30 Sep 2026 09:05 UTC\nTriggered by: new mail\n\nSort the inbox"},
	} {
		if got := runPrompt(loop, now, tc.event, tc.inThread); got != tc.want {
			t.Errorf("runPrompt(%q, %v) = %q, want %q", tc.event, tc.inThread, got, tc.want)
		}
	}
}
