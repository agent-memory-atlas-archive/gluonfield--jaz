package canvas

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wins/jaz/backend/internal/canvas"
	"github.com/wins/jaz/backend/internal/runtimefiles"
	"github.com/wins/jaz/backend/internal/storage"
	jsonstore "github.com/wins/jaz/backend/internal/storage/json"
)

func newTestServer(t *testing.T) (*http.ServeMux, string, string) {
	t.Helper()
	store, err := jsonstore.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	session := func(surface string) string {
		created, err := store.CreateSession(storage.CreateSession{Title: surface, RuntimeRef: &storage.RuntimeRef{Type: storage.RuntimeACP, ArtifactSurface: surface}})
		if err != nil {
			t.Fatal(err)
		}
		return created.ID
	}
	handler := NewHandler(store, canvas.NewService(runtimefiles.New(t.TempDir())))
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/sessions/{session}/canvas", handler.Get)
	mux.HandleFunc("PATCH /v1/sessions/{session}/canvas", handler.Patch)
	return mux, session("canvas"), session("chat")
}

func serve(mux *http.ServeMux, method, path, body string) *httptest.ResponseRecorder {
	res := httptest.NewRecorder()
	mux.ServeHTTP(res, httptest.NewRequest(method, path, strings.NewReader(body)))
	return res
}

func TestCanvasRoundTripAndUnchangedPolls(t *testing.T) {
	mux, board, _ := newTestServer(t)
	path := "/v1/sessions/" + board + "/canvas"

	res := serve(mux, http.MethodPatch, path, `{"nodes":[{"id":"note","type":"text","text":"Hi","x":0,"y":0,"width":200,"height":200}]}`)
	if res.Code != http.StatusOK {
		t.Fatalf("patch status = %d, body = %s", res.Code, res.Body.String())
	}
	res = serve(mux, http.MethodGet, path, "")
	var view canvas.View
	if err := json.Unmarshal(res.Body.Bytes(), &view); err != nil || res.Code != http.StatusOK {
		t.Fatalf("get status = %d, err = %v", res.Code, err)
	}
	if len(view.Nodes) != 1 || view.Nodes[0]["text"] != "Hi" {
		t.Fatalf("nodes = %#v", view.Nodes)
	}
	if res := serve(mux, http.MethodGet, path+"?version="+view.Version, ""); res.Code != http.StatusNoContent {
		t.Fatalf("unchanged poll status = %d, want 204", res.Code)
	}
}

func TestCanvasIsOnlyServedForCanvasThreads(t *testing.T) {
	mux, _, chat := newTestServer(t)
	if res := serve(mux, http.MethodGet, "/v1/sessions/"+chat+"/canvas", ""); res.Code != http.StatusNotFound {
		t.Fatalf("chat thread status = %d, want 404", res.Code)
	}
	if res := serve(mux, http.MethodPatch, "/v1/sessions/"+chat+"/canvas", `{"remove":["x"]}`); res.Code != http.StatusNotFound {
		t.Fatalf("chat thread patch status = %d, want 404", res.Code)
	}
}
