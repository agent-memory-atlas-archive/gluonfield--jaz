package storage

import "errors"

var ErrBotNotFound = errors.New("bot not found")

// BotRecord is what a bot adds to its thread: the thread holds the name, agent
// and history; the record holds the avatar, pin position (1-based, 0 unpinned),
// background worker setup and group members.
type BotRecord struct {
	ThreadID string
	Kind     string
	Shape    string
	Color    string
	Pinned   int
	Members  []string
	Worker   BotWorker
}

// BotWorker is the agent, model and effort a bot's workers run with. An empty
// Agent means the bot's own.
type BotWorker struct {
	Agent           string
	Model           string
	ReasoningEffort string
}
