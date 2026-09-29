package mcpapps

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wins/jaz/backend/internal/httpapi"
	"github.com/wins/jaz/backend/internal/mcp"
)

// Runtime serves MCP Apps from the servers' live, authenticated sessions.
type Runtime interface {
	Apps(ctx context.Context) ([]mcp.App, error)
	ReadApp(ctx context.Context, serverID string) (string, error)
	CallAppTool(ctx context.Context, serverID, name string, arguments json.RawMessage) (*mcpsdk.CallToolResult, error)
}

type Handler struct {
	runtime Runtime
}

type listResponse struct {
	Apps []mcp.App `json:"apps"`
}

type resourceResponse struct {
	HTML string `json:"html"`
}

type callToolRequest struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments,omitempty"`
}

func NewHandler(runtime Runtime) *Handler {
	return &Handler{runtime: runtime}
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	apps, err := h.runtime.Apps(r.Context())
	if err != nil {
		httpapi.WriteError(w, http.StatusInternalServerError, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, listResponse{Apps: apps})
}

func (h *Handler) Resource(w http.ResponseWriter, r *http.Request) {
	html, err := h.runtime.ReadApp(r.Context(), r.PathValue("server"))
	if err != nil {
		httpapi.WriteError(w, statusFor(err), err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, resourceResponse{HTML: html})
}

func (h *Handler) CallTool(w http.ResponseWriter, r *http.Request) {
	var req callToolRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		httpapi.WriteError(w, http.StatusBadRequest, errors.New("tool name is required"))
		return
	}
	result, err := h.runtime.CallAppTool(r.Context(), r.PathValue("server"), req.Name, req.Arguments)
	if err != nil {
		httpapi.WriteError(w, statusFor(err), err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, result)
}

func statusFor(err error) int {
	switch {
	case errors.Is(err, mcp.ErrAppNotFound):
		return http.StatusNotFound
	case errors.Is(err, mcp.ErrAppToolDenied):
		return http.StatusForbidden
	default:
		return http.StatusBadGateway
	}
}
