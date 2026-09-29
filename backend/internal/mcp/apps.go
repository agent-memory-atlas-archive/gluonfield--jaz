package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// AppMIMEType marks an MCP Apps UI resource (the io.modelcontextprotocol/ui
// extension): a self-contained HTML document the host renders in a sandbox.
const AppMIMEType = "text/html;profile=mcp-app"

var (
	ErrAppNotFound   = errors.New("mcp app not found")
	ErrAppToolDenied = errors.New("tool is not available to apps")
)

// App is a connected server's MCP App that the user pinned to the rail.
type App struct {
	ServerID string `json:"server_id"`
	Name     string `json:"name"`
	Icon     string `json:"icon,omitempty"`
}

type serverApp struct {
	uri   string
	icon  string
	tools map[string]bool
}

// newServerApp describes the app a server's tools link to, or nil when none
// does. Tools lists what its _meta.ui.visibility lets the app call.
func newServerApp(init *mcpsdk.InitializeResult, uri string, tools map[string]bool) *serverApp {
	if uri == "" {
		return nil
	}
	app := &serverApp{uri: uri, tools: tools}
	if init != nil && init.ServerInfo != nil && len(init.ServerInfo.Icons) > 0 {
		app.icon = init.ServerInfo.Icons[0].Source
	}
	return app
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

// Apps lists the MCP Apps of connected servers marked to show in the UI. It
// waits for the first full refresh, so a client asking as Jaz starts gets the
// apps instead of an empty list.
func (m *Manager) Apps(ctx context.Context) ([]App, error) {
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
	apps := []App{}
	for _, server := range servers {
		session := m.sessions[server.ID]
		if !server.ShowInUI || session == nil || session.app == nil {
			continue
		}
		apps = append(apps, App{ServerID: server.ID, Name: server.Name, Icon: session.app.icon})
	}
	return apps, nil
}

// ReadApp returns the HTML document of a server's MCP App.
func (m *Manager) ReadApp(ctx context.Context, serverID string) (string, error) {
	session, err := m.appSession(serverID)
	if err != nil {
		return "", err
	}
	result, err := session.readResource(ctx, session.app.uri)
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
	return "", fmt.Errorf("mcp app %s has no %s content", session.app.uri, AppMIMEType)
}

// CallAppTool relays a tool call from an app's UI to its own server. Apps may
// only call tools their server made visible to apps.
func (m *Manager) CallAppTool(ctx context.Context, serverID, name string, arguments json.RawMessage) (*mcpsdk.CallToolResult, error) {
	session, err := m.appSession(serverID)
	if err != nil {
		return nil, err
	}
	if !session.app.tools[name] {
		return nil, fmt.Errorf("%w: %s", ErrAppToolDenied, name)
	}
	return session.callTool(ctx, &mcpsdk.CallToolParams{Name: name, Arguments: arguments})
}

func (m *Manager) appSession(serverID string) (*serverSession, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	session := m.sessions[serverID]
	if session == nil || session.app == nil {
		return nil, ErrAppNotFound
	}
	return session, nil
}
