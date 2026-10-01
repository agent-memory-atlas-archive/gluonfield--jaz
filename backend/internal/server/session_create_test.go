package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wins/jaz/backend/internal/acp"
	"github.com/wins/jaz/backend/internal/storage"
	jsonstore "github.com/wins/jaz/backend/internal/storage/json"
	sqlitestore "github.com/wins/jaz/backend/internal/storage/sqlite"
)

func TestCreateACPSessionUsesTitleForInitialSlug(t *testing.T) {
	store, err := jsonstore.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	manager := &fakeACPManager{spawnStore: store}

	body := `{"runtime":"acp","agent":"claude","title":"Repair thread title slugs","directory":"repo","worktree":true}`
	req := httptest.NewRequest(http.MethodPost, "/v1/sessions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()

	(&Server{Store: store, ACP: manager}).Handler().ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", res.Code, res.Body.String())
	}
	if manager.created.Title != "Repair thread title slugs" {
		t.Fatalf("create request = %#v, want title forwarded", manager.created)
	}
	var session storage.Session
	if err := json.Unmarshal(res.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	if session.Slug != "repair-thread-title-slugs" {
		t.Fatalf("slug = %q, want task-derived slug", session.Slug)
	}
	if session.ModelProvider != acp.AgentClaude {
		t.Fatalf("model provider = %q, want %q", session.ModelProvider, acp.AgentClaude)
	}
}

func TestProjectlessChatsKeepSeparateFilesAfterRestart(t *testing.T) {
	root := t.TempDir()
	store, err := sqlitestore.New(root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	cfg := acp.Config{
		Root:      root,
		Workspace: filepath.Join(root, "workspaces", "default"),
		Agents:    map[string]acp.AgentConfig{"fake": {Command: "fake"}},
	}
	manager := acp.NewManager(store, cfg, nil)
	t.Cleanup(manager.Close)
	handler := (&Server{Store: store, ACP: manager, Root: root, Workspace: cfg.Workspace}).Handler()
	var sessions []storage.Session
	contents := []string{"first chat", "second chat"}
	for i, body := range []string{`{"agent":"fake"}`, `{"agent":"fake","directory":"  "}`} {
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, httptest.NewRequest(http.MethodPost, "/v1/sessions", strings.NewReader(body)))
		if res.Code != http.StatusOK {
			t.Fatalf("create status = %d, body = %s", res.Code, res.Body.String())
		}
		var session storage.Session
		if err := json.Unmarshal(res.Body.Bytes(), &session); err != nil {
			t.Fatal(err)
		}
		want := filepath.Join(root, "chats", session.ID)
		if session.RuntimeRef == nil || session.RuntimeRef.Cwd != want || session.RuntimeRef.ProjectPath != "" {
			t.Fatalf("runtime ref = %#v, want cwd %q and no project", session.RuntimeRef, want)
		}
		if err := os.WriteFile(filepath.Join(want, "result.txt"), []byte(contents[i]), 0o600); err != nil {
			t.Fatal(err)
		}
		sessions = append(sessions, session)
	}
	if sessions[0].RuntimeRef.Cwd == sessions[1].RuntimeRef.Cwd {
		t.Fatal("chats share a working directory")
	}
	if err := store.UpdateSessionTitle(sessions[0].ID, "Renamed chat"); err != nil {
		t.Fatal(err)
	}
	if err := store.SetArchived(sessions[0].ID, true); err != nil {
		t.Fatal(err)
	}
	if err := store.SetArchived(sessions[0].ID, false); err != nil {
		t.Fatal(err)
	}
	manager.Close()
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = sqlitestore.New(root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	manager = acp.NewManager(store, cfg, nil)
	t.Cleanup(manager.Close)
	handler = (&Server{Store: store, ACP: manager, Root: root, Workspace: cfg.Workspace}).Handler()
	for i, session := range sessions {
		loaded, err := store.LoadSession(session.ID)
		if err != nil {
			t.Fatal(err)
		}
		if loaded.RuntimeRef.Cwd != session.RuntimeRef.Cwd || loaded.RuntimeRef.ProjectPath != "" {
			t.Fatalf("directory changed after restart: %#v", loaded.RuntimeRef)
		}
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/v1/sessions/"+session.ID+"/file?path=result.txt&raw=1", nil))
		if res.Code != http.StatusOK || res.Body.String() != contents[i] {
			t.Fatalf("file for chat %s = %d %q, want %q", session.ID, res.Code, res.Body.String(), contents[i])
		}
	}
}
