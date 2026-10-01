package storage

import "errors"

var ErrBotNotFound = errors.New("bot not found")

// BotRecord is what a bot adds to its thread: the thread holds the name, agent
// and history; the record holds the avatar, pin position (1-based, 0 unpinned)
// and group members.
type BotRecord struct {
	ThreadID string
	Kind     string
	Shape    string
	Color    string
	Pinned   int
	Members  []string
}
