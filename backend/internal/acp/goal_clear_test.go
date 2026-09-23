package acp

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wins/jaz/backend/internal/agent"
	"github.com/wins/jaz/backend/internal/goal"
	"github.com/wins/jaz/backend/internal/sessionevents"
	"github.com/wins/jaz/backend/internal/sessiongoal"
	"github.com/wins/jaz/backend/internal/storage"
	jsonstore "github.com/wins/jaz/backend/internal/storage/json"
	sqlitestore "github.com/wins/jaz/backend/internal/storage/sqlite"
)

type goalRunner struct {
	started chan context.Context
	events  chan agent.StreamEvent
}

func (r goalRunner) Run(ctx context.Context, _ LocalAgentRequest) <-chan agent.StreamEvent {
	r.started <- ctx
	return r.events
}

func TestClearGoalLetsRunningResponseFinish(t *testing.T) {
	for _, createGoal := range []bool{false, true} {
		t.Run(fmt.Sprint(createGoal), func(t *testing.T) {
			store, err := sqlitestore.New(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			defer store.Close()
			session, err := store.CreateSession(storage.CreateSession{Slug: "goal-clear", Runtime: storage.RuntimeACP})
			if err != nil {
				t.Fatal(err)
			}
			manager := NewManager(store, Config{Agents: map[string]AgentConfig{"local": {Local: true}}}, nil)
			defer manager.Close()
			manager.Events = sessionevents.New()
			manager.TurnFinished = func(_ context.Context, job Job) {
				if err := store.CompleteSession(job.ID, time.Now().UTC()); err != nil {
					t.Error(err)
				}
			}
			runner := goalRunner{started: make(chan context.Context, 1), events: make(chan agent.StreamEvent, 2)}
			finish := sync.OnceFunc(func() {
				close(runner.events)
			})
			defer finish()
			manager.RegisterLocalAgent("local", runner)
			job := newIdleJob(session, "local", "runtime-session", "", ModeState{})
			manager.addJob(job, nil)
			ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
			defer cancel()
			if _, err := manager.Send(ctx, SendRequest{Session: session.ID, Message: "Finish this response", GoalRequested: true}); err != nil {
				t.Fatal(err)
			}
			var runCtx context.Context
			select {
			case runCtx = <-runner.started:
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			goals := sessiongoal.New(store, manager.Events)
			if createGoal {
				if _, err := goals.Create(ctx, session.ID, sessiongoal.CreateInput{Objective: "Finish this response"}); err != nil {
					t.Fatal(err)
				}
			}
			sub := manager.Events.Subscribe(ctx, session.ID)
			if err := manager.ClearGoal(ctx, session.Slug); err != nil {
				t.Fatal(err)
			}
			_ = receiveGoalClear(t, ctx, sub)
			if runCtx.Err() != nil || job.Snapshot().State != StateRunning || job.Snapshot().GoalRequested {
				t.Fatalf("clearing goal interrupted response: %v, %+v", runCtx.Err(), job.Snapshot())
			}
			loaded, err := store.LoadSession(session.ID)
			if err != nil || loaded.Status != storage.StatusRunning || loaded.Goal != nil || loaded.Turn == nil || loaded.Turn.GoalRequested {
				t.Fatalf("cleared session = %+v, %v", loaded, err)
			}
			if _, err := goals.Create(ctx, session.ID, sessiongoal.CreateInput{Objective: "Late goal"}); !errors.Is(err, storage.ErrGoalNotRequested) {
				t.Fatalf("late create = %v", err)
			}
			runner.events <- agent.StreamEvent{Type: agent.StreamDelta, Delta: "Response completed after goal was cleared."}
			runner.events <- agent.StreamEvent{Type: agent.StreamDone}
			finish()
			finished, err := manager.Wait(ctx, WaitRequest{Session: session.ID, Timeout: time.Second})
			if err != nil || finished.State != StateIdle || finished.Assistant != "Response completed after goal was cleared." {
				t.Fatalf("response = %+v, %v", finished, err)
			}
			if _, err := manager.ContinueGoal(ctx, session.ID); !errors.Is(err, sessiongoal.ErrNoActiveGoal) {
				t.Fatalf("continued a cleared goal: %v", err)
			}
		})
	}
}

func TestGoalPromptUsesJazTools(t *testing.T) {
	prompt := goalPromptMessage("do the work", true)
	for _, required := range []string{"create_goal", "do the work", "user explicitly provided", "Never estimate or invent one", "does not interrupt a turn already in progress"} {
		if !strings.Contains(prompt, required) {
			t.Fatalf("goal prompt message missing %q: %q", required, prompt)
		}
	}
	if got := goalPromptMessage("do the work", false); got != "do the work" {
		t.Fatalf("unrequested goal prompt message = %q", got)
	}
}

func TestCancelClearsPersistedGoal(t *testing.T) {
	store, err := jsonstore.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	session, err := store.CreateSession(storage.CreateSession{Slug: "codex-goal-cancel", Runtime: storage.RuntimeACP})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.AppendSessionEvents(session.ID, sessionevents.Event{Type: sessionevents.TypeGoalUpdate, Goal: activeGoalState("Stop should clear this", 10)}); err != nil {
		t.Fatal(err)
	}
	events := sessionevents.New()
	manager := NewManager(store, Config{}, nil)
	manager.Events = events
	manager.jobsByID[session.ID] = &jobState{Job: Job{ID: session.ID, Slug: session.Slug, ACPAgent: AgentCodex, ACPSession: "acp-session"}}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	sub := events.Subscribe(ctx, session.ID)
	if _, err := manager.Cancel(ctx, session.ID); err != nil {
		t.Fatal(err)
	}
	_ = receiveGoalClear(t, ctx, sub)
	loaded, err := store.LoadSession(session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Goal != nil {
		t.Fatalf("session goal after cancel = %#v", loaded.Goal)
	}
}

func TestCancelStoredClearsPersistedGoal(t *testing.T) {
	store, err := jsonstore.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	session, err := store.CreateSession(storage.CreateSession{Slug: "codex-goal-stored-cancel", Runtime: storage.RuntimeACP})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.AppendSessionEvents(session.ID, sessionevents.Event{Type: sessionevents.TypeGoalUpdate, Goal: activeGoalState("Stop should clear after restart", 10)}); err != nil {
		t.Fatal(err)
	}
	events := sessionevents.New()
	manager := NewManager(store, Config{}, nil)
	manager.Events = events

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	sub := events.Subscribe(ctx, session.ID)
	if _, err := manager.Cancel(ctx, session.ID); err != nil {
		t.Fatal(err)
	}
	_ = receiveGoalClear(t, ctx, sub)
	loaded, err := store.LoadSession(session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Goal != nil {
		t.Fatalf("session goal after stored cancel = %#v", loaded.Goal)
	}
}

func activeGoalState(objective string, tokensUsed int64) *goal.State {
	return &goal.State{
		Identity: goal.Identity{
			Objective: objective,
			Status:    goal.StatusActive,
		},
		Budget: goal.Budget{TokensUsed: tokensUsed},
	}
}

func receiveGoalClear(t *testing.T, ctx context.Context, sub <-chan sessionevents.Event) sessionevents.Event {
	t.Helper()
	for {
		select {
		case event := <-sub:
			if event.Type == sessionevents.TypeGoalClear {
				return event
			}
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
}
