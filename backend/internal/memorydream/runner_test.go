package memorydream

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gluonfield/jazmem/pkg/jazmem"
	"github.com/wins/jaz/backend/internal/acp"
	"github.com/wins/jaz/backend/internal/modelcatalog"
	"github.com/wins/jaz/backend/internal/provider"
	jazsettings "github.com/wins/jaz/backend/internal/settings"
	"github.com/wins/jaz/backend/internal/sourcequeue"
	sqlitestore "github.com/wins/jaz/backend/internal/storage/sqlite"
)

type fakeManager struct {
	spawn     acp.SpawnRequest
	job       acp.Job
	send      acp.SendRequest
	finish    func()
	waitErr   error
	cancelled bool
}

func (f *fakeManager) Spawn(_ context.Context, req acp.SpawnRequest) (acp.SpawnResult, error) {
	f.spawn = req
	return acp.SpawnResult{SessionID: "dream-session"}, nil
}

func (f *fakeManager) Send(_ context.Context, req acp.SendRequest) (acp.Job, error) {
	f.send = req
	return acp.Job{State: acp.StateRunning}, nil
}

func (f *fakeManager) Wait(context.Context, acp.WaitRequest) (acp.Job, error) {
	if f.finish != nil {
		f.finish()
	}
	return f.job, f.waitErr
}

func (f *fakeManager) Cancel(context.Context, string) (acp.Job, error) {
	f.cancelled = true
	return acp.Job{State: acp.StateCancelled}, nil
}

func TestAgentPromptIncludesLongTermPromotionBar(t *testing.T) {
	prompt, err := agentPrompt(jazmem.DreamRequest{
		Root: "/tmp/memory",
		Date: time.Date(2026, 6, 17, 9, 0, 0, 0, time.UTC),
	}, "dreams/runs/test", "dreams/review/test", "/tmp/processed.json", nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"LONG_TERM.md is profile memory",
		"routine coding style",
		"feature decisions",
		"weak one-off contacts",
		"SHORT_TERM.md is the active working set",
		"active working set at or below 5,000 characters",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("agent prompt missing %q:\n%s", want, prompt)
		}
	}
}

