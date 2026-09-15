package filesystem

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/wins/jaz/backend/internal/httpapi"
)

func CreateDirectory(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Parent string `json:"parent"`
		Name   string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, err)
		return
	}
	req.Parent = strings.TrimSpace(req.Parent)
	req.Name = strings.TrimSpace(req.Name)
	if !filepath.IsAbs(req.Parent) || !filepath.IsLocal(req.Name) || filepath.Clean(req.Name) == "." {
		httpapi.WriteError(w, http.StatusBadRequest, errors.New("an absolute parent path and a folder name are required"))
		return
	}
	path := filepath.Join(req.Parent, req.Name)
	if err := os.MkdirAll(path, 0o755); err != nil {
		status, message := http.StatusInternalServerError, "Couldn't create this folder."
		switch {
		case errors.Is(err, os.ErrPermission):
			status, message = http.StatusForbidden, "You don't have permission to create a folder here."
		case errors.Is(err, syscall.ENOTDIR), errors.Is(err, os.ErrExist):
			status, message = http.StatusConflict, "A file already exists along this path."
		}
		httpapi.WriteError(w, status, errors.New(message))
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, map[string]string{"path": path})
}
