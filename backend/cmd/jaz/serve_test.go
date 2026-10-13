package main

import (
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/charmbracelet/log"
	"github.com/wins/jaz/backend/internal/acp"
	"github.com/wins/jaz/backend/internal/app"
	"github.com/wins/jaz/backend/internal/bots"
	"github.com/wins/jaz/backend/internal/loops"
	"github.com/wins/jaz/backend/internal/storage"
	sqlitestore "github.com/wins/jaz/backend/internal/storage/sqlite"
	"github.com/wins/jaz/backend/internal/widgets"
	"go.uber.org/fx"
)

func TestServeFxGraphValidates(t *testing.T) {
	if err := fx.ValidateApp(serveOptions(nil)...); err != nil {
		t.Fatal(err)
	}
}

func TestServeStartupFailureDoesNotLeaveDeclarationsOrListener(t *testing.T) {
	for _, occupied := range []bool{true, false} {
		t.Run(fmt.Sprint("occupied=", occupied), func(t *testing.T) {
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			addr := listener.Addr().String()
			cfg := app.Config{
				Root: t.TempDir(), Skills: app.SkillsConfig{DisableSync: true},
				ACP:  acp.Config{Agents: map[string]acp.AgentConfig{"fixture": {Command: "unused"}}},
				Bots: []bots.Config{{Name: "Research", Agent: "fixture"}},
			}
			if !occupied {
				_ = listener.Close()
				cfg.Bots[0].Prompt = "Research."
				cfg.Bots[0].Schedules = []bots.ScheduleConfig{{Name: "Morning", Schedule: loops.Schedule{Expr: "invalid"}}}
			}
			var store *sqlitestore.Store
			options := append(serveOptions([]string{"--addr", addr, "--public-url", "http://" + addr}),
				fx.Replace(cfg, log.New(io.Discard)), fx.Populate(&store), fx.NopLogger)
			application := fx.New(options...)
			if err := application.Err(); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = store.Close() })
			err = application.Start(t.Context())
			if occupied {
				var networkError *net.OpError
				if !errors.As(err, &networkError) || networkError.Op != "listen" {
					t.Fatalf("startup error = %v, want listen failure", err)
				}
			} else {
				if err == nil || !strings.Contains(err.Error(), "invalid cron expression") {
					t.Fatalf("startup error = %v, want invalid schedule", err)
				}
				rebound, err := net.Listen("tcp", addr)
				if err != nil {
					t.Fatalf("failed startup left the listener open: %v", err)
				}
				_ = rebound.Close()
			}
			records, err := store.ListBots()
			if err != nil || len(records) != 0 {
				t.Fatalf("failed startup declared bots: %+v, %v", records, err)
			}
		})
	}
}

func TestParseServeConfigIncludesPreviewURLTemplate(t *testing.T) {
	cfg, err := parseServeConfig(serveArgs{Args: []string{"--preview-url-template", " https://{id}.preview.example.test "}})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PreviewURLTemplate != "https://{id}.preview.example.test" {
		t.Fatalf("preview URL template = %q", cfg.PreviewURLTemplate)
	}
}

func TestFinishLoopFromACPRejectsUnpublishedWidgetRun(t *testing.T) {
	loopService, widgetService, widgetPublisher, store, loop, run := newWidgetLoopFinishTest(t, "thread-unpublished")

	finishLoopFromACP(loopService, widgetPublisher, log.New(io.Discard), acp.Job{
		ID:    run.ThreadID,
		State: acp.StateIdle,
	})

	stored, err := store.LoadRun(run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != loops.RunStatusError || !strings.Contains(stored.Error, "visualise_publish_widget") {
		t.Fatalf("run = %+v", stored)
	}
	widget, _, _, err := widgetService.StateForLoop(loop.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(widget.LastError, "visualise_publish_widget") {
		t.Fatalf("widget last error = %q", widget.LastError)
	}
}

func TestFinishLoopFromACPRejectsWidgetFileWithoutPublishTool(t *testing.T) {
	loopService, widgetService, widgetPublisher, store, loop, run := newWidgetLoopFinishTest(t, "thread-file-without-publish")
	path := widgets.WidgetFilePath(loop)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("<p>auto</p>"), 0o644); err != nil {
		t.Fatal(err)
	}

	finishLoopFromACP(loopService, widgetPublisher, log.New(io.Discard), acp.Job{
		ID:    run.ThreadID,
		State: acp.StateIdle,
	})

	stored, err := store.LoadRun(run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != loops.RunStatusError || !strings.Contains(stored.Error, "visualise_publish_widget") {
		t.Fatalf("run = %+v", stored)
	}
	state, err := widgetService.RunPublishState(loop.ID, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if state.Published || state.Widget.CurrentVersion != 0 {
		t.Fatalf("publish state = %+v", state)
	}
}

func TestFinishLoopFromACPAcceptsWidgetPublishedByRun(t *testing.T) {
	loopService, widgetService, widgetPublisher, store, loop, run := newWidgetLoopFinishTest(t, "thread-published")
	if _, _, err := widgetService.Publish(loop, run.ID, widgets.PublishInput{HTML: "<p>ok</p>"}); err != nil {
		t.Fatalf("publish: %v", err)
	}

	finishLoopFromACP(loopService, widgetPublisher, log.New(io.Discard), acp.Job{
		ID:    run.ThreadID,
		State: acp.StateIdle,
	})

	stored, err := store.LoadRun(run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != loops.RunStatusOK || stored.Error != "" {
		t.Fatalf("run = %+v", stored)
	}
}

func newWidgetLoopFinishTest(t *testing.T, threadID string) (*loops.Service, *widgets.Service, *widgets.SessionPublisher, *sqlitestore.Store, loops.Loop, loops.Run) {
	t.Helper()
	store, err := sqlitestore.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now().UTC()
	loop := loops.Loop{
		ID:         store.NewLoopID(),
		Name:       "Widget loop",
		Prompt:     "update",
		Schedule:   loops.Schedule{Kind: loops.ScheduleCron, Expr: "0 9 * * *", Timezone: "UTC"},
		Status:     loops.StatusActive,
		Runtime:    loops.RuntimeACP,
		MemoryPath: filepath.Join(t.TempDir(), "widget-loop", "memory.md"),
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if err := store.SaveLoop(loop); err != nil {
		t.Fatal(err)
	}
	runID := store.NewRunID()
	run := loops.Run{
		ID:        runID,
		LoopID:    loop.ID,
		StartedAt: now.Add(-time.Minute),
		Status:    loops.RunStatusRunning,
		CreatedAt: now,
	}
	session, err := store.CreateSession(storage.CreateSession{
		Slug:       threadID,
		Runtime:    storage.RuntimeACP,
		SourceType: storage.SourceLoopRun,
		SourceID:   run.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	run.ThreadID = session.ID
	if err := store.SaveRun(run); err != nil {
		t.Fatal(err)
	}
	widgetService := widgets.NewService(store, nil)
	board, err := widgetService.CreateBoard("Desk")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := widgetService.AssignLoopBoards(loop, []string{board.ID}); err != nil {
		t.Fatal(err)
	}
	return loops.NewService(store, nil, nil), widgetService, &widgets.SessionPublisher{
		Service:  widgetService,
		Sessions: store,
		Loops:    store,
	}, store, loop, run
}
