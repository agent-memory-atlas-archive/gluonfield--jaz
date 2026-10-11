// Package canvas owns a canvas thread's board: a JSON Canvas 1.0 document
// (jsoncanvas.org) that the agent edits with its own file tools and the client
// reads and patches over HTTP.
package canvas

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"sync"

	"github.com/wins/jaz/backend/internal/runtimefiles"
)

const FileName = "canvas.json"

var ErrInvalid = errors.New("invalid canvas")

// Item is one JSON Canvas node or edge. It stays a loose map so fields the
// agent adds survive a client patch untouched.
type Item map[string]any

type Board struct {
	Nodes []Item `json:"nodes"`
	Edges []Item `json:"edges"`
}

type File struct {
	Path    string `json:"path"`
	Version string `json:"version,omitempty"`
}

type Component struct {
	Code  string `json:"code,omitempty"`
	Error string `json:"error,omitempty"`
}

type View struct {
	Version    string               `json:"version"`
	Dir        string               `json:"dir"`
	Nodes      []Item               `json:"nodes"`
	Edges      []Item               `json:"edges"`
	Files      map[string]File      `json:"files"`
	Components map[string]Component `json:"components"`
}

// Patch merges items into the board by id: a field set to null is removed,
// an unknown id is appended. Remove deletes nodes and edges, along with the
// edges that touch a removed node.
type Patch struct {
	Nodes  []Item   `json:"nodes,omitempty"`
	Edges  []Item   `json:"edges,omitempty"`
	Remove []string `json:"remove,omitempty"`
}

type Snapshot struct {
	Version string
	dir     string
	board   Board
	files   map[string]File
}

type Service struct {
	root string
	mu   sync.Mutex
}

func NewService(layout runtimefiles.Layout) *Service {
	return &Service{root: layout.Canvases}
}

func (s *Service) Dir(sessionID string) string {
	return Dir(s.root, sessionID)
}

// Dir is absolute: the agent and the session file API resolve relative paths
// against the session's working directory, not the Jaz root.
func Dir(canvasesRoot, sessionID string) string {
	dir, err := filepath.Abs(filepath.Join(canvasesRoot, sessionID))
	if err != nil {
		return filepath.Join(canvasesRoot, sessionID)
	}
	return dir
}

func (s *Service) Load(sessionID string) (Snapshot, error) {
	dir := s.Dir(sessionID)
	raw, board, err := readBoard(dir)
	if err != nil {
		return Snapshot{}, err
	}
	hash := sha256.New()
	hash.Write(raw)
	files := map[string]File{}
	for _, node := range board.Nodes {
		id, _ := node["id"].(string)
		path, _ := node["file"].(string)
		if node["type"] != "file" || id == "" || path == "" {
			continue
		}
		file := File{Path: resolve(dir, path)}
		if info, err := os.Stat(file.Path); err == nil {
			file.Version = fmt.Sprintf("%d-%d", info.ModTime().UnixNano(), info.Size())
		}
		files[id] = file
		fmt.Fprintf(hash, "\x00%s\x00%s\x00%s", id, file.Path, file.Version)
	}
	return Snapshot{Version: hex.EncodeToString(hash.Sum(nil))[:24], dir: dir, board: board, files: files}, nil
}

func (s Snapshot) View() View {
	components := map[string]Component{}
	for id, file := range s.files {
		if file.Version != "" && IsComponent(file.Path) {
			components[id] = compile(file.Path)
		}
	}
	return View{Version: s.Version, Dir: s.dir, Nodes: s.board.Nodes, Edges: s.board.Edges, Files: s.files, Components: components}
}

func (s *Service) Patch(sessionID string, patch Patch) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir := s.Dir(sessionID)
	_, board, err := readBoard(dir)
	if err != nil {
		return "", err
	}
	if board.Nodes, err = upsert(board.Nodes, patch.Nodes); err != nil {
		return "", err
	}
	if board.Edges, err = upsert(board.Edges, patch.Edges); err != nil {
		return "", err
	}
	removeItems(&board, patch.Remove)
	if err := writeBoard(dir, board); err != nil {
		return "", err
	}
	snapshot, err := s.Load(sessionID)
	return snapshot.Version, err
}

