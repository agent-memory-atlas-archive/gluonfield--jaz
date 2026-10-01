package storage

import "errors"

var ErrBotNotFound = errors.New("bot not found")

// BotRecord is what a bot adds to its thread: the thread holds the name, agent
<<<<<<< HEAD
// and history; the record holds the avatar, the setup of the bot's background
// workers and, for a group, its members.
=======
// and history; the record holds the avatar, the place among the pinned bots
// (from 1, or 0 when not pinned) and, for a group, its members.
>>>>>>> main
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
