package hooks

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/wins/jaz/backend/internal/httpapi"
	"github.com/wins/jaz/backend/internal/loops"
)

type Handler struct {
	routines Routines
}

// Routines is what webhook deliveries need from the loop service.
type Routines interface {
	Load(string) (loops.Loop, error)
	RunTriggered(context.Context, string, string) (loops.Run, error)
}

func NewHandler(routines Routines) *Handler {
	return &Handler{routines: routines}
}

// Webhook runs a webhook routine. The caller proves itself with the
// routine's secret as a bearer token; the body is handed to the run.
func (h *Handler) Webhook(w http.ResponseWriter, r *http.Request) {
	routine, err := h.routines.Load(r.PathValue("routine"))
	secret := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if err != nil || !loops.VerifyWebhookSecret(routine, secret) {
		httpapi.WriteError(w, http.StatusNotFound, errors.New("no such webhook"))
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 16<<10))
	if err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, err)
		return
	}
	event := "webhook"
	if text := strings.TrimSpace(string(body)); text != "" {
		event = fmt.Sprintf("webhook with body:\n%s", text)
	}
	if _, err := h.routines.RunTriggered(context.WithoutCancel(r.Context()), routine.ID, event); err != nil {
		httpapi.WriteError(w, http.StatusConflict, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}
