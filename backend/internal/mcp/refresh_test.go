package mcp

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/charmbracelet/log"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wins/jaz/backend/internal/mcpconfig"
	"github.com/wins/jaz/backend/internal/tools"
)

func TestProxyRefreshPreservesSessionAndActiveCalls(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	entered := make(chan struct{})
	release := make(chan struct{})
	remote := mcpsdk.NewServer(&mcpsdk.Implementation{Name: "remote"}, nil)
	remote.AddTool(&mcpsdk.Tool{Name: "echo", InputSchema: map[string]any{"type": "object"}}, func(ctx context.Context, req *mcpsdk.CallToolRequest) (*mcpsdk.CallToolResult, error) {
		close(entered)
		select {
		case <-release:
			return &mcpsdk.CallToolResult{Content: []mcpsdk.Content{&mcpsdk.TextContent{Text: "finished"}}}, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	})
	upstream := httptest.NewServer(mcpsdk.NewStreamableHTTPHandler(func(*http.Request) *mcpsdk.Server { return remote }, nil))
	defer upstream.Close()
	store := &testStore{}
	manager := NewManager(store, nil, tools.NewRegistry(), log.New(io.Discard))
	defer manager.Close()
	handler := manager.Handler()
	subscribed := make(chan struct{})
	var once sync.Once
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			once.Do(func() { close(subscribed) })
		}
		handler.ServeHTTP(w, r)
	}))
	defer proxy.Close()
	changed := make(chan struct{}, 10)
	client := mcpsdk.NewClient(&mcpsdk.Implementation{Name: "test"}, &mcpsdk.ClientOptions{
		ToolListChangedHandler: func(context.Context, *mcpsdk.ToolListChangedRequest) { changed <- struct{}{} },
	})
	session, err := client.Connect(ctx, &mcpsdk.StreamableClientTransport{Endpoint: proxy.URL, MaxRetries: -1}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	select {
	case <-subscribed:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	assertTools := func(count int) []*mcpsdk.Tool {
		t.Helper()
		list, err := session.ListTools(ctx, nil)
		if err != nil || len(list.Tools) != count {
			t.Fatalf("tools = %v, error = %v, want %d", list, err, count)
		}
		return list.Tools
	}
	assertTools(0)
	store.servers = []mcpconfig.Server{{ID: "remote", Name: "remote", URL: upstream.URL, Enabled: true}}
	manager.Refresh(ctx)
	select {
	case <-changed:
	case <-ctx.Done():
		t.Fatal("existing client received no tools/list_changed")
	}
	name := assertTools(1)[0].Name
	original := manager.sessions["remote"].serverConnection
	revision := manager.Revision()
	manager.Refresh(ctx)
	manager.RefreshLocal(ctx)
	if manager.sessions["remote"].serverConnection != original || manager.Revision() != revision {
		t.Fatal("unchanged refresh replaced a connection or advanced the catalog")
	}
	store.err = errors.New("configuration unavailable")
	manager.Refresh(ctx)
	store.err = nil
	assertTools(1)
	if manager.sessions["remote"].serverConnection != original || manager.Revision() != revision {
		t.Fatal("failed configuration read changed the live catalog")
	}
	result := make(chan error, 1)
	go func() {
		response, err := session.CallTool(ctx, &mcpsdk.CallToolParams{Name: name})
		if err == nil && (response.IsError || len(response.Content) != 1) {
			err = io.ErrUnexpectedEOF
		}
		result <- err
	}()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	store.servers[0].Headers = []mcpconfig.Header{{Name: "X-Revision", Value: "2"}}
	manager.Refresh(ctx)
	if manager.sessions["remote"].serverConnection == original {
		t.Fatal("changed configuration reused old connection")
	}
	close(release)
	if err := <-result; err != nil {
		t.Fatalf("refresh interrupted active call: %v", err)
	}
	remote.AddTool(&mcpsdk.Tool{Name: "echo", Description: "updated", InputSchema: map[string]any{"type": "object", "required": []string{"value"}, "properties": map[string]any{"value": map[string]any{"type": "string"}}}}, func(context.Context, *mcpsdk.CallToolRequest) (*mcpsdk.CallToolResult, error) {
		return &mcpsdk.CallToolResult{Content: []mcpsdk.Content{&mcpsdk.TextContent{Text: "updated"}}}, nil
	})
	manager.Refresh(ctx)
	if updated := assertTools(1)[0]; updated.Description != "MCP tool from remote: updated" {
		t.Fatalf("stale definition: %+v", updated)
	}
	response, err := session.CallTool(ctx, &mcpsdk.CallToolParams{Name: name, Arguments: map[string]any{"value": "ok"}})
	if err != nil || response.IsError {
		t.Fatalf("updated callback failed: %v, %v", response, err)
	}
	store.servers = nil
	manager.Refresh(ctx)
	assertTools(0)
	if _, err := session.CallTool(ctx, &mcpsdk.CallToolParams{Name: name}); err == nil {
		t.Fatal("removed tool remained callable")
	}
}
