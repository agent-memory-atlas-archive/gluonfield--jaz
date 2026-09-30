package bots

import (
	"fmt"
	"strings"

	"github.com/wins/jaz/backend/internal/promptmodule"
	"github.com/wins/jaz/backend/internal/sessionevents"
	"github.com/wins/jaz/backend/internal/storage"
)

// Prompt is the identity module a bot's thread starts with.
func Prompt(bots BotLoader, session storage.Session) (promptmodule.Modules, error) {
	record, err := bots.LoadBot(session.ID)
	if err != nil || record.Kind != KindBot {
		return nil, err
	}
	return promptmodule.New(identityPrompt(session.Title)), nil
}

func identityPrompt(name string) string {
	return fmt.Sprintf(`## You are %s, a Jaz bot

This thread is your whole life: it keeps going across days and is where you do your work. The people and bots you talk to see only what you send with send_message. Everything else you write, and every tool you use, stays private working notes. Write messages like texts in a chat: short, plain and conversational, without tool output, commands or status reports. Send one when you start something that takes a while and when you have the result.

Turns that do not come from the user open with a bracketed label: [routine] when one of your routines runs, [message from …] when another bot writes, [reply from …] when a bot answers you, [group chat …] when a group you belong to is talking. In a [group chat …] turn send_message posts to the group, and in a [message from …] turn it answers that bot. In every other turn, including a [reply from …], it reaches the user; write to another bot only with message_bot.

Routines are your scheduled or event-triggered work. Create and manage them with loop_create, loop_update, loop_delete and loop_list; routines created here belong to you and every run is a turn in this thread. Prefer a routine whenever something should happen later, repeatedly, or when something arrives. When a routine run finds nothing that needs the user, send nothing.

Other bots are listed by list_bots; reach one with message_bot. Their answer arrives later as a new turn here, so do not wait for it. Keep this thread focused: hand long or heavy work to a sub-agent and bring back the result.`, name)
}

func messagePrompt(from, text string) string {
	return fmt.Sprintf("[message from %s]\n\n%s\n\nAnswer %s with send_message.", from, text, from)
}

func replyPrompt(from, text string) string {
	return fmt.Sprintf("[reply from %s]\n\n%s\n\nThis answers your message to %s. send_message now reaches the user; use message_bot to write back to %s.", from, text, from, from)
}

func groupTurnPrompt(group, self string, peers []string, messages []sessionevents.RoomMessageEvent) string {
	var b strings.Builder
	fmt.Fprintf(&b, "[group chat %q] You are %s. Also here: %s and the user.\n\nNew messages since you last spoke:\n", group, self, strings.Join(peers, ", "))
	for _, message := range messages {
		fmt.Fprintf(&b, "%s: %s\n", message.Name, message.Text)
	}
	b.WriteString("\nPost to the group with send_message, short and only when you add something new. If you have nothing to add, send nothing. Your post wakes only the members you mention, so mention one when you want their answer.")
	return b.String()
}
