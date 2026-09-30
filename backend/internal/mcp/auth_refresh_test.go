package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/charmbracelet/log"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wins/jaz/backend/internal/mcpconfig"
	"github.com/wins/jaz/backend/internal/tools"
	integrationoauth "github.com/wins/jaz/backend/pkg/integrations/oauth"
	"golang.org/x/oauth2"
)

func TestRefreshUsesCurrentOAuthCredentials(t *testing.T) {
	for _, replacement := range []string{"second-account", ""} {
		t.Run("replacement="+replacement, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			remote := mcpsdk.NewServer(&mcpsdk.Implementation{Name: "identity"}, nil)
			remote.AddTool(&mcpsdk.Tool{Name: "identity", InputSchema: map[string]any{"type": "object"}}, func(_ context.Context, req *mcpsdk.CallToolRequest) (*mcpsdk.CallToolResult, error) {
				return &mcpsdk.CallToolResult{Content: []mcpsdk.Content{&mcpsdk.TextContent{Text: req.Extra.Header.Get("Authorization")}}}, nil
			})
			handler := mcpsdk.NewStreamableHTTPHandler(func(*http.Request) *mcpsdk.Server { return remote }, nil)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") == "" {
					w.Header().Set("WWW-Authenticate", "Bearer")
					http.Error(w, "sign in required", http.StatusUnauthorized)
					return
				}
				handler.ServeHTTP(w, r)
			}))
			defer upstream.Close()
			server := mcpconfig.Server{ID: "identity", Name: "identity", URL: upstream.URL, Enabled: true}
			tokenID := mcpconfig.OAuthConnectionID(server.ID)
			tokens := newMemTokenStore()
			if err := tokens.SaveToken(ctx, tokenID, integrationoauth.Token{AccessToken: "first-account"}); err != nil {
				t.Fatal(err)
			}
			manager := NewManager(&testStore{servers: []mcpconfig.Server{server}}, tokens, tools.NewRegistry(), log.New(io.Discard))
			defer manager.Close()
			manager.Refresh(ctx)
			if status := manager.Status(server.ID); status.Status != "connected" {
				t.Fatalf("initial status = %+v", status)
			}
			original := manager.sessions[server.ID].serverConnection
			revision := manager.Revision()
			manager.Refresh(ctx)
			if manager.sessions[server.ID].serverConnection != original || manager.Revision() != revision {
				t.Fatal("unchanged credentials replaced the connection or advanced the catalog")
			}
			if replacement == "" {
				if err := tokens.DeleteToken(ctx, tokenID); err != nil {
					t.Fatal(err)
				}
			} else if err := tokens.SaveToken(ctx, tokenID, integrationoauth.Token{AccessToken: replacement}); err != nil {
				t.Fatal(err)
			}
			manager.Refresh(ctx)
			if manager.Revision() == revision {
				t.Fatal("credential change did not advance the proxy revision")
			}
			if replacement == "" {
				if status := manager.Status(server.ID); status.Status != "needs_auth" || status.ToolCount != 0 {
					t.Fatalf("removed credentials still usable: %+v", status)
				}
				return
			}
			session := manager.sessions[server.ID]
			if session == nil {
				t.Fatalf("refresh status = %+v", manager.Status(server.ID))
			}
			result, err := session.callTool(ctx, &mcpsdk.CallToolParams{Name: "identity"})
			if err != nil {
				t.Fatal(err)
			}
			if len(result.Content) != 1 || result.Content[0].(*mcpsdk.TextContent).Text != "Bearer "+replacement {
				t.Fatalf("tool used previous credentials: %+v", result)
			}
		})
	}
}

