package memoryservice

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/gluonfield/jazmem/pkg/jazmem"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wins/jaz/backend/internal/mcpsession"
	"github.com/wins/jaz/backend/internal/storage"
)

func TestGatedJazmemGetPageAcceptsAbsoluteMemoryPage(t *testing.T) {
	root := t.TempDir()
	mem, err := jazmem.Open(jazmem.Config{Root: root, DBPath: filepath.Join(t.TempDir(), "index.sqlite")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = mem.Close() })
	if err := os.MkdirAll(filepath.Join(root, "sources", "chat", "telegram", "42"), 0o755); err != nil {
		t.Fatal(err)
	}
	pagePath := filepath.Join(root, "sources", "chat", "telegram", "42", "contacts.md")
	if err := os.WriteFile(pagePath, []byte("# Contacts\n\n- Alice"), 0o644); err != nil {
		t.Fatal(err)
	}

	page, err := (gatedJazmem{service: New(mem, memorySettingsStore{}, nil, "")}).GetPage(context.Background(), pagePath)
	if err != nil {
		t.Fatal(err)
	}
	if page.Slug != "sources/chat/telegram/42/contacts" || page.Body != "# Contacts\n\n- Alice" {
		t.Fatalf("page = %#v", page)
	}
}

func TestMemorySearchDelegatesWithCallingSession(t *testing.T) {
	for _, limit := range []int{0, 5, 100} {
		service := New(nil, memorySettingsStore{}, nil, "")
		var got SearchRequest
		service.SetSearcher(searcherFunc(func(_ context.Context, req SearchRequest) (string, error) {
			got = req
			return "Answer [source](projects/jaz)", nil
		}))
		result, structured, err := (memoryTools{service: service}).Search(context.Background(), &mcp.CallToolRequest{
			Extra: &mcp.RequestExtra{Header: mcpsession.Header("parent-session")},
		}, SearchInput{Query: "  active chat context  ", Limit: limit, Deep: true})
		if err != nil {
			t.Fatal(err)
		}
		wantLimit := min(limit, 50)
		if limit == 0 {
			wantLimit = 10
		}
		if got != (SearchRequest{Query: "active chat context", Limit: wantLimit, Deep: true, ParentID: "parent-session"}) {
			t.Fatalf("request = %#v", got)
		}
		if structured != nil || len(result.Content) != 1 || result.Content[0].(*mcp.TextContent).Text != "Answer [source](projects/jaz)" {
			t.Fatalf("result = %#v, structured = %#v", result, structured)
		}
	}
}

func TestMemorySearchReturnsWorkerError(t *testing.T) {
	service := New(nil, memorySettingsStore{}, nil, "")
	want := errors.New("provider unavailable")
	service.SetSearcher(searcherFunc(func(context.Context, SearchRequest) (string, error) {
		return "", want
	}))
	_, _, err := (memoryTools{service: service}).Search(context.Background(), nil, SearchInput{Query: "Jaz"})
	if !errors.Is(err, want) {
		t.Fatalf("error = %v", err)
	}
}

type searcherFunc func(context.Context, SearchRequest) (string, error)

func (f searcherFunc) SearchMemory(ctx context.Context, req SearchRequest) (string, error) {
	return f(ctx, req)
}

func TestGatedJazmemGetPageRejectsAbsolutePathOutsideMemoryRoot(t *testing.T) {
	root := t.TempDir()
	mem, err := jazmem.Open(jazmem.Config{Root: root, DBPath: filepath.Join(t.TempDir(), "index.sqlite")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = mem.Close() })

	_, err = (gatedJazmem{service: New(mem, memorySettingsStore{}, nil, "")}).GetPage(context.Background(), filepath.Join(t.TempDir(), "raw.jsonl"))
	if err == nil {
		t.Fatal("expected absolute non-memory path to be rejected")
	}
}

func TestNormalizeMemoryPagePath(t *testing.T) {
	root := t.TempDir()
	for _, tc := range []struct {
		name  string
		input string
		want  string
	}{
		{"slug", "people/alice", "people/alice"},
		{"relative markdown", "sources/chat/telegram/42/contacts.md", "sources/chat/telegram/42/contacts"},
		{"absolute markdown", filepath.Join(root, "sources", "chat", "telegram", "42", "contacts.md"), "sources/chat/telegram/42/contacts"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := normalizeMemoryPagePath(root, tc.input)
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Fatalf("normalizeMemoryPagePath(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

type memorySettingsStore struct{}

func (memorySettingsStore) LoadSetting(_, _ string) (storage.Setting, error) {
	return storage.Setting{}, storage.ErrSettingNotFound
}

func (memorySettingsStore) SaveSetting(namespace, key string, value json.RawMessage) (storage.Setting, error) {
	return storage.Setting{Namespace: namespace, Key: key, Value: value}, nil
}

func (memorySettingsStore) DeleteSetting(_, _ string) error { return nil }

func (memorySettingsStore) ListSettings(string) ([]storage.Setting, error) { return nil, nil }
