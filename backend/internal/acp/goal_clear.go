package acp

import "context"

func (m *Manager) ClearGoal(_ context.Context, ref string) error {
	job, err := m.job(ref)
	if err == nil {
		job.sendMu.Lock()
		defer job.sendMu.Unlock()
		job.mu.Lock()
		defer job.mu.Unlock()
	}
	session, err := m.store.LoadSession(ref)
	if err != nil {
		return err
	}
	event, err := m.store.UpdateSessionGoal(session.ID, nil, nil)
	if err != nil {
		return err
	}
	if job != nil {
		job.UpdatedAt = event.At
		job.LastEventAt = event.At
		if job.turn != nil {
			job.turn.goalRequested = false
		}
	}
	if m.Events != nil {
		m.Events.Publish(event)
	}
	return nil
}

func (m *Manager) publishGoalClear(job *jobState) {
	if err := m.ClearGoal(context.Background(), job.ID); err != nil {
		m.log.Error("clear goal failed", "session", job.ID, "error", err)
	}
}
