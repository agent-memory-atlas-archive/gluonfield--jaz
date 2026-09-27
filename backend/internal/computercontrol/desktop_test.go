package computercontrol

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func desktopPeer(t *testing.T, backend *DesktopBackend, session string) *websocket.Conn {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upgrader := websocket.Upgrader{}
		ws, err := upgrader.Upgrade(w, r, nil)
		if err == nil {
			backend.Connect(r.Context(), session, ws)
		}
	}))
	t.Cleanup(server.Close)
	peer, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = peer.Close() })
	for deadline := time.Now().Add(time.Second); time.Now().Before(deadline); {
		backend.mu.Lock()
		connected := backend.connections[session] != nil
		backend.mu.Unlock()
		if connected {
			return peer
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("desktop did not connect")
	return nil
}

func TestCancelKeepsTransportAndStatusAvailable(t *testing.T) {
	backend := NewDesktopBackend()
	defer backend.Close()
	peer := desktopPeer(t, backend, "thread")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	completed := make(chan error, 1)
	go func() {
		_, err := backend.Call(ctx, ActionInput{Session: "thread", Action: ActionScript, Code: "await computer.tools()"})
		completed <- err
	}()
	var script rpcMessage
	if err := peer.ReadJSON(&script); err != nil || script.Method != "Jaz.run" {
		t.Fatalf("script=%+v err=%v", script, err)
	}
	statusResult := make(chan ActionOutput, 1)
	go func() {
		output, _ := backend.Call(context.Background(), ActionInput{Session: "thread", Action: ActionStatus})
		statusResult <- output
	}()
	var status rpcMessage
	if err := peer.ReadJSON(&status); err != nil || status.Method != "Jaz.status" {
		t.Fatalf("status blocked by running script: %+v %v", status, err)
	}
	if err := peer.WriteJSON(rpcMessage{ID: status.ID, Result: json.RawMessage(`{"status":"connected","text":"busy"}`)}); err != nil {
		t.Fatal(err)
	}
	if output := <-statusResult; output.Text != "busy" {
		t.Fatalf("status=%+v", output)
	}
	cancel()
	if err := <-completed; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel error=%v", err)
	}
	var cancelled rpcMessage
	if err := peer.ReadJSON(&cancelled); err != nil || cancelled.Method != "Jaz.cancel" {
		t.Fatalf("cancel=%+v err=%v", cancelled, err)
	}
	params := cancelled.Params.(map[string]any)
	if int64(params["id"].(float64)) != script.ID {
		t.Fatal("cancel targeted a different script")
	}
	if err := peer.WriteJSON(rpcMessage{ID: script.ID, Result: json.RawMessage(`{"status":"late"}`)}); err != nil {
		t.Fatal(err)
	}
	go func() {
		output, _ := backend.Call(context.Background(), ActionInput{Session: "thread", Action: ActionStatus})
		statusResult <- output
	}()
	if err := peer.ReadJSON(&status); err != nil {
		t.Fatal(err)
	}
	if err := peer.WriteJSON(rpcMessage{ID: status.ID, Result: json.RawMessage(`{"status":"connected"}`)}); err != nil {
		t.Fatal(err)
	}
	if output := <-statusResult; output.Status != "connected" {
		t.Fatalf("late script result corrupted status: %+v", output)
	}
}

func TestSessionRoutingAndDisconnect(t *testing.T) {
	backend := NewDesktopBackend()
	peer := desktopPeer(t, backend, "one")
	other := desktopPeer(t, backend, "two")
	for _, connection := range []*websocket.Conn{peer, other} {
		go func(peer *websocket.Conn) {
			var request rpcMessage
			if peer.ReadJSON(&request) == nil {
				_ = peer.WriteJSON(rpcMessage{ID: request.ID, Result: json.RawMessage(`{"status":"ok","image_base64":"aW1hZ2U=","image_mime_type":"image/png"}`)})
			}
		}(connection)
	}
	for _, session := range []string{"one", "two"} {
		output, err := backend.Call(context.Background(), ActionInput{Session: session, Action: ActionScript})
		if err != nil || string(output.ImageData) != "image" {
			t.Fatalf("session=%s output=%+v error=%v", session, output, err)
		}
	}
	if _, err := backend.Call(context.Background(), ActionInput{Session: "missing", Action: ActionScript}); err == nil {
		t.Fatal("unconnected session controlled another session's desktop")
	}
	if err := backend.Close(); err != nil {
		t.Fatal(err)
	}
	output, err := backend.Call(context.Background(), ActionInput{Session: "one", Action: ActionStatus})
	if err != nil || output.Status != "disconnected" {
		t.Fatalf("disconnected status=%+v error=%v", output, err)
	}
}

func TestInputAndScreenshotBounds(t *testing.T) {
	if _, err := normalizeInput(ActionInput{Action: ActionScript, Code: strings.Repeat("a", 150001)}); err == nil {
		t.Fatal("unbounded script accepted")
	}
	if _, err := normalizeInput(ActionInput{Action: "shell"}); err == nil {
		t.Fatal("unknown action accepted")
	}
	for _, image := range []string{"invalid!", strings.Repeat("a", computerImageBase64Limit+1)} {
		if _, err := decodeOutput(wireOutput{ImageBase64: image, ImageMIMEType: "image/png"}); err == nil {
			t.Fatal("invalid image accepted")
		}
	}
}

func TestAlreadyCancelledScriptNeverReachesDesktop(t *testing.T) {
	backend := NewDesktopBackend()
	defer backend.Close()
	desktopPeer(t, backend, "thread")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := backend.Call(ctx, ActionInput{Session: "thread", Action: ActionScript}); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled call error=%v", err)
	}
	backend.mu.Lock()
	connection := backend.connections["thread"]
	backend.mu.Unlock()
	connection.mu.Lock()
	defer connection.mu.Unlock()
	if connection.nextID != 0 {
		t.Fatal("cancelled request was dispatched")
	}
}
