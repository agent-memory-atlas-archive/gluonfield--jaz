package loops

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"strings"
	"time"
)

// RoutineMessage is the prompt a run sends: a label naming the routine and the
// local time, what fired it, then the routine's own prompt.
func RoutineMessage(loop Loop, now time.Time, event string) string {
	loc, _, err := scheduleLocation(loop.Schedule.Timezone)
	if err != nil {
		loc = time.UTC
	}
	var b strings.Builder
	b.WriteString("[routine] ")
	b.WriteString(loop.Name)
	b.WriteString(" · ")
	b.WriteString(now.In(loc).Format("Mon 2 Jan 2006 15:04 MST"))
	if event != "" {
		b.WriteString("\nTriggered by: ")
		b.WriteString(event)
	}
	b.WriteString("\n\n")
	b.WriteString(loop.Prompt)
	return b.String()
}

// runPrompt is what a run sends. A turn in the bot's own thread is labelled
// with the routine and the time; a run in a fresh thread gets that from its
// system prompt and receives the task, and any event, alone.
func runPrompt(loop Loop, now time.Time, event, thread string) string {
	if thread != "" {
		return RoutineMessage(loop, now, event)
	}
	if event == "" {
		return loop.Prompt
	}
	return "Triggered by: " + event + "\n\n" + loop.Prompt
}

// ensureWebhookSecret gives a webhook routine a secret the first time it needs
// one and returns it; only its hash is stored.
func ensureWebhookSecret(loop *Loop) string {
	if loop.Trigger == nil || loop.Trigger.Kind != TriggerWebhook || loop.WebhookHash != "" {
		return ""
	}
	raw := make([]byte, 24)
	_, _ = rand.Read(raw)
	secret := hex.EncodeToString(raw)
	loop.WebhookHash = hashSecret(secret)
	loop.WebhookSecret = secret
	return secret
}

// VerifyWebhookSecret reports whether secret opens loop's webhook trigger.
func VerifyWebhookSecret(loop Loop, secret string) bool {
	if loop.Trigger == nil || loop.Trigger.Kind != TriggerWebhook || loop.WebhookHash == "" || secret == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(hashSecret(secret)), []byte(loop.WebhookHash)) == 1
}

func hashSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}
