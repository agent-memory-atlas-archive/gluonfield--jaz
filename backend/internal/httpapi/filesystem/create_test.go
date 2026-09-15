package filesystem

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCreateDirectory(t *testing.T) {
	parent := t.TempDir()
	body, err := json.Marshal(map[string]string{"parent": parent, "name": " My project/nested "})
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(parent, "My project", "nested")
	for range 2 {
		res := httptest.NewRecorder()
		CreateDirectory(res, httptest.NewRequest(http.MethodPost, "/v1/filesystem/dirs", strings.NewReader(string(body))))
		if res.Code != http.StatusOK {
			t.Fatalf("status = %d: %s", res.Code, res.Body.String())
		}
		var got struct {
			Path string `json:"path"`
		}
		if err := json.Unmarshal(res.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if got.Path != want {
			t.Fatalf("path = %q, want %q", got.Path, want)
		}
		info, err := os.Stat(want)
		if err != nil || !info.IsDir() {
			t.Fatalf("directory was not created: %v", err)
		}
	}
}

func TestCreateDirectoryRejectsInvalidPaths(t *testing.T) {
	parent := t.TempDir()
	if err := os.WriteFile(filepath.Join(parent, "file"), []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"", " ", ".", "..", "../outside", "/absolute", "file", "file/nested"} {
		t.Run(name, func(t *testing.T) {
			body, err := json.Marshal(map[string]string{"parent": parent, "name": name})
			if err != nil {
				t.Fatal(err)
			}
			res := httptest.NewRecorder()
			CreateDirectory(res, httptest.NewRequest(http.MethodPost, "/v1/filesystem/dirs", strings.NewReader(string(body))))
			if res.Code != http.StatusBadRequest {
				t.Fatalf("status = %d: %s", res.Code, res.Body.String())
			}
		})
	}
	for _, body := range []string{`{`, `{}`, `{"parent":"relative","name":"new"}`} {
		res := httptest.NewRecorder()
		CreateDirectory(res, httptest.NewRequest(http.MethodPost, "/v1/filesystem/dirs", strings.NewReader(body)))
		if res.Code != http.StatusBadRequest {
			t.Fatalf("body %q: status = %d", body, res.Code)
		}
	}
	data, err := os.ReadFile(filepath.Join(parent, "file"))
	if err != nil || string(data) != "keep" {
		t.Fatalf("existing file changed: %q, %v", data, err)
	}
}
