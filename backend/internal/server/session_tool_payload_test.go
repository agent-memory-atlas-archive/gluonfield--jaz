package server

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/wins/jaz/backend/internal/acp"
	"github.com/wins/jaz/backend/internal/sessionevents"
	"github.com/wins/jaz/backend/internal/storage"
	sqlitestore "github.com/wins/jaz/backend/internal/storage/sqlite"
)

func TestSessionMessagesPreservesToolPayloadAcrossPlatforms(t *testing.T) {
	store, err := sqlitestore.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})
	session, err := store.CreateSession(storage.CreateSession{Slug: "tool-payload", Runtime: storage.RuntimeACP})
	if err != nil {
		t.Fatal(err)
	}
	call := transcriptToolPayload(t)
	event := transcriptToolEvent(session.ID, call)
	if err := store.AppendSessionEvents(session.ID, event); err != nil {
		t.Fatal(err)
	}
	handler := sessionMessagesHandler(store, store, nil)
	for _, platform := range []string{"mobile", "desktop"} {
		t.Run(platform, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/v1/sessions/"+session.ID+"/messages", nil)
			req.Header.Set(clientPlatformHeader, platform)
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, req)
			if res.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", res.Code, res.Body.String())
			}
			var got struct {
				Events []sessionevents.Event       `json:"events"`
				Calls  []sessionevents.ACPToolCall `json:"acp_tool_calls"`
			}
			if err := json.Unmarshal(res.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if len(got.Events) != 1 || got.Events[0].ACP == nil {
				t.Fatalf("unexpected history: %s", res.Body.String())
			}
			assertTranscriptToolPayload(t, got.Events[0].ACP.ToolCalls, call)
			if len(got.Calls) != 0 {
				t.Fatalf("snapshot repeated transcript tools: %#v", got.Calls)
			}
		})
	}
	stored, err := store.LoadSessionEvents(session.ID)
	if err != nil || len(stored) != 1 || stored[0].ACP == nil {
		t.Fatalf("stored events = %#v, err = %v", stored, err)
	}
	assertTranscriptToolPayload(t, stored[0].ACP.ToolCalls, call)
}

func TestStreamSessionEventsPreservesToolPayloadAcrossPlatforms(t *testing.T) {
	for _, platform := range []string{"mobile", "desktop"} {
		for _, mode := range []string{"replay", "live"} {
			t.Run(platform+"/"+mode, func(t *testing.T) {
				store, err := sqlitestore.New(t.TempDir())
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() {
					_ = store.Close()
				})
				session, err := store.CreateSession(storage.CreateSession{Slug: "tool-events", Runtime: storage.RuntimeACP})
				if err != nil {
					t.Fatal(err)
				}
				call := transcriptToolPayload(t)
				event := transcriptToolEvent(session.ID, call)
				if mode == "replay" {
					if err := store.AppendSessionEvents(session.ID, event); err != nil {
						t.Fatal(err)
					}
				}
				srv := &Server{Store: store, Events: sessionevents.New()}
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					srv.streamSessionEvents(w, r, session.ID)
				}))
				defer server.Close()
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				defer cancel()
				req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL, nil)
				if err != nil {
					t.Fatal(err)
				}
				req.Header.Set(clientPlatformHeader, platform)
				res, err := server.Client().Do(req)
				if err != nil {
					t.Fatal(err)
				}
				defer res.Body.Close()
				if res.StatusCode != http.StatusOK || res.Header.Get("Content-Type") != "text/event-stream" {
					t.Fatalf("stream response = %s, %s", res.Status, res.Header.Get("Content-Type"))
				}
				if mode == "live" {
					srv.Events.Publish(event)
				}
				scanner := bufio.NewScanner(res.Body)
				for scanner.Scan() {
					payload, ok := strings.CutPrefix(scanner.Text(), "data: ")
					if !ok {
						continue
					}
					var got sessionevents.Event
					if err := json.Unmarshal([]byte(payload), &got); err != nil {
						t.Fatal(err)
					}
					if got.Type != event.Type || got.ACP == nil {
						t.Fatalf("unexpected event: %s", payload)
					}
					assertTranscriptToolPayload(t, got.ACP.ToolCalls, call)
					assertTranscriptToolPayload(t, event.ACP.ToolCalls, call)
					return
				}
				t.Fatalf("stream ended without tool event: %v", scanner.Err())
			})
		}
	}
}

func transcriptToolEvent(sessionID string, call sessionevents.ACPToolCall) sessionevents.Event {
	return sessionevents.Event{
		SessionID: sessionID, Type: "acp_tool",
		ACP: &sessionevents.ACPEvent{
			ID: sessionID, Agent: "claude", State: acp.StateRunning,
			ToolCalls: []sessionevents.ACPToolCall{call},
		},
	}
}

func transcriptToolPayload(t *testing.T) sessionevents.ACPToolCall {
	t.Helper()
	var call sessionevents.ACPToolCall
	if err := json.Unmarshal([]byte(`{
		"id":"tool-1","title":"Inspect project files","status":"completed",
		"kind":"execute","tool_name":"Bash",
		"raw_input":{"command":"ls src","description":"Inspect project files","timeout":120000},
		"raw_output":{"stdout":"app.go\n","exit_code":0},
		"content":[{"type":"text","text":"app.go\n"}],
		"locations":[{"path":"/workspace/src/app.go","line":12}],
		"runtime":{"terminal_id":"terminal-1","terminal_cwd":"/workspace","parent_tool_use_id":"parent-1","elapsed_time_seconds":1.5,"terminal_exit_code":0,"terminal_output_at":"2026-09-14T12:00:01Z"},
		"started_at":"2026-09-14T12:00:00Z","updated_at":"2026-09-14T12:00:02Z"
	}`), &call); err != nil {
		t.Fatal(err)
	}
	return call
}

func assertTranscriptToolPayload(t *testing.T, calls []sessionevents.ACPToolCall, want sessionevents.ACPToolCall) {
	t.Helper()
	if len(calls) != 1 {
		t.Fatalf("tool calls = %#v", calls)
	}
	gotJSON, err := json.Marshal(calls[0])
	if err != nil {
		t.Fatal(err)
	}
	wantJSON, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	if string(gotJSON) != string(wantJSON) {
		t.Fatalf("tool payload changed\ngot:  %s\nwant: %s", gotJSON, wantJSON)
	}
}
