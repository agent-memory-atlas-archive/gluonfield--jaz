package acp_test

import (
	"context"
	"testing"
	"time"

	"github.com/wins/jaz/backend/internal/acp"
	"github.com/wins/jaz/backend/internal/memorysearch"
	"github.com/wins/jaz/backend/internal/memoryservice"
	"github.com/wins/jaz/backend/internal/settings"
	"github.com/wins/jaz/backend/internal/storage"
	sqlitestore "github.com/wins/jaz/backend/internal/storage/sqlite"
	"github.com/wins/jaz/backend/internal/usage"
)

func TestMemoryWorkerUsageIsSeparateFromParent(t *testing.T) {
	for _, source := range []string{"", storage.SourceLoopRun} {
		t.Run(source, func(t *testing.T) {
			store, err := sqlitestore.New(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = store.Close() })
			const agent = "local_helper"
			if _, err := settings.SaveMemorySettings(store, settings.MemorySettings{Enabled: true, Agent: agent}); err != nil {
				t.Fatal(err)
			}
			parent, err := store.CreateSession(storage.CreateSession{Slug: "parent", Runtime: storage.RuntimeACP, SourceType: source})
			if err != nil {
				t.Fatal(err)
			}
			if err := store.AddUsage(parent.ID, storage.Usage{InputTokens: 1100, CachedInputTokens: 1000, OutputTokens: 40}); err != nil {
				t.Fatal(err)
			}
			manager := acp.NewManager(store, acp.Config{
				Root:      t.TempDir(),
				Workspace: t.TempDir(),
				Agents:    map[string]acp.AgentConfig{agent: {Local: true}},
			}, nil)
			t.Cleanup(manager.Close)
			seen := make(chan acp.LocalAgentRequest, 1)
			manager.RegisterLocalAgent(agent, localRunner{seen: seen})
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			answer, err := memorysearch.New(store, manager).SearchMemory(ctx, memoryservice.SearchRequest{
				Query: "Jaz", Limit: 5, ParentID: parent.ID,
			})
			if err != nil || answer != "local reply" {
				t.Fatalf("answer = %q, error = %v", answer, err)
			}
			req := <-seen
			if req.Session.ParentID != parent.ID || req.Session.SourceType != storage.SourceMemorySearch || req.Session.RuntimeRef.MCPServerPolicy != acp.MCPServerPolicyMemorySearchWorker {
				t.Fatalf("worker session = %#v", req.Session)
			}
			if len(manager.List()) != 0 {
				t.Fatal("finished worker is still registered")
			}
			loaded, err := store.LoadSession(parent.ID)
			if err != nil || loaded.Usage.InputTokens != 1100 || loaded.Usage.CachedInputTokens != 1000 || loaded.Usage.OutputTokens != 40 {
				t.Fatalf("parent usage = %#v, %v", loaded.Usage, err)
			}
			days, err := usage.NewService(store).Daily(usage.DailyQuery{Days: 1, Location: time.UTC})
			if err != nil {
				t.Fatal(err)
			}
			categories := map[string]int64{}
			for _, category := range days[0].Categories {
				categories[category.Category] = category.Usage.InputOutputTokens()
			}
			parentCategory := source
			if parentCategory == "" {
				parentCategory = usage.CategoryChat
			}
			if len(categories) != 2 || categories[parentCategory] != 140 || categories[storage.SourceMemorySearch] != 8 || days[0].Usage.InputOutputTokens() != 148 {
				t.Fatalf("daily usage = %#v", days[0])
			}
		})
	}
}
