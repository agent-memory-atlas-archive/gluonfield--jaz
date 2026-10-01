package acp

import (
	"errors"
	"fmt"
	"strings"

	"github.com/wins/jaz/backend/internal/promptmodule"
	"github.com/wins/jaz/backend/internal/provider"
	"github.com/wins/jaz/backend/internal/storage"
	"github.com/wins/jaz/backend/internal/visualize"
)

func (m *Manager) spawnConfig(req SpawnRequest) (SpawnRequest, AgentConfig, string, error) {
	req.ACPAgent = CanonicalAgentName(req.ACPAgent)
	req.Directory = strings.TrimSpace(req.Directory)
	if req.ACPAgent == "" {
		agent, err := m.defaultSpawnAgent()
		if err != nil {
			return SpawnRequest{}, AgentConfig{}, "", err
		}
		req.ACPAgent = agent
	}
	if req.ACPAgent == AgentJaz {
		return SpawnRequest{}, AgentConfig{}, "", fmt.Errorf("acp agent %q is not selectable", req.ACPAgent)
	}
	req.ArtifactSurface = strings.TrimSpace(req.ArtifactSurface)
	req.MCPServerPolicy = strings.TrimSpace(req.MCPServerPolicy)
	req.SystemPromptExtensions = promptmodule.New(req.SystemPromptExtensions...)
	if req.MCPServerPolicy == "" {
		req.MCPServerPolicy = mcpServerPolicyForSourceType(req.SourceType)
	}
	if req.MCPServerPolicy == "" && visualize.NormalizeSurface(req.ArtifactSurface) == visualize.SurfaceWidget {
		req.MCPServerPolicy = MCPServerPolicyWidget
	}
	cfg, ok, err := m.configuredAgent(req.ACPAgent)
	if err != nil {
		return SpawnRequest{}, AgentConfig{}, "", err
	}
	if !ok {
		return SpawnRequest{}, AgentConfig{}, "", fmt.Errorf("acp agent %q is not configured", req.ACPAgent)
	}
	if err := validateAgentLaunch(req.ACPAgent, cfg); err != nil {
		return SpawnRequest{}, AgentConfig{}, "", err
	}
	effort := configuredAgentReasoningEffort(req.ACPAgent, cfg.ReasoningEffort)
	if req.ReasoningEffort != "" {
		effort = configuredAgentReasoningEffort(req.ACPAgent, req.ReasoningEffort)
	}
	model := strings.TrimSpace(req.Model)
	modelOverridden := model != ""
	if modelOverridden {
		cfg.Model = model
	}
	if providerID := strings.TrimSpace(req.ModelProvider); providerID != "" {
		if !modelOverridden && providerID != strings.TrimSpace(cfg.ModelProvider) && cfg.UsesProvider() {
			cfg.Model = agentProviderDefaultModel(req.ACPAgent, providerID, m.providers())
		}
		cfg.ModelProvider = providerID
	}
	cfg = cfg.NormalizeProviderModel(cfg.ModelProvider)
	if err := m.validateAgentModelProvider(req.ACPAgent, cfg); err != nil {
		return SpawnRequest{}, AgentConfig{}, "", err
	}
	if strings.EqualFold(strings.TrimSpace(req.ReasoningEffort), "none") && agentPolicyForAgent(req.ACPAgent).effortEncodedInModel(cfg.Model) {
		cfg.Model = strings.TrimSpace(cfg.Model[:strings.LastIndex(cfg.Model, "/")])
	}
	cfg.Model = m.resolveAgentModelAlias(req.ACPAgent, cfg)
	if m.cfg.ModelCatalog != nil {
		if err := (ModelCapabilities{Catalog: m.cfg.ModelCatalog}).ValidateReasoningEffort(req.ACPAgent, cfg.ModelProvider, cfg.Model, effort); err != nil {
			return SpawnRequest{}, AgentConfig{}, "", err
		}
	}
	cfg.ReasoningEffort = effort
	return req, cfg, effort, nil
}

func (m *Manager) validateAgentModelProvider(agent string, cfg AgentConfig) error {
	capability := strings.TrimSpace(cfg.ModelProviderCapability)
	modelProvider := strings.TrimSpace(cfg.ModelProvider)
	if !cfg.UsesModelProvider() || capability == "" || modelProvider == "" {
		return nil
	}
	if m.agentSupportsModelProvider(agent, cfg, modelProvider) {
		return nil
	}
	return fmt.Errorf("model provider %q does not support %q required by acp agent %q", modelProvider, capability, CanonicalAgentName(agent))
}

// botSubtask makes a thread a bot starts its subtask: it stays out of the
// sidebar, starts in the bot's home and, as Codex and Grok sub-agents do, runs
// on the bot's agent and model unless asked otherwise.
func (m *Manager) botSubtask(req SpawnRequest) (SpawnRequest, error) {
	if req.ParentID == "" || req.SourceType != "" {
		return req, nil
	}
	parent, err := m.store.LoadSession(req.ParentID)
	if errors.Is(err, storage.ErrSessionNotFound) {
		return req, nil
	}
	if err != nil {
		return req, err
	}
	if parent.SourceType != storage.SourceBot || parent.RuntimeRef == nil {
		return req, nil
	}
	req.SourceType, req.SourceID = storage.SourceBotWorker, parent.ID
	if req.Directory == "" && req.Home == "" && !req.Worktree {
		req.Directory = parent.RuntimeRef.Cwd
	}
	if req.ACPAgent != "" && CanonicalAgentName(req.ACPAgent) != parent.RuntimeRef.Agent {
		return req, nil
	}
	req.ACPAgent = parent.RuntimeRef.Agent
	if req.Model == "" && req.ModelProvider == "" {
		req.ModelProvider, req.Model = parent.ModelProvider, parent.Model
		if req.ReasoningEffort == "" {
			req.ReasoningEffort = parent.ReasoningEffort
		}
	}
	return req, nil
}

func (m *Manager) defaultSpawnAgent() (string, error) {
	names, err := m.agents.EnabledAgentNames()
	if err != nil {
		return "", err
	}
	names = SelectableAgentNames(names)
	if len(names) > 0 {
		return names[0], nil
	}
	return "", fmt.Errorf("no selectable acp agent is configured")
}

func agentProviderDefaultModel(agent, id string, providers map[string]provider.ModelProviderConfig) string {
	if CanonicalAgentName(agent) == AgentCodex && codexProviderKeyID(id) == provider.ProviderOpenAI {
		return CodexOpenAIDefaultModel
	}
	return strings.TrimSpace(provider.ResolveModelProvider(id, providers).Meta.DefaultModel)
}

func (m *Manager) createStoredSession(req SpawnRequest, cfg AgentConfig, effort string) (storage.Session, error) {
	return m.store.CreateSession(storage.CreateSession{
		Slug:            req.Slug,
		Title:           req.Title,
		ParentID:        req.ParentID,
		Runtime:         storage.RuntimeACP,
		ModelProvider:   sessionModelProvider(req.ACPAgent, cfg),
		Model:           strings.TrimSpace(cfg.Model),
		ReasoningEffort: effort,
		SourceType:      req.SourceType,
		SourceID:        req.SourceID,
		RuntimeRef: &storage.RuntimeRef{
			Type:            storage.RuntimeACP,
			Agent:           req.ACPAgent,
			ArtifactSurface: req.ArtifactSurface,
			MCPServerPolicy: req.MCPServerPolicy,
		},
	})
}

func sessionModelProvider(agent string, cfg AgentConfig) string {
	if cfg.Local || cfg.UsesProvider() {
		return strings.TrimSpace(cfg.ModelProvider)
	}
	return agent
}
