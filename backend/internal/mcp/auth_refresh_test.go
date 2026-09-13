package mcp

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/charmbracelet/log"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wins/jaz/backend/internal/mcpconfig"
	"github.com/wins/jaz/backend/internal/tools"
	integrationoauth "github.com/wins/jaz/backend/pkg/integrations/oauth"
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
