package canvas

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wins/jaz/backend/internal/runtimefiles"
)

func newTestService(t *testing.T) *Service {
	t.Helper()
	return NewService(runtimefiles.New(t.TempDir()))
}

func writeCanvas(t *testing.T, service *Service, session, content string) {
	t.Helper()
	dir := service.Dir(session)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, FileName), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestPatchMergesFieldsIntoTheAgentsBoard(t *testing.T) {
	service := newTestService(t)
	writeCanvas(t, service, "s1", `{"nodes":[
		{"id":"a","type":"text","text":"Agent note","x":0,"y":0,"width":200,"height":100,"styleAttributes":{"shape":"pill"}},
		{"id":"b","type":"text","text":"Other","x":300,"y":0,"width":200,"height":100}
	],"edges":[{"id":"e","fromNode":"a","toNode":"b","label":"next"}]}`)

	if _, err := service.Patch("s1", Patch{
		Nodes: []Item{{"id": "a", "x": 40.0, "y": 60.0}, {"id": "c", "type": "group", "label": "Section", "x": -40.0, "y": -40.0, "width": 600.0, "height": 240.0}},
		Edges: []Item{{"id": "e", "label": nil}},
	}); err != nil {
		t.Fatal(err)
	}

	snapshot, err := service.Load("s1")
	if err != nil {
		t.Fatal(err)
	}
	view := snapshot.View()
	a := view.Nodes[0]
	if a["x"] != 40.0 || a["y"] != 60.0 || a["text"] != "Agent note" || a["styleAttributes"] == nil {
		t.Fatalf("patched node lost agent fields or kept old position: %#v", a)
	}
	if len(view.Nodes) != 3 || view.Nodes[2]["id"] != "c" {
		t.Fatalf("new node should be appended: %#v", view.Nodes)
	}
	if _, ok := view.Edges[0]["label"]; ok {
		t.Fatalf("null field should be removed: %#v", view.Edges[0])
	}

	raw, err := os.ReadFile(filepath.Join(service.Dir("s1"), FileName))
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(string(raw), "\n")
	if !strings.HasPrefix(strings.TrimSpace(lines[2]), `{"id":"a","type":"text",`) {
		t.Fatalf("each item should sit on its own line with id and type first:\n%s", raw)
	}
}

func TestRemovingANodeDropsItsEdges(t *testing.T) {
	service := newTestService(t)
	writeCanvas(t, service, "s1", `{"nodes":[{"id":"a","type":"text"},{"id":"b","type":"text"},{"id":"c","type":"text"}],
		"edges":[{"id":"ab","fromNode":"a","toNode":"b"},{"id":"bc","fromNode":"b","toNode":"c"}]}`)

	if _, err := service.Patch("s1", Patch{Remove: []string{"a"}}); err != nil {
		t.Fatal(err)
	}

	snapshot, err := service.Load("s1")
	if err != nil {
		t.Fatal(err)
	}
	view := snapshot.View()
	if len(view.Nodes) != 2 || len(view.Edges) != 1 || view.Edges[0]["id"] != "bc" {
		t.Fatalf("nodes %#v edges %#v", view.Nodes, view.Edges)
	}
}

func TestInvalidBoardIsReportedNotOverwritten(t *testing.T) {
	service := newTestService(t)
	writeCanvas(t, service, "s1", `{"nodes":[{"id":"a"`)

	if _, err := service.Load("s1"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Load error = %v, want ErrInvalid", err)
	}
	if _, err := service.Patch("s1", Patch{Nodes: []Item{{"id": "b"}}}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Patch error = %v, want ErrInvalid", err)
	}
	raw, _ := os.ReadFile(filepath.Join(service.Dir("s1"), FileName))
	if string(raw) != `{"nodes":[{"id":"a"` {
		t.Fatalf("a broken board must stay as the agent wrote it, got %q", raw)
	}
}

func TestComponentsCompileAndReportErrors(t *testing.T) {
	service := newTestService(t)
	dir := service.Dir("s1")
	if err := os.MkdirAll(filepath.Join(dir, "components"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "components", "ok.tsx"), []byte(`export default function Ok() { const n: number = 2; return <b>{n}</b> }`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "components", "broken.tsx"), []byte(`export default function Broken() { return <b> }`), 0o644); err != nil {
		t.Fatal(err)
	}
	writeCanvas(t, service, "s1", `{"nodes":[
		{"id":"ok","type":"file","file":"components/ok.tsx"},
		{"id":"broken","type":"file","file":"components/broken.tsx"},
		{"id":"gone","type":"file","file":"/nowhere/missing.png"}
	]}`)

	snapshot, err := service.Load("s1")
	if err != nil {
		t.Fatal(err)
	}
	view := snapshot.View()
	ok := view.Components["ok"]
	if ok.Error != "" || !strings.Contains(ok.Code, `require("react/jsx-runtime")`) || strings.Contains(ok.Code, ": number") {
		t.Fatalf("ok component = %#v", ok)
	}
	if broken := view.Components["broken"]; broken.Code != "" || !strings.Contains(broken.Error, "broken.tsx:1:") {
		t.Fatalf("broken component = %#v", broken)
	}
	if file := view.Files["gone"]; file.Version != "" || file.Path != "/nowhere/missing.png" {
		t.Fatalf("missing file = %#v", file)
	}
	if _, compiled := view.Components["gone"]; compiled {
		t.Fatal("missing files are not compiled")
	}
}

func TestVersionChangesWhenAReferencedFileChanges(t *testing.T) {
	service := newTestService(t)
	writeCanvas(t, service, "s1", `{"nodes":[{"id":"doc","type":"file","file":"notes.md"}]}`)
	path := filepath.Join(service.Dir("s1"), "notes.md")
	if err := os.WriteFile(path, []byte("one"), 0o644); err != nil {
		t.Fatal(err)
	}
	before, err := service.Load("s1")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("two, longer"), 0o644); err != nil {
		t.Fatal(err)
	}
	after, err := service.Load("s1")
	if err != nil {
		t.Fatal(err)
	}
	if before.Version == after.Version {
		t.Fatal("editing a file on the board must change the board version")
	}
}
