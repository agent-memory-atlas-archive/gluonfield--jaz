package memoryservice

import (
	"context"
	"io"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/charmbracelet/log"
	"github.com/gluonfield/jazmem/pkg/jazmem"
)

type dreamRunnerFunc func(context.Context, jazmem.DreamRequest) (jazmem.DreamReport, error)

func (f dreamRunnerFunc) RunDream(ctx context.Context, req jazmem.DreamRequest) (jazmem.DreamReport, error) {
	return f(ctx, req)
}

func TestSchedulerStopWaitsForWorkerCleanup(t *testing.T) {
	started := make(chan struct{})
	cancelled := make(chan struct{})
	release := make(chan struct{})
	finish := sync.OnceFunc(func() { close(release) })
	memory, err := jazmem.Open(jazmem.Config{
		Root:   t.TempDir(),
		DBPath: filepath.Join(t.TempDir(), "index.sqlite"),
		Now:    func() time.Time { return time.Date(2026, 9, 16, 3, 0, 0, 0, time.Local) },
		DreamRunner: dreamRunnerFunc(func(ctx context.Context, _ jazmem.DreamRequest) (jazmem.DreamReport, error) {
			close(started)
			<-ctx.Done()
			close(cancelled)
			<-release
			return jazmem.DreamReport{}, ctx.Err()
		}),
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = memory.Close() })
	scheduler := NewScheduler(memory, true, log.New(io.Discard))
	t.Cleanup(func() {
		finish()
		scheduler.Stop()
	})
	scheduler.Start()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("worker did not start")
	}
	stopped := make(chan struct{})
	go func() {
		scheduler.Stop()
		close(stopped)
	}()
	<-cancelled
	select {
	case <-stopped:
		t.Fatal("scheduler stopped before the worker finished cleanup")
	case <-time.After(50 * time.Millisecond):
	}
	finish()
	select {
	case <-stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("scheduler did not stop after cleanup")
	}
	if scheduler.Running() {
		t.Fatal("stopped scheduler is still reported as running")
	}
}

func TestSchedulerExitClearsRunningState(t *testing.T) {
	memory, err := jazmem.Open(jazmem.Config{Root: t.TempDir(), DBPath: filepath.Join(t.TempDir(), "index.sqlite")})
	if err != nil {
		t.Fatal(err)
	}
	if err := memory.Close(); err != nil {
		t.Fatal(err)
	}
	scheduler := NewScheduler(memory, true, log.New(io.Discard))
	t.Cleanup(scheduler.Stop)
	scheduler.Start()
	deadline := time.Now().Add(time.Second)
	for scheduler.Running() && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if scheduler.Running() {
		t.Fatal("scheduler loop exited but still reports running")
	}
}
