package mcp

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"sync"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wins/jaz/backend/internal/mcpconfig"
	integrationoauth "github.com/wins/jaz/backend/pkg/integrations/oauth"
)

type serverConnection struct {
	session      *mcpsdk.ClientSession
	localSession *mcpsdk.ServerSession
	mu           sync.Mutex
	calls        int
	retired      bool
}

func (c *serverConnection) callTool(ctx context.Context, params *mcpsdk.CallToolParams) (*mcpsdk.CallToolResult, error) {
	c.mu.Lock()
	if c.retired {
		c.mu.Unlock()
		return nil, errors.New("MCP server configuration changed")
	}
	c.calls++
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		c.calls--
		closeNow := c.retired && c.calls == 0
		c.mu.Unlock()
		if closeNow {
			c.close()
		}
	}()
	return c.session.CallTool(ctx, params)
}

func (c *serverConnection) retire() {
	c.mu.Lock()
	closeNow := !c.retired && c.calls == 0
	c.retired = true
	c.mu.Unlock()
	if closeNow {
		c.close()
	}
}

func (c *serverConnection) close() {
	_ = c.session.Close()
	if c.localSession != nil {
		_ = c.localSession.Close()
	}
}

func (m *Manager) connectionKey(ctx context.Context, server mcpconfig.Server) ([32]byte, error) {
	headers, err := mcpconfig.ResolvedHeaders(server, true)
	if err != nil {
		return [32]byte{}, err
	}
	var token integrationoauth.Token
	if m.tokens != nil && !m.hasLocalServer(server.ID) {
		token, _, err = m.tokens.LoadToken(ctx, mcpconfig.OAuthConnectionID(server.ID))
		if err != nil {
			return [32]byte{}, err
		}
	}
	data, err := json.Marshal(struct {
		URL     string
		Headers []mcpconfig.Header
		OAuth   mcpconfig.OAuthConfig
		Token   integrationoauth.Token
	}{server.URL, headers, server.OAuth, token})
	return sha256.Sum256(data), err
}

func (c *serverConnection) listTools(ctx context.Context, server mcpconfig.Server) (*serverSession, error) {
	var items []remoteTool
	for tool, err := range c.session.Tools(ctx, nil) {
		if err != nil {
			return nil, err
		}
		if tool == nil || tool.Name == "" {
			continue
		}
		items = append(items, remoteTool{
			serverName:  server.Name,
			remoteName:  tool.Name,
			connection:  c,
			local:       c.localSession != nil,
			description: toolDescription(server, tool),
			inputSchema: inputSchema(tool.InputSchema),
		})
	}
	return &serverSession{serverConnection: c, tools: items}, nil
}
