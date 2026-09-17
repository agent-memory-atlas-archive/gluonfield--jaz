package preview

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wins/jaz/backend/internal/filepathx"
)

func TestFilePreview(t *testing.T) {
	dir := t.TempDir()
	assets := map[string]string{
		"index #1.html": "<!doctype html><script src=app.js></script><link rel=stylesheet href=style.css><h1>Report</h1>",
		"app.js":        "document.title = 'Loaded'",
		"style.css":     "h1 { color: green }",
		"bom.csv":       "Part,Cost\nMotor,50\n",
	}
	for name, content := range assets {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	outside := filepath.Join(t.TempDir(), "private.txt")
	if err := os.WriteFile(outside, []byte("private"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "escape.txt")); err != nil {
		t.Fatal(err)
	}
	h := newHandler(t, "https://{id}.preview.example.test")
	register := func(path string, status int) createPreviewResponse {
		t.Helper()
		body, _ := json.Marshal(map[string]string{"path": path})
		request := httptest.NewRequest(http.MethodPost, "https://jaz.example/v1/preview/files", strings.NewReader(string(body)))
		response := httptest.NewRecorder()
		h.ServeHTTP(response, request)
		if response.Code != status {
			t.Fatalf("register %q: %d %s", path, response.Code, response.Body.String())
		}
		var result createPreviewResponse
		if status == http.StatusOK {
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
		}
		return result
	}
	file := filepath.Join(dir, "index #1.html")
	preview := register(file, http.StatusOK)
	if preview.BaseURL != filepathx.FileURI(dir)+"/" || register(filepathx.FileURI(file), http.StatusOK).URL != preview.URL {
		t.Fatalf("file URI or capability reuse failed: %#v", preview)
	}
	base := mustParseURL(t, preview.URL)
	linked := register(filepathx.FileURI(file)+"?volume=500#costs", http.StatusOK)
	if linked.URL != preview.URL+"?volume=500#costs" || linked.BaseURL != preview.BaseURL {
		t.Fatalf("file link lost query or fragment: %#v", linked)
	}
	for name, content := range assets {
		target := base.ResolveReference(&url.URL{Path: name})
		response := httptest.NewRecorder()
		h.ServeHTTP(response, httptest.NewRequest(http.MethodGet, target.String(), nil))
		if response.Code != http.StatusOK || response.Body.String() != content {
			t.Fatalf("asset %s: %d %s", name, response.Code, response.Body.String())
		}
		if response.Header().Get("Content-Type") == "" || response.Header().Get("Referrer-Policy") != "no-referrer" {
			t.Fatalf("asset headers: %v", response.Header())
		}
	}
	for _, path := range []string{"/", "/missing.html", "/escape.txt", "/../private.txt", "/%2e%2e/private.txt"} {
		response := httptest.NewRecorder()
		h.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "https://"+base.Host+path, nil))
		if response.Code != http.StatusNotFound {
			t.Fatalf("outside request %s: %d", path, response.Code)
		}
	}
	register(dir, http.StatusBadRequest)
	register("relative.html", http.StatusBadRequest)
	register(filepath.Join(dir, "missing.html"), http.StatusNotFound)
	entry := h.byHost[base.Host]
	entry.expiresAt = time.Now().Add(-time.Second)
	h.byHost[base.Host] = entry
	if _, ok := h.lookup(base.Host); ok || len(h.byBase) != 0 {
		t.Fatal("expired file preview was retained")
	}
}
