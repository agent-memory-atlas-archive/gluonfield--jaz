package acp

import (
	"context"
	"errors"
	"fmt"
	"time"
)

func (m *Manager) RunWorker(ctx context.Context, req SpawnRequest, message string) (job Job, err error) {
	spawned, err := m.Spawn(ctx, req)
	if err != nil {
		return Job{}, err
	}
	active := true
	defer func() {
		if active {
			cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
			defer cancel()
			_, cancelErr := m.Cancel(cleanup, spawned.SessionID)
			err = errors.Join(err, cancelErr)
		}
		m.teardown(spawned.SessionID)
	}()
	if _, err := m.Send(ctx, SendRequest{Session: spawned.SessionID, Message: message, Completion: CompletionInline}); err != nil {
		return Job{}, err
	}
	job, err = m.Wait(ctx, WaitRequest{Session: spawned.SessionID})
	if err != nil {
		return job, err
	}
	if job.State == StateRunning || job.State == StateStarting {
		return job, errors.New("worker timed out")
	}
	active = false
	if job.State != StateIdle {
		return job, fmt.Errorf("worker ended %s: %s", job.State, job.Error)
	}
	return job, nil
}
