package acp

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type ThreadResults struct {
	Threads []Job
	Errors  map[string]string
}

func (m *Manager) WaitThreads(ctx context.Context, refs []string, timeout time.Duration) (ThreadResults, error) {
	if len(refs) < 1 || len(refs) > 8 {
		return ThreadResults{}, fmt.Errorf("targets must contain 1 to 8 threads")
	}
	if timeout > 0 {
		waitCtx, cancel := context.WithTimeout(ctx, timeout)
		ready := make(chan struct{}, len(refs))
		var waiters sync.WaitGroup
		for _, ref := range refs {
			waiters.Go(func() {
				m.waitForThread(waitCtx, ref)
				ready <- struct{}{}
			})
		}
		select {
		case <-ready:
		case <-waitCtx.Done():
		}
		cancel()
		waiters.Wait()
	}
	if err := ctx.Err(); err != nil {
		return ThreadResults{}, err
	}
	result := ThreadResults{Threads: make([]Job, 0, len(refs)), Errors: make(map[string]string)}
	for _, ref := range refs {
		snapshot, err := m.Status(ref)
		if err == nil {
			if job, activeErr := m.job(snapshot.ID); activeErr == nil {
				snapshot, err = m.turnResult(ctx, job)
			} else {
				state := snapshot.State
				snapshot, err = m.restoreTurnResult(ctx, snapshot)
				snapshot.State = state
			}
		}
		if err != nil {
			result.Errors[ref] = err.Error()
			continue
		}
		result.Threads = append(result.Threads, snapshot)
	}
	return result, nil
}

func (m *Manager) waitForThread(ctx context.Context, ref string) {
	job, err := m.job(ref)
	if err != nil {
		return
	}
	events := m.Events.Subscribe(ctx, job.ID)
	for {
		snapshot := job.hydrationView()
		if (snapshot.State != StateStarting && snapshot.State != StateRunning) || len(snapshot.Permissions) > 0 {
			return
		}
		select {
		case <-ctx.Done():
			return
		case _, open := <-events:
			if !open {
				if ctx.Err() != nil {
					return
				}
				events = m.Events.Subscribe(ctx, job.ID)
			}
		}
	}
}
