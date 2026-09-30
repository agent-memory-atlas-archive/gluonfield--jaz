package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
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

func TestManagerServesMCPAppEntrypoints(t *testing.T) {
	remote := mcpsdk.NewServer(&mcpsdk.Implementation{
		Name:    "tasks",
		Version: "1.0.0",
		Icons:   []mcpsdk.Icon{{Source: "data:image/svg+xml;base64,PHN2Zy8+", MIMEType: "image/svg+xml"}},
	}, nil)
	for _, uri := range []string{"ui://tasks/app", "ui://tasks/tray", "ui://tasks/viewer"} {
		remote.AddResource(&mcpsdk.Resource{URI: uri, Name: uri, MIMEType: AppMIMEType}, func(_ context.Context, req *mcpsdk.ReadResourceRequest) (*mcpsdk.ReadResourceResult, error) {
			return &mcpsdk.ReadResourceResult{Contents: []*mcpsdk.ResourceContents{{URI: req.Params.URI, MIMEType: AppMIMEType, Text: "<div id=" + req.Params.URI + "></div>"}}}, nil
		})
	}
	answer := func(ctx context.Context, req *mcpsdk.CallToolRequest, input appQueryInput) (*mcpsdk.CallToolResult, any, error) {
		return &mcpsdk.CallToolResult{Content: []mcpsdk.Content{&mcpsdk.TextContent{Text: req.Params.Name + ":" + input.Query}}}, nil, nil
	}
	entry := func(uri string, entrypoints ...map[string]any) mcpsdk.Meta {
		list := make([]any, len(entrypoints))
		for i, e := range entrypoints {
			list[i] = e
		}
		return mcpsdk.Meta{"ui": map[string]any{"resourceUri": uri}, "openai/ui": map[string]any{"entrypoints": list}}
	}
	mcpsdk.AddTool(remote, &mcpsdk.Tool{Name: "library", Title: "Library", Meta: entry("ui://tasks/app", map[string]any{"type": "global"})}, answer)
	tray := entry("ui://tasks/tray", map[string]any{"type": "thread"})
	tray["ui"] = map[string]any{"resourceUri": "ui://tasks/tray", "visibility": []string{"model"}}
	mcpsdk.AddTool(remote, &mcpsdk.Tool{Name: "tray", Annotations: &mcpsdk.ToolAnnotations{Title: "Tray"}, Meta: tray}, answer)
	mcpsdk.AddTool(remote, &mcpsdk.Tool{Name: "viewer", Meta: entry("ui://tasks/viewer", map[string]any{"type": "file", "extensions": []string{".STL", "step"}}, map[string]any{"type": "sidebar"})}, answer)
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
	}}}
	registry := tools.NewRegistry()
	manager := NewManager(store, nil, registry, log.New(io.Discard))
	defer manager.Close()
	early, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if points, err := manager.Entrypoints(early); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Entrypoints before the first refresh = %#v, %v; want it to wait", points, err)
	}
	manager.Refresh(context.Background())

	var agentTools []string
	for _, def := range registry.Definitions() {
		agentTools = append(agentTools, tools.DefinitionName(def))
	}
	if got := strings.Join(agentTools, ","); strings.Contains(got, "graphql") || !strings.Contains(got, "search") || !strings.Contains(got, "admin") {
		t.Fatalf("agent tools = %s, want search and admin without the app-only graphql", got)
	}

	icon := "data:image/svg+xml;base64,PHN2Zy8+"
	want := []Entrypoint{
		{ServerID: "srv1", Tool: "library", Type: "global", Title: "Library", Icon: icon},
		{ServerID: "srv1", Tool: "tray", Type: "thread", Title: "Tray", Icon: icon},
		{ServerID: "srv1", Tool: "viewer", Type: "file", Title: "viewer", Icon: icon, Extensions: []string{".stl"}},
	}
	points, err := manager.Entrypoints(context.Background())
	if err != nil || !reflect.DeepEqual(points, want) {
		t.Fatalf("entrypoints = %#v, %v\nwant %#v", points, err, want)
	}
	for tool, doc := range map[string]string{"library": "<div id=ui://tasks/app></div>", "tray": "<div id=ui://tasks/tray></div>", "search": "<div id=ui://tasks/app></div>"} {
		if html, err := manager.ReadApp(context.Background(), "srv1", tool); err != nil || html != doc {
			t.Fatalf("ReadApp(%s) = %q, %v", tool, html, err)
		}
	}
	if _, err := manager.ReadApp(context.Background(), "srv1", "admin"); err != ErrAppNotFound {
		t.Fatalf("ReadApp(admin) err = %v", err)
	}

	for _, tool := range []string{"graphql", "tray", "library"} {
		result, err := manager.CallAppTool(context.Background(), "srv1", tool, json.RawMessage(`{"query":"q"}`), nil)
		if err != nil || result.Content[0].(*mcpsdk.TextContent).Text != tool+":q" {
			t.Fatalf("app calling %s: %+v %v", tool, result, err)
		}
	}
	if _, err := manager.CallAppTool(context.Background(), "srv1", "admin", nil, nil); !errors.Is(err, ErrAppToolDenied) {
		t.Fatalf("app calling a model-only tool: err = %v", err)
	}

	if _, err := manager.ReadApp(context.Background(), "missing", "library"); err != ErrAppNotFound {
		t.Fatalf("ReadApp(missing) err = %v", err)
	}
}
