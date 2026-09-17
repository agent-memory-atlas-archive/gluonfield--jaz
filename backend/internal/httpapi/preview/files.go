package preview

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/wins/jaz/backend/internal/filepathx"
	"github.com/wins/jaz/backend/internal/httpapi"
)

func (h *Handler) createFile(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, err)
		return
	}
	file, err := filepathx.FromUserInput(input.Path)
	if err != nil || !filepath.IsAbs(file) {
		httpapi.WriteError(w, http.StatusBadRequest, fmt.Errorf("preview requires an absolute file path"))
		return
	}
	file = filepath.Clean(file)
	info, err := os.Stat(file)
	if err != nil {
		httpapi.WriteError(w, http.StatusNotFound, err)
		return
	}
	if !info.Mode().IsRegular() {
		httpapi.WriteError(w, http.StatusBadRequest, fmt.Errorf("preview requires a regular file"))
		return
	}
	directory := filepath.Dir(file)
	target := &url.URL{Path: "/" + filepath.Base(file)}
	if inputURL, err := url.Parse(strings.TrimSpace(input.Path)); err == nil && strings.EqualFold(inputURL.Scheme, "file") {
		target.RawQuery = inputURL.RawQuery
		target.Fragment = inputURL.Fragment
	}
	base, _ := url.Parse(filepathx.FileURI(file))
	h.register(w, r, target, previewEntry{
		baseURL: base.ResolveReference(&url.URL{Path: "."}).String(),
		serve: func(w http.ResponseWriter, r *http.Request) {
			serveFile(w, r, directory)
		},
	})
}

func serveFile(w http.ResponseWriter, r *http.Request, directory string) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	file, err := os.OpenInRoot(directory, strings.TrimPrefix(r.URL.Path, "/"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, info.Name(), info.ModTime(), file)
}
