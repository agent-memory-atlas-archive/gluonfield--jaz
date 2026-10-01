package server

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/log"
	"github.com/wins/jaz/backend/internal/acp"
	"github.com/wins/jaz/backend/internal/loops"
	"github.com/wins/jaz/backend/internal/storage"
)

type LoopRunner struct {
	acp ACPManager
	log *log.Logger
	// Bots runs the routines that live in a bot's thread.
	Bots BotRoutines
}

// BotRoutines runs a routine as a turn in its bot's thread.
type BotRoutines interface {
	RunRoutine(ctx context.Context, botID, name, prompt string) (acp.Job, error)
}

func NewLoopRunner(server *Server) *LoopRunner {
	return &LoopRunner{acp: server.ACP, log: server.logger().WithPrefix("loops")}
}

func (r *LoopRunner) StartLoopRun(_ context.Context, execution loops.Execution) {
	loop := execution.Loop
	switch loop.Runtime {
	case "", loops.RuntimeACP:
		r.startACPLoopRun(execution)
	default:
		r.finishLoopRun(execution, loops.RunStatusError, fmt.Sprintf("unknown loop runtime %q", loop.Runtime))
	}
}

func (r *LoopRunner) startACPLoopRun(execution loops.Execution) {
	if r.acp == nil {
		r.finishLoopRun(execution, loops.RunStatusError, "acp manager is not configured")
		return
	}
	if execution.Thread != "" {
		r.startBotTurn(execution)
		return
	}
	loop := execution.Loop
	run := execution.Run
	startCtx, cancel := serverACPBootstrapContext()
	defer cancel()
	// An empty agent stays empty: the ACP manager resolves the canonical
	// default at spawn time, the same default sessions get.
	agent := strings.TrimSpace(loop.ACPAgent)
	directory := strings.TrimSpace(loop.Directory)
	if directory == "" {
		directory = "."
	}
	spawned, err := r.acp.Spawn(startCtx, acp.SpawnRequest{
		ACPAgent:               agent,
		Slug:                   loopRunSlug(loop, run),
		Title:                  loop.Name,
		ParentID:               loop.BotID,
		Directory:              directory,
		ModelProvider:          loop.ModelProvider,
		Model:                  loop.Model,
		ReasoningEffort:        loop.ReasoningEffort,
		SourceType:             storage.SourceLoopRun,
		SourceID:               run.ID,
		ArtifactSurface:        execution.ArtifactSurface,
		SystemPromptExtensions: execution.SystemPromptExtensions,
	})
	if err != nil {
		r.finishLoopRun(execution, loops.RunStatusError, err.Error())
		return
	}
	if err := execution.Controller.MarkRunning(run.ID, spawned.SessionID); err != nil {
		r.logger().Error("mark loop run running failed", "run", run.ID, "session", spawned.SessionID, "error", err)
	}
	sendCtx, cancel := serverACPBootstrapContext()
	defer cancel()
	if _, err := r.acp.Send(sendCtx, acp.SendRequest{
		Session:    spawned.SessionID,
		Message:    execution.Prompt,
		Completion: acp.CompletionAsync,
	}); err != nil {
		r.finishLoopRun(execution, loops.RunStatusError, err.Error())
	}
}

// startBotTurn runs a routine in its bot's thread and closes the run when that
// turn ends. The run records no thread: the bot's thread outlives it, so that
// thread's turn endings cannot tell which run they close.
func (r *LoopRunner) startBotTurn(execution loops.Execution) {
	if err := execution.Controller.MarkRunning(execution.Run.ID, ""); err != nil {
		r.logger().Error("mark routine run running failed", "run", execution.Run.ID, "bot", execution.Thread, "error", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Hour)
	defer cancel()
	job, err := r.Bots.RunRoutine(ctx, execution.Thread, execution.Loop.Name, execution.Prompt)
	if err != nil {
		r.finishLoopRun(execution, loops.RunStatusError, err.Error())
		return
	}
	r.finishLoopRun(execution, LoopRunStatus(job.State), job.Error)
}

// LoopRunStatus is the status a finished turn gives the loop run it served.
func LoopRunStatus(state string) string {
	switch state {
	case acp.StateFailed:
		return loops.RunStatusError
	case acp.StateCancelled:
		return loops.RunStatusCancelled
	}
	return loops.RunStatusOK
}

func (r *LoopRunner) finishLoopRun(execution loops.Execution, status, errText string) {
	if execution.Controller == nil {
		return
	}
	if err := execution.Controller.Finish(execution.Run.ID, status, errText); err != nil {
		r.logger().Error("finish loop run failed", "run", execution.Run.ID, "status", status, "error", err)
	}
}

func loopRunSlug(loop loops.Loop, run loops.Run) string {
	when := run.ScheduledFor
	if when.IsZero() {
		when = time.Now().UTC()
	}
	return fmt.Sprintf("loop-%s-%s", loop.Name, when.Local().Format("20060102-1504"))
}

func (r *LoopRunner) logger() *log.Logger {
	if r.log != nil {
		return r.log
	}
	return log.Default()
}