func TestRunDreamSpawnsCompatibleWorkerModelAndEffort(t *testing.T) {
	cases := []struct {
		name     string
		agent    string
		defaults jazsettings.AgentDefaults
		model    string
		effort   string
	}{
		{name: "codex", agent: acp.AgentCodex, model: acp.CodexOpenAIDefaultModel, effort: "xhigh"},
		{name: "claude", agent: acp.AgentClaude, model: "default", effort: "xhigh"},
		{name: "grok", agent: acp.AgentGrok, model: modelcatalog.DefaultGrokModel},
		{name: "opencode-openrouter-style", agent: acp.AgentOpenCode, defaults: jazsettings.AgentDefaults{ACP: map[string]jazsettings.ACPAgentDefaults{
			acp.AgentOpenCode: {ModelProvider: provider.ProviderOpenRouter},
		}}, model: "z-ai/glm-5.2", effort: "xhigh"},
		{name: "opencode-openai", agent: acp.AgentOpenCode, defaults: jazsettings.AgentDefaults{ACP: map[string]jazsettings.ACPAgentDefaults{
			acp.AgentOpenCode: {ModelProvider: provider.ProviderOpenAI},
		}}, model: "gpt-5.4-mini", effort: "xhigh"},
		{name: "opencode-ollama", agent: acp.AgentOpenCode, defaults: jazsettings.AgentDefaults{ACP: map[string]jazsettings.ACPAgentDefaults{
			acp.AgentOpenCode: {ModelProvider: provider.ProviderOllama},
		}}},
		{name: "opencode-custom-provider", agent: acp.AgentOpenCode, defaults: jazsettings.AgentDefaults{ACP: map[string]jazsettings.ACPAgentDefaults{
			acp.AgentOpenCode: {ModelProvider: "internal"},
		}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := newStore(t)
			if tc.defaults.ACP != nil {
				if _, err := jazsettings.SaveAgentDefaults(store, tc.defaults); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := jazsettings.SaveMemorySettings(store, jazsettings.MemorySettings{
				Enabled: true,
				Agent:   tc.agent,
			}); err != nil {
				t.Fatal(err)
			}
			manager := &fakeManager{job: acp.Job{State: acp.StateIdle, Assistant: "done"}}
			root := t.TempDir()
			manager.finish = func() { finishDream(t, manager, "[]", true) }
			runner := New(store, manager, sourcequeue.New(root))

			_, err := runner.RunDream(context.Background(), jazmem.DreamRequest{
				Root: root,
				Date: time.Date(2026, 6, 22, 0, 0, 0, 0, time.UTC),
			})
			if err != nil {
				t.Fatal(err)
			}
			if manager.spawn.ACPAgent != tc.agent || manager.spawn.Model != tc.model || manager.spawn.ReasoningEffort != tc.effort {
				t.Fatalf("spawn = agent %q model %q effort %q, want %q/%q/%q",
					manager.spawn.ACPAgent,
					manager.spawn.Model,
					manager.spawn.ReasoningEffort,
					tc.agent,
					tc.model,
					tc.effort,
				)
			}
		})
	}
}

func TestRunDreamTaskWithoutMemoryAgentDoesNotFallBackToOpenRouter(t *testing.T) {
	store := newStore(t)
	root := t.TempDir()
	memory, err := jazmem.Open(jazmem.Config{
		Root:   root,
		DBPath: filepath.Join(t.TempDir(), "index.sqlite"),
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = memory.Close() })
	memory.SetDreamRunner(New(store, &fakeManager{}, sourcequeue.New(root)))

	_, err = memory.RunDreamTask(context.Background(), jazmem.DreamOptions{})
	if err == nil {
		t.Fatal("expected missing memory agent error")
	}
	if !strings.Contains(err.Error(), "memory agent is not configured") {
		t.Fatalf("unexpected error: %v", err)
	}
	if strings.Contains(err.Error(), "OPENROUTER") {
		t.Fatalf("dream fell through to provider-backed fallback: %v", err)
	}
}

func finishDream(t *testing.T, manager *fakeManager, receipt string, report bool) {
	t.Helper()
	root, suffix := manager.spawn.Directory, manager.spawn.SourceID
	if report {
		file := filepath.Join(root, "dreams", "runs", suffix+".md")
		if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte("# Consolidation\n\nChecked the supplied sources."), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if receipt != "" {
		file := filepath.Join(root, ".state", "consolidation", suffix+".json")
		if !strings.Contains(manager.send.Message, file) {
			t.Fatal("worker was not told where to acknowledge processed sources")
		}
		if err := os.WriteFile(file, []byte(receipt), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestConsolidationPreservesUnfinishedAndConcurrentSourceUpdates(t *testing.T) {
	store := newStore(t)
	if _, err := jazsettings.SaveMemorySettings(store, jazsettings.MemorySettings{Enabled: true, Agent: acp.AgentCodex}); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	queue := sourcequeue.New(root)
	now := time.Now().UTC()
	for _, path := range []string{"sources/first.md", "sources/second.md"} {
		if err := queue.MarkPendingSource(t.Context(), sourcequeue.Source{Path: path, PendingAt: now}); err != nil {
			t.Fatal(err)
		}
	}
	manager := &fakeManager{job: acp.Job{State: acp.StateIdle}}
	manager.finish = func() {
		for _, path := range []string{"sources/first.md", "sources/second.md"} {
			if !strings.Contains(manager.send.Message, path) {
				t.Fatalf("worker missing queued source %s", path)
			}
		}
		if err := queue.MarkPendingSource(t.Context(), sourcequeue.Source{Path: "sources/first.md", PendingAt: now.Add(time.Minute)}); err != nil {
			t.Fatal(err)
		}
		finishDream(t, manager, `["sources/first.md"]`, true)
	}
	result, err := New(store, manager, queue).RunDream(t.Context(), jazmem.DreamRequest{Root: root})
	if err != nil || len(result.Warnings) != 1 {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	stats, err := queue.Stats(t.Context())
	if err != nil || stats.Pending != 2 || stats.Processing != 0 {
		t.Fatalf("queue=%#v err=%v", stats, err)
	}
	reserved, err := queue.Reserve(t.Context(), 10)
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range reserved {
		if source.Path == "sources/first.md" && !source.PendingAt.Equal(now.Add(time.Minute)) {
			t.Fatal("newer source revision was lost")
		}
	}
}

func TestConsolidationRequiresAcknowledgedWork(t *testing.T) {
	for _, tc := range []struct {
		name    string
		receipt string
		report  bool
		state   string
	}{
		{"missing report", `["sources/a.md"]`, false, acp.StateIdle},
		{"missing receipt", "", true, acp.StateIdle},
		{"malformed receipt", "{", true, acp.StateIdle},
		{"null receipt", "null", true, acp.StateIdle},
		{"unreserved source", `["sources/other.md"]`, true, acp.StateIdle},
		{"duplicate source", `["sources/a.md","sources/a.md"]`, true, acp.StateIdle},
		{"failed worker", `["sources/a.md"]`, true, acp.StateFailed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := newStore(t)
			if _, err := jazsettings.SaveMemorySettings(store, jazsettings.MemorySettings{Enabled: true, Agent: acp.AgentCodex}); err != nil {
				t.Fatal(err)
			}
			root := t.TempDir()
			queue := sourcequeue.New(root)
			if err := queue.MarkPendingSource(t.Context(), sourcequeue.Source{Path: "sources/a.md"}); err != nil {
				t.Fatal(err)
			}
			manager := &fakeManager{job: acp.Job{State: tc.state}}
			manager.finish = func() { finishDream(t, manager, tc.receipt, tc.report) }
			if _, err := New(store, manager, queue).RunDream(t.Context(), jazmem.DreamRequest{Root: root}); err == nil {
				t.Fatal("expected incomplete run to fail")
			}
			stats, err := queue.Stats(t.Context())
			if err != nil || stats.Pending != 1 || stats.Processing != 0 {
				t.Fatalf("queue=%#v err=%v", stats, err)
			}
		})
	}
}

func TestConsolidationSettlesOnlyAfterWorkerStops(t *testing.T) {
	for _, tc := range []struct {
		name    string
		state   string
		waitErr error
		pending int
	}{
		{"completed", acp.StateIdle, nil, 0},
		{"timed out", acp.StateRunning, nil, 1},
		{"cancelled wait", acp.StateRunning, context.Canceled, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := newStore(t)
			if _, err := jazsettings.SaveMemorySettings(store, jazsettings.MemorySettings{Enabled: true, Agent: acp.AgentCodex}); err != nil {
				t.Fatal(err)
			}
			root := t.TempDir()
			queue := sourcequeue.New(root)
			if err := queue.MarkPendingSource(t.Context(), sourcequeue.Source{Path: "sources/a.md"}); err != nil {
				t.Fatal(err)
			}
			manager := &fakeManager{job: acp.Job{State: tc.state}, waitErr: tc.waitErr}
			manager.finish = func() {
				finishDream(t, manager, `["sources/a.md"]`, true)
			}
			_, err := New(store, manager, queue).RunDream(t.Context(), jazmem.DreamRequest{Root: root})
			if (err != nil) != (tc.pending > 0) || manager.cancelled != (tc.pending > 0) {
				t.Fatalf("err=%v cancelled=%v", err, manager.cancelled)
			}
			stats, err := queue.Stats(t.Context())
			if err != nil || stats.Pending != tc.pending || stats.Processing != 0 {
				t.Fatalf("queue=%#v err=%v", stats, err)
			}
		})
	}
}

func newStore(t *testing.T) *sqlitestore.Store {
	t.Helper()
	store, err := sqlitestore.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}
