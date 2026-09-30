package threads

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/wins/jaz/backend/internal/sessionevents"
	"github.com/wins/jaz/backend/internal/storage"
	sqlitestore "github.com/wins/jaz/backend/internal/storage/sqlite"
)

func TestThreadToolsReadAndSearchEventBackedAnswers(t *testing.T) {
	store, err := sqlitestore.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})
	session, err := store.CreateSession(storage.CreateSession{
		Slug: "event-backed", Runtime: storage.RuntimeACP,
		RuntimeRef: &storage.RuntimeRef{Type: storage.RuntimeACP, Agent: "codex"},
	})
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now().Add(-time.Minute)
	if err := store.AppendMessageRecords(session.ID, storage.Message{Role: "user", Content: "What did you find?", CreatedAt: start}); err != nil {
		t.Fatal(err)
	}
	if err := store.AppendSessionEvents(session.ID,
		sessionevents.Event{Type: sessionevents.TypeACPThought, At: start.Add(time.Second), ACP: &sessionevents.ACPEvent{ID: session.ID, Thought: "privatethought"}},
		sessionevents.Event{Type: "acp_tool", At: start.Add(2 * time.Second), ACP: &sessionevents.ACPEvent{ID: session.ID, ToolCalls: []sessionevents.ACPToolCall{{ID: "check", ToolName: "exec", RawOutput: json.RawMessage(`"privatetool"`)}}}},
		sessionevents.Event{Type: sessionevents.TypeACPMessage, At: start.Add(3 * time.Second), Content: "childsecret", ACP: &sessionevents.ACPEvent{ID: "child"}},
		sessionevents.Event{Type: sessionevents.TypeACPMessage, At: start.Add(4 * time.Second), Content: "Warning: Falling back from WebSockets to HTTPS transport.", ACP: &sessionevents.ACPEvent{ID: session.ID}},
		sessionevents.Event{Type: sessionevents.TypeACPMessage, At: start.Add(5 * time.Second), Content: "A qua", ACP: &sessionevents.ACPEvent{ID: session.ID, TextRunID: "message:answer"}},
	); err != nil {
		t.Fatal(err)
	}
	if err := store.AppendSessionEvents(session.ID,
		sessionevents.Event{Type: sessionevents.TypeACPMessage, At: start.Add(6 * time.Second), Content: "rtz result.", ACP: &sessionevents.ACPEvent{ID: session.ID, TextRunID: "message:answer"}},
	); err != nil {
		t.Fatal(err)
	}
	service := NewService(sqlitestore.NewSearchQueries(store), store)
	t.Run("read", func(t *testing.T) {
		_, result, err := service.ContextMCP(t.Context(), nil, ContextRequest{Session: session.ID})
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Messages) != 3 || result.Messages[2].Text != "A quartz result." || result.ToolCounts["exec"] != 1 {
			t.Fatalf("missing agent answer or tool: %#v", result)
		}
		body, err := json.Marshal(result)
		if err != nil {
			t.Fatal(err)
		}
		for _, hidden := range []string{"privatethought", "privatetool", "childsecret", "WebSockets"} {
			if strings.Contains(string(body), hidden) {
				t.Fatalf("read exposed %q", hidden)
			}
		}
		_, earlier, err := service.ContextMCP(t.Context(), nil, ContextRequest{Session: session.ID, BeforeSeq: result.Messages[2].Seq, Limit: 1})
		if err != nil || len(earlier.Messages) != 1 || len(earlier.Messages[0].Tools) != 1 {
			t.Fatalf("paging lost tool message: %#v, %v", earlier, err)
		}
		_, query, err := service.ContextMCP(t.Context(), nil, ContextRequest{Session: session.ID, Query: "quartz", IncludeTools: IncludeToolsNone})
		if err != nil || query.MatchCount != 1 || query.Messages[0].Text != "A quartz result." || query.ToolCounts["exec"] != 1 {
			t.Fatalf("query lost answer or tool count: %#v, %v", query, err)
		}
	})
	t.Run("search", func(t *testing.T) {
		for {
			compaction, err := store.CompactNextSessionEvents(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			if compaction.ThreadID == "" {
				break
			}
		}
		_, result, err := service.SearchMCP(t.Context(), nil, SearchRequest{Query: "quartz"})
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Threads) != 1 || result.Threads[0].ThreadID != session.ID {
			t.Fatalf("missing event-backed search result: %#v", result)
		}
		for _, hidden := range []string{"privatethought", "privatetool", "childsecret", "WebSockets"} {
			_, result, err := service.SearchMCP(t.Context(), nil, SearchRequest{Query: hidden})
			if err != nil || len(result.Threads) != 0 {
				t.Fatalf("search exposed %q: %#v, %v", hidden, result, err)
			}
		}
	})
}