func readBoard(dir string) ([]byte, Board, error) {
	raw, err := os.ReadFile(filepath.Join(dir, FileName))
	if errors.Is(err, os.ErrNotExist) {
		return nil, Board{Nodes: []Item{}, Edges: []Item{}}, nil
	}
	if err != nil {
		return nil, Board{}, err
	}
	var board Board
	if err := json.Unmarshal(raw, &board); err != nil {
		return nil, Board{}, fmt.Errorf("%w: %s: %v", ErrInvalid, FileName, err)
	}
	for _, items := range [][]Item{board.Nodes, board.Edges} {
		for _, item := range items {
			if id, _ := item["id"].(string); id == "" {
				return nil, Board{}, fmt.Errorf("%w: every node and edge needs a string id", ErrInvalid)
			}
		}
	}
	if board.Nodes == nil {
		board.Nodes = []Item{}
	}
	if board.Edges == nil {
		board.Edges = []Item{}
	}
	return raw, board, nil
}

func resolve(dir, path string) string {
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	return filepath.Join(dir, path)
}

func upsert(items, changes []Item) ([]Item, error) {
	for _, change := range changes {
		id, _ := change["id"].(string)
		if id == "" {
			return nil, fmt.Errorf("%w: every node and edge needs a string id", ErrInvalid)
		}
		at := slices.IndexFunc(items, func(item Item) bool { return item["id"] == id })
		if at < 0 {
			items = append(items, Item{})
			at = len(items) - 1
		}
		for key, value := range change {
			if value == nil {
				delete(items[at], key)
				continue
			}
			items[at][key] = value
		}
	}
	return items, nil
}

func removeItems(board *Board, ids []string) {
	if len(ids) == 0 {
		return
	}
	gone := func(item Item) bool {
		return slices.Contains(ids, item["id"].(string))
	}
	board.Nodes = slices.DeleteFunc(board.Nodes, gone)
	board.Edges = slices.DeleteFunc(board.Edges, func(edge Item) bool {
		from, _ := edge["fromNode"].(string)
		to, _ := edge["toNode"].(string)
		return gone(edge) || slices.Contains(ids, from) || slices.Contains(ids, to)
	})
}

// writeBoard keeps one item per line so the agent's line-based edits and the
// client's patches touch disjoint lines.
func writeBoard(dir string, board Board) error {
	var out bytes.Buffer
	out.WriteString("{\n  \"nodes\": [")
	if err := writeItems(&out, board.Nodes); err != nil {
		return err
	}
	out.WriteString("],\n  \"edges\": [")
	if err := writeItems(&out, board.Edges); err != nil {
		return err
	}
	out.WriteString("]\n}\n")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	temp, err := os.CreateTemp(dir, ".canvas-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	if _, err := temp.Write(out.Bytes()); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(temp.Name(), filepath.Join(dir, FileName))
}

func writeItems(out *bytes.Buffer, items []Item) error {
	for i, item := range items {
		if i > 0 {
			out.WriteString(",")
		}
		out.WriteString("\n    {")
		for j, key := range itemKeys(item) {
			if j > 0 {
				out.WriteString(",")
			}
			if err := writeJSON(out, key); err != nil {
				return err
			}
			out.WriteString(":")
			if err := writeJSON(out, item[key]); err != nil {
				return err
			}
		}
		out.WriteString("}")
	}
	if len(items) > 0 {
		out.WriteString("\n  ")
	}
	return nil
}

func itemKeys(item Item) []string {
	rank := map[string]int{"id": -2, "type": -1}
	keys := slices.Sorted(maps.Keys(item))
	slices.SortStableFunc(keys, func(a, b string) int { return rank[a] - rank[b] })
	return keys
}

func writeJSON(out *bytes.Buffer, value any) error {
	encoder := json.NewEncoder(out)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return err
	}
	out.Truncate(out.Len() - 1)
	return nil
}