func TestBearerTokenReplacesOAuth(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	remote := mcpsdk.NewServer(&mcpsdk.Implementation{Name: "identity"}, nil)
	remote.AddTool(&mcpsdk.Tool{Name: "identity", InputSchema: map[string]any{"type": "object"}}, func(_ context.Context, req *mcpsdk.CallToolRequest) (*mcpsdk.CallToolResult, error) {
		return &mcpsdk.CallToolResult{Content: []mcpsdk.Content{&mcpsdk.TextContent{Text: req.Extra.Header.Get("Authorization")}}}, nil
	})
	handler := mcpsdk.NewStreamableHTTPHandler(func(*http.Request) *mcpsdk.Server { return remote }, nil)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer good-key" {
			w.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(w, "sign in required", http.StatusUnauthorized)
			return
		}
		handler.ServeHTTP(w, r)
	}))
	defer upstream.Close()
	servers := []mcpconfig.Server{
		{ID: "key", Name: "key", URL: upstream.URL, Enabled: true, BearerToken: "good-key"},
		{ID: "bad", Name: "bad", URL: upstream.URL, Enabled: true, BearerToken: "bad-key"},
		{ID: "oauth", Name: "oauth", URL: upstream.URL, Enabled: true},
	}
	tokens := newMemTokenStore()
	if err := tokens.SaveToken(ctx, mcpconfig.OAuthConnectionID("key"), integrationoauth.Token{AccessToken: "oauth-account"}); err != nil {
		t.Fatal(err)
	}
	manager := NewManager(&testStore{servers: servers}, tokens, tools.NewRegistry(), log.New(io.Discard))
	defer manager.Close()
	manager.Refresh(ctx)

	if status := manager.Status("key"); status.Status != "connected" {
		t.Fatalf("server with an API key = %+v", status)
	}
	result, err := manager.sessions["key"].callTool(ctx, &mcpsdk.CallToolParams{Name: "identity"})
	if err != nil || result.Content[0].(*mcpsdk.TextContent).Text != "Bearer good-key" {
		t.Fatalf("the API key, not the stored OAuth token, authenticates calls: %+v %v", result, err)
	}
	if status := manager.Status("bad"); status.Status != "error" {
		t.Fatalf("a rejected API key reports an error rather than asking to sign in: %+v", status)
	}
	if status := manager.Status("oauth"); status.Status != "needs_auth" {
		t.Fatalf("a server without a key still signs in with OAuth: %+v", status)
	}
}

// rotatingTokenServer rotates the refresh token on every use and revokes the
// grant when a rotated one is presented again, as Jaz Tasks does.
type rotatingTokenServer struct {
	mu      sync.Mutex
	issued  int
	access  string
	refresh string
	revoked bool
}

func (s *rotatingTokenServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	if s.revoked || r.FormValue("refresh_token") != s.refresh {
		s.revoked = true
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"error":"invalid_grant"}`)
		return
	}
	s.issued++
	s.access, s.refresh = fmt.Sprintf("access-%d", s.issued), fmt.Sprintf("refresh-%d", s.issued)
	// Inside oauth2's expiry margin, so every MCP request refreshes.
	_ = json.NewEncoder(w).Encode(map[string]any{"access_token": s.access, "refresh_token": s.refresh, "token_type": "Bearer", "expires_in": 1})
}

func (s *rotatingTokenServer) accepts(authorization string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return !s.revoked && authorization == "Bearer "+s.access
}

func TestOAuthRefreshSurvivesServerRestart(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	grants := &rotatingTokenServer{refresh: "refresh-0"}
	tokenServer := httptest.NewServer(grants)
	defer tokenServer.Close()
	var live atomic.Pointer[http.Handler]
	first := newEchoHandler()
	live.Store(&first)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !grants.accepts(r.Header.Get("Authorization")) {
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}
		(*live.Load()).ServeHTTP(w, r)
	}))
	defer upstream.Close()
	server := mcpconfig.Server{ID: "tasks", Name: "Tasks", URL: upstream.URL, Enabled: true}
	tokens := newMemTokenStore()
	if err := tokens.SaveToken(ctx, mcpconfig.OAuthConnectionID(server.ID), integrationoauth.Token{
		AccessToken:  "access-0",
		RefreshToken: "refresh-0",
		TokenType:    "Bearer",
		Expiry:       time.Now().Add(-time.Hour),
		ClientID:     "jaz",
		TokenURL:     tokenServer.URL,
		AuthStyle:    int(oauth2.AuthStyleInParams),
	}); err != nil {
		t.Fatal(err)
	}
	registry := tools.NewRegistry()
	manager := NewManager(&testStore{servers: []mcpconfig.Server{server}}, tokens, registry, log.New(io.Discard))
	defer manager.Close()
	manager.Refresh(ctx)
	if status := manager.Status(server.ID); status.Status != "connected" {
		t.Fatalf("status = %+v", status)
	}
	tool, ok := registry.Get(tools.DefinitionName(registry.Definitions()[0]))
	if !ok {
		t.Fatal("echo tool not registered")
	}

	restarted := newEchoHandler()
	live.Store(&restarted)
	result, err := tool.Execute(ctx, map[string]any{"value": "after restart"})
	if err != nil {
		t.Fatalf("call after server restart: %v", err)
	}
	if !strings.Contains(result.Content, "got after restart") {
		t.Fatalf("result = %s", result.Content)
	}
}
