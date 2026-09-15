package filesystem

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

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
		httpapi.WriteError(w, http.StatusBadRequest, fmt.Errorf("an absolute parent path and a folder name are required"))
		return
	}
	path := filepath.Join(req.Parent, req.Name)
	if err := os.MkdirAll(path, 0o755); err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, map[string]string{"path": path})
}
