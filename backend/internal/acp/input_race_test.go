package acp

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gluonfield/acp-transport/jsonrpc"
	"github.com/wins/jaz/backend/internal/storage"
	jsonstore "github.com/wins/jaz/backend/internal/storage/json"
)

type admissionAgentSource struct{ reads atomic.Int32 }

func (s *admissionAgentSource) AgentConfig(string) (AgentConfig, bool, error) {
	s.reads.Add(1)
	return AgentConfig{}, true, nil
}

func (s *admissionAgentSource) EnabledAgentNames() ([]string, error) {
	return []string{"fake"}, nil
}

func TestInputWaitsForFinishingTurnWithoutSpinning(t *testing.T) {
	for _, method := range []steerMethod{steerUnsupported, steerNative} {
		t.Run(string(method), func(t *testing.T) {
			store, err := jsonstore.New(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			session, err := store.CreateSession(storage.CreateSession{Slug: "finishing", Runtime: storage.RuntimeACP})
			if err != nil {
				t.Fatal(err)
			}
			source := &admissionAgentSource{}
			manager := NewManager(store, Config{AgentSource: source}, nil)
			job := newIdleJob(session, "fake", "native", "", ModeState{})
			job.steerMethod = method
			job.startTurn(CompletionInline, false, false)
			job.markFirstPromptSent()
			job.setState(StateIdle, StopReasonEndTurn, "")
			manager.addJob(job, &agentProcess{peer: &jsonrpc.Peer{}})

			ctx, cancel := context.WithTimeout(t.Context(), 50*time.Millisecond)
			defer cancel()
			_, err = manager.Input(ctx, SteerRequest{Session: session.ID, Message: "next request"})
			if !errors.Is(err, context.DeadlineExceeded) {
				t.Fatalf("finishing-turn admission = %v, want cancellable wait", err)
			}
			if reads := source.reads.Load(); reads > 2 {
				t.Fatalf("admission retried %d config reads while the same turn was finishing", reads)
			}
			messages, err := store.LoadMessages(session.ID)
			if err != nil || len(messages) != 0 {
				t.Fatalf("unaccepted input persisted = %+v, %v", messages, err)
			}
		})
	}
}

func TestInternalTurnWhenIdleWaitsForRunningTurn(t *testing.T) {
	store, err := jsonstore.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	session, err := store.CreateSession(storage.CreateSession{Slug: "busy", Runtime: storage.RuntimeACP})
	if err != nil {
		t.Fatal(err)
	}
	manager := NewManager(store, Config{AgentSource: &admissionAgentSource{}}, nil)
	job := newIdleJob(session, "fake", "native", "", ModeState{})
	job.startTurn(CompletionInline, false, false)
	job.markFirstPromptSent()
	job.setState(StateRunning, "", "")
	manager.addJob(job, &agentProcess{peer: &jsonrpc.Peer{}})

	_, err = manager.StartInternalTurn(t.Context(), InternalTurnRequest{Session: session.ID, Message: "routine"})
	var busy *turnInProgressError
	if !errors.As(err, &busy) {
		t.Fatalf("internal turn on a busy thread = %v, want turn in progress", err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 50*time.Millisecond)
	defer cancel()
	_, err = manager.StartInternalTurnWhenIdle(ctx, InternalTurnRequest{Session: session.ID, Message: "routine"})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("idle-waiting internal turn = %v, want it to wait for the running turn", err)
	}
}
