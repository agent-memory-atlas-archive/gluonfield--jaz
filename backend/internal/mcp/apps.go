package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// AppMIMEType marks an MCP Apps UI resource (the io.modelcontextprotocol/ui
// extension): a self-contained HTML document the host renders in a sandbox.
const AppMIMEType = "text/html;profile=mcp-app"

var (
	ErrAppNotFound   = errors.New("mcp app not found")
	ErrAppToolDenied = errors.New("tool is not available to apps")
)

// Entrypoint is an MCP App a person opens directly rather than through the
// model, as OpenAI's MCP extensions declare in _meta["openai/ui"]: a
// fullscreen app in the sidebar ("global"), a tab in a thread's side panel
// ("thread"), or a viewer for files with the given extensions ("file").
type Entrypoint struct {
	ServerID   string   `json:"server_id"`
	Tool       string   `json:"tool"`
	Type       string   `json:"type"`
	Title      string   `json:"title"`
	Icon       string   `json:"icon,omitempty"`
	Extensions []string `json:"extensions,omitempty"`
}

// serverApps is what a server's tools declare for MCP Apps: the UI resource
// each linked tool opens, its entrypoints, and the tools apps may call.
type serverApps struct {
	uris        map[string]string
	entrypoints []Entrypoint
	callable    map[string]bool
}

func newServerApps() *serverApps {
	return &serverApps{uris: map[string]string{}, callable: map[string]bool{}}
}

// add records what one tool declares. An entrypoint's tool is callable by the
// host whatever its visibility, as opening the entrypoint calls it.
func (a *serverApps) add(tool *mcpsdk.Tool, icon string) {
	_, app, uri := toolUI(tool)
	if app {
		a.callable[tool.Name] = true
	}
	if uri == "" {
		return
	}
	a.uris[tool.Name] = uri
	ui, _ := tool.Meta["openai/ui"].(map[string]any)
	list, _ := ui["entrypoints"].([]any)
	for _, raw := range list {
		entry, _ := raw.(map[string]any)
		kind, _ := entry["type"].(string)
		if kind != "global" && kind != "thread" && kind != "file" {
			continue
		}
		point := Entrypoint{Tool: tool.Name, Type: kind, Title: toolTitle(tool), Icon: icon}
		if kind == "file" {
			for _, ext := range asStrings(entry["extensions"]) {
				if strings.HasPrefix(ext, ".") {
					point.Extensions = append(point.Extensions, strings.ToLower(ext))
				}
			}
			if len(point.Extensions) == 0 {
				continue
			}
		}
		a.entrypoints = append(a.entrypoints, point)
		a.callable[tool.Name] = true
	}
}

func toolTitle(tool *mcpsdk.Tool) string {
	if tool.Title != "" {
		return tool.Title
	}
	if tool.Annotations != nil && tool.Annotations.Title != "" {
		return tool.Annotations.Title
	}
	return tool.Name
}

func asStrings(v any) []string {
	list, _ := v.([]any)
	out := make([]string, 0, len(list))
	for _, item := range list {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// serverIcon is the icon a server publishes in its initialize result.
func serverIcon(init *mcpsdk.InitializeResult) string {
	if init != nil && init.ServerInfo != nil && len(init.ServerInfo.Icons) > 0 {
		return init.ServerInfo.Icons[0].Source
	}
	return ""
}

// toolUI reads a tool's MCP Apps _meta.ui: who may call it (both the model and
// the app when visibility is unset) and the UI resource it opens, if any.
func toolUI(tool *mcpsdk.Tool) (model, app bool, resourceURI string) {
	ui, _ := tool.Meta["ui"].(map[string]any)
	resourceURI, _ = ui["resourceUri"].(string)
	list, ok := ui["visibility"].([]any)
	if !ok {
		return true, true, resourceURI
	}
	for _, audience := range list {
		switch audience {
		case "model":
			model = true
		case "app":
			app = true
		}
	}
	return model, app, resourceURI
}

// Entrypoints lists the MCP Apps people can open from connected servers:
// sidebar apps of servers pinned to the sidebar, and every thread and file
// entrypoint. It waits for the first full refresh, so a client asking as Jaz
// starts gets them instead of an empty list.
func (m *Manager) Entrypoints(ctx context.Context) ([]Entrypoint, error) {
	select {
	case <-m.refreshed:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	servers, err := m.store.ListMCPServers()
	if err != nil {
		return nil, err
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := []Entrypoint{}
	for _, server := range servers {
		session := m.sessions[server.ID]
		if session == nil {
			continue
		}
		for _, point := range session.apps.entrypoints {
			if point.Type == "global" && !server.ShowInUI {
				continue
			}
			point.ServerID = server.ID
			out = append(out, point)
		}
	}
	return out, nil
}

// ReadApp returns the HTML document of the MCP App a server's tool opens.
func (m *Manager) ReadApp(ctx context.Context, serverID, tool string) (string, error) {
	session, uri, err := m.appSession(serverID, tool)
	if err != nil {
		return "", err
	}
	result, err := session.readResource(ctx, uri)
	if err != nil {
		return "", err
	}
	for _, content := range result.Contents {
		if content.MIMEType != AppMIMEType {
			continue
		}
		if content.Text != "" {
			return content.Text, nil
		}
		if len(content.Blob) > 0 {
			return string(content.Blob), nil
		}
	}
	return "", fmt.Errorf("mcp app %s has no %s content", uri, AppMIMEType)
}

// CallAppTool relays a tool call from an app, or from the host opening an
// entrypoint, to the app's own server. Only tools visible to apps and
// entrypoint tools may be called.
func (m *Manager) CallAppTool(ctx context.Context, serverID, name string, arguments json.RawMessage, meta mcpsdk.Meta) (*mcpsdk.CallToolResult, error) {
	session := m.session(serverID)
	if session == nil || len(session.apps.uris) == 0 {
		return nil, ErrAppNotFound
	}
	if !session.apps.callable[name] {
		return nil, fmt.Errorf("%w: %s", ErrAppToolDenied, name)
	}
	return session.callTool(ctx, &mcpsdk.CallToolParams{Name: name, Arguments: arguments, Meta: meta})
}

func (m *Manager) appSession(serverID, tool string) (*serverSession, string, error) {
	session := m.session(serverID)
	if session == nil || session.apps.uris[tool] == "" {
		return nil, "", ErrAppNotFound
	}
	return session, session.apps.uris[tool], nil
}

func (m *Manager) session(serverID string) *serverSession {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.sessions[serverID]
}
