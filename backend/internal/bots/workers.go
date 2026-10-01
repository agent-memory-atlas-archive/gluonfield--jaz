package bots

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/wins/jaz/backend/internal/acp"
	"github.com/wins/jaz/backend/internal/storage"
)

// StartWorker hands a self-contained piece of a bot's work to a background
// thread on the bot's worker setup, in the bot's directory. The worker is a
// child of the bot's thread, so its result returns to the bot as a new turn.
func (s *Service) StartWorker(ctx context.Context, botID, title, prompt string) (string, error) {
	title, prompt = strings.TrimSpace(title), strings.TrimSpace(prompt)
	if title == "" || prompt == "" {
		return "", errors.New("title and prompt are required")
	}
	record, session, err := s.load(botID)
	if err != nil || record.Kind != KindBot || session.RuntimeRef == nil {
		return "", errors.New("only a Jaz bot can start workers")
	}
	setup := record.Worker
	if setup.Agent == "" {
		setup = storage.BotWorker{Agent: session.RuntimeRef.Agent, Model: session.Model, ReasoningEffort: session.ReasoningEffort}
	}
	worker, err := s.Threads.CreateSession(ctx, acp.SpawnRequest{
		ParentID:        botID,
		ACPAgent:        setup.Agent,
		Model:           setup.Model,
		ReasoningEffort: setup.ReasoningEffort,
		Slug:            "worker " + title,
		Title:           title,
		Directory:       session.RuntimeRef.Cwd,
		SourceType:      storage.SourceBot,
		SourceID:        botID,
	})
	if err != nil {
		return "", err
	}
	if _, err := s.Threads.Send(ctx, acp.SendRequest{Session: worker.ID, Message: prompt, Completion: acp.CompletionAsync, ParentVisible: true}); err != nil {
		return "", fmt.Errorf("worker %s was created but could not start: %w", worker.ID, err)
	}
	return worker.ID, nil
}
