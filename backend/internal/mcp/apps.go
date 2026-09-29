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

// discoverApp finds the server's app resource; tools are the ones its
// _meta.ui.visibility lets an app call.
func (c *serverConnection) discoverApp(ctx context.Context, tools map[string]bool) (*serverApp, error) {
	init := c.session.InitializeResult()
	if init == nil || init.Capabilities == nil || init.Capabilities.Resources == nil {
		return nil, nil
	}
	for resource, err := range c.session.Resources(ctx, nil) {
		if err != nil {
			return nil, err
		}
		if resource.MIMEType != AppMIMEType {
			continue
		}
		app := &serverApp{uri: resource.URI, tools: tools}
		if init.ServerInfo != nil && len(init.ServerInfo.Icons) > 0 {
			app.icon = init.ServerInfo.Icons[0].Source
		}
		return app, nil
	}
	return nil, nil
}

// toolVisibility reads MCP Apps' _meta.ui.visibility. A tool without it is
// visible to both the model and the app.
func toolVisibility(tool *mcpsdk.Tool) (model, app bool) {
	ui, _ := tool.Meta["ui"].(map[string]any)
	list, ok := ui["visibility"].([]any)
	if !ok {
		return true, true
	}
	for _, audience := range list {
		switch audience {
		case "model":
			model = true
		case "app":
			app = true
		}
	}
	return model, app
}

// Apps lists the MCP Apps of connected servers marked to show in the UI.
func (m *Manager) Apps() ([]App, error) {
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
		if content.Text != "" {
			return content.Text, nil
		}
		if len(content.Blob) > 0 {
			return string(content.Blob), nil
		}
	}
	return "", fmt.Errorf("mcp app %s is empty", session.app.uri)
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
