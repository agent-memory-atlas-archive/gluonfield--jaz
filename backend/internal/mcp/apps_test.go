package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/charmbracelet/log"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	mcpconfig "github.com/wins/jaz/backend/internal/mcpconfig"
	"github.com/wins/jaz/backend/internal/tools"
)

type appQueryInput struct {
	Query string `json:"query"`
}

func TestManagerServesPinnedMCPApp(t *testing.T) {
	remote := mcpsdk.NewServer(&mcpsdk.Implementation{
		Name:    "tasks",
		Version: "1.0.0",
		Icons:   []mcpsdk.Icon{{Source: "data:image/svg+xml;base64,PHN2Zy8+", MIMEType: "image/svg+xml"}},
	}, nil)
	remote.AddResource(&mcpsdk.Resource{URI: "ui://tasks/app", Name: "Tasks", MIMEType: AppMIMEType}, func(context.Context, *mcpsdk.ReadResourceRequest) (*mcpsdk.ReadResourceResult, error) {
		return &mcpsdk.ReadResourceResult{Contents: []*mcpsdk.ResourceContents{{URI: "ui://tasks/app", MIMEType: AppMIMEType, Text: "<div id=app></div>"}}}, nil
	})
	answer := func(ctx context.Context, req *mcpsdk.CallToolRequest, input appQueryInput) (*mcpsdk.CallToolResult, any, error) {
		return &mcpsdk.CallToolResult{Content: []mcpsdk.Content{&mcpsdk.TextContent{Text: req.Params.Name + ":" + input.Query}}}, nil, nil
	}
	mcpsdk.AddTool(remote, &mcpsdk.Tool{Name: "search", Meta: mcpsdk.Meta{"ui": map[string]any{"resourceUri": "ui://tasks/app"}}}, answer)
	mcpsdk.AddTool(remote, &mcpsdk.Tool{Name: "graphql", Meta: mcpsdk.Meta{"ui": map[string]any{"visibility": []string{"app"}}}}, answer)
	mcpsdk.AddTool(remote, &mcpsdk.Tool{Name: "admin", Meta: mcpsdk.Meta{"ui": map[string]any{"visibility": []string{"model"}}}}, answer)
	httpServer := httptest.NewServer(mcpsdk.NewStreamableHTTPHandler(func(*http.Request) *mcpsdk.Server {
		return remote
	}, &mcpsdk.StreamableHTTPOptions{JSONResponse: true}))
	defer httpServer.Close()

	store := &testStore{servers: []mcpconfig.Server{{
		ID:        "srv1",
		Name:      "Tasks",
		Transport: mcpconfig.TransportStreamableHTTP,
		URL:       httpServer.URL,
		Enabled:   true,
		ShowInUI:  true,
	}}}
	registry := tools.NewRegistry()
	manager := NewManager(store, nil, registry, log.New(io.Discard))
	defer manager.Close()
	early, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if apps, err := manager.Apps(early); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Apps before the first refresh = %#v, %v; want it to wait", apps, err)
	}
	manager.Refresh(context.Background())

	var agentTools []string
	for _, def := range registry.Definitions() {
		agentTools = append(agentTools, tools.DefinitionName(def))
	}
	if got := strings.Join(agentTools, ","); strings.Contains(got, "graphql") || !strings.Contains(got, "search") || !strings.Contains(got, "admin") {
		t.Fatalf("agent tools = %s, want search and admin without the app-only graphql", got)
	}

	apps, err := manager.Apps(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(apps) != 1 || apps[0].ServerID != "srv1" || apps[0].Name != "Tasks" || apps[0].Icon != "data:image/svg+xml;base64,PHN2Zy8+" {
		t.Fatalf("apps = %#v", apps)
	}
	html, err := manager.ReadApp(context.Background(), "srv1")
	if err != nil || html != "<div id=app></div>" {
		t.Fatalf("ReadApp = %q, %v", html, err)
	}

	result, err := manager.CallAppTool(context.Background(), "srv1", "graphql", json.RawMessage(`{"query":"{ viewer { id } }"}`))
	if err != nil {
		t.Fatal(err)
	}
	if text := result.Content[0].(*mcpsdk.TextContent).Text; text != "graphql:{ viewer { id } }" {
		t.Fatalf("app tool result = %q", text)
	}
	if _, err := manager.CallAppTool(context.Background(), "srv1", "admin", nil); !errors.Is(err, ErrAppToolDenied) {
		t.Fatalf("app calling a model-only tool: err = %v", err)
	}

	store.servers[0].ShowInUI = false
	if apps, _ := manager.Apps(context.Background()); len(apps) != 0 {
		t.Fatalf("unpinned server still listed: %#v", apps)
	}
	if _, err := manager.ReadApp(context.Background(), "missing"); err != ErrAppNotFound {
		t.Fatalf("ReadApp(missing) err = %v", err)
	}
}
