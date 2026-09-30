package acp

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/wins/jaz/backend/internal/sessionevents"
	"github.com/wins/jaz/backend/internal/storage"
)

// SwitchAgent moves an idle ACP thread to another agent with that agent's
// default model and effort. The old agent's process is retired and the next
// turn starts a new native session, which keeps no memory of the earlier
// conversation while the Jaz transcript stays. An agent_switch event records
// the move, so resuming knows a fresh native session is intended.
func (m *Manager) SwitchAgent(_ context.Context, sessionID, agent string) error {
	m.resumeMu.Lock()
	defer m.resumeMu.Unlock()
	if job, err := m.job(sessionID); err == nil && job.turnDone() != nil {
		return errors.New("wait for the active turn before switching agent")
	}
	session, err := m.store.LoadSession(sessionID)
	if err != nil {
		return err
	}
	if session.Runtime != storage.RuntimeACP || session.RuntimeRef == nil {
		return fmt.Errorf("session %s is not acp-backed", sessionID)
	}
	req, cfg, effort, err := m.spawnConfig(SpawnRequest{
		ACPAgent:        agent,
		SourceType:      session.SourceType,
		ArtifactSurface: session.RuntimeRef.ArtifactSurface,
		MCPServerPolicy: session.RuntimeRef.MCPServerPolicy,
	})
	if err != nil {
		return err
	}
	if req.ACPAgent == CanonicalAgentName(session.RuntimeRef.Agent) {
		return nil
	}
	m.teardown(sessionID)
	session.RuntimeRef.Agent = req.ACPAgent
	session.RuntimeRef.SessionID = ""
	session.ModelProvider = sessionModelProvider(req.ACPAgent, cfg)
	session.Model = strings.TrimSpace(cfg.Model)
	session.ReasoningEffort = effort
	if err := m.store.SaveSession(session); err != nil {
		return err
	}
	events := []sessionevents.Event{{SessionID: sessionID, Type: sessionevents.TypeAgentSwitch, Content: req.ACPAgent, At: time.Now().UTC()}}
	if err := m.store.AppendSessionEvents(sessionID, events...); err != nil {
		return err
	}
	if m.Events != nil {
		m.Events.Publish(events[0])
	}
	m.publishSessionChanged(sessionID)
	m.log.Info("switched agent", "session", sessionID, "agent", req.ACPAgent)
	return nil
}
