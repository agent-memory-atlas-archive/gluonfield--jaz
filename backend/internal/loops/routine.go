package loops

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

// runPrompt is what a run sends: what fired it, then the routine's prompt. A
// turn in the bot's own thread is also labelled with the routine and the local
// time, which a run in a fresh thread gets from its system prompt, and says
// how the bot is heard, as its other turns do: a bot whose prompt predates that
// rule would otherwise answer in private text.
func runPrompt(loop Loop, now time.Time, event string, inThread bool) string {
	var b strings.Builder
	if inThread {
		loc, _, err := scheduleLocation(loop.Schedule.Timezone)
		if err != nil {
			loc = time.UTC
		}
		fmt.Fprintf(&b, "[routine] %s · %s\n", loop.Name, now.In(loc).Format("Mon 2 Jan 2006 15:04 MST"))
	}
	if event != "" {
		fmt.Fprintf(&b, "Triggered by: %s\n", event)
	}
	if b.Len() > 0 {
		b.WriteString("\n")
	}
	b.WriteString(loop.Prompt)
	if inThread {
		b.WriteString("\n\nThe user wants this routine's outcome: send it with send_message, the only thing they see, unless the routine says to stay quiet.")
	}
	return b.String()
}

// ensureWebhookSecret gives a webhook routine a secret the first time it needs
// one; only its hash is stored.
func ensureWebhookSecret(loop *Loop) {
	if loop.Trigger == nil || loop.Trigger.Kind != TriggerWebhook || loop.WebhookHash != "" {
		return
	}
	raw := make([]byte, 24)
	_, _ = rand.Read(raw)
	secret := hex.EncodeToString(raw)
	loop.WebhookHash = hashSecret(secret)
	loop.WebhookSecret = secret
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
