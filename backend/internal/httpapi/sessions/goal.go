package sessions

import (
	"context"
	"errors"
	"net/http"

	"github.com/wins/jaz/backend/internal/httpapi"
	"github.com/wins/jaz/backend/internal/storage"
)

type GoalRuntime interface {
	ClearGoal(context.Context, string) error
}

type GoalHandler struct{ runtime GoalRuntime }

func NewGoalHandler(runtime GoalRuntime) *GoalHandler {
	return &GoalHandler{runtime: runtime}
}

func (h *GoalHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if err := h.runtime.ClearGoal(r.Context(), r.PathValue("session")); err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, storage.ErrSessionNotFound) {
			status = http.StatusNotFound
		}
		httpapi.WriteError(w, status, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
