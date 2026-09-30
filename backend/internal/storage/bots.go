package storage

import "errors"

var ErrBotNotFound = errors.New("bot not found")

// BotRecord is what a bot adds to its thread: the thread holds the name, agent
// and history; the record holds the avatar and, for a group, its members.
type BotRecord struct {
	ThreadID string
	Kind     string
	Shape    string
	Color    string
	Members  []string
}
