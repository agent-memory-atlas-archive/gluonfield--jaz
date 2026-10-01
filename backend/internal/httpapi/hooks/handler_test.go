package hooks

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wins/jaz/backend/internal/loops"
)

type fakeRoutines struct {
	loop   loops.Loop
	events []string
}

func (f *fakeRoutines) Load(id string) (loops.Loop, error) {
	if id != f.loop.ID {
		return loops.Loop{}, errors.New("missing")
	}
	return f.loop, nil
}

func (f *fakeRoutines) RunTriggered(_ context.Context, _ string, event string) (loops.Run, error) {
	f.events = append(f.events, event)
	return loops.Run{}, nil
}

func TestWebhookRunsRoutineOnlyWithItsSecret(t *testing.T) {
	secret := "s3cret"
	sum := sha256.Sum256([]byte(secret))
	routines := &fakeRoutines{loop: loops.Loop{ID: "loop-1", Status: loops.StatusPaused, Trigger: &loops.Trigger{Kind: loops.TriggerWebhook}, WebhookHash: hex.EncodeToString(sum[:])}}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/hooks/{routine}", NewHandler(routines).Webhook)

	for _, auth := range []string{"Bearer " + secret, "", "Bearer wrong"} {
		request := httptest.NewRequest(http.MethodPost, "/v1/hooks/loop-1", strings.NewReader("{}"))
		request.Header.Set("Authorization", auth)
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		if response.Code != http.StatusNotFound {
			t.Fatalf("auth %q = %d, want 404", auth, response.Code)
		}
		routines.loop.Status = loops.StatusActive
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/hooks/loop-1", strings.NewReader(`{"status":"deployed"}`))
	request.Header.Set("Authorization", "Bearer "+secret)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusAccepted || len(routines.events) != 1 || !strings.Contains(routines.events[0], `"status":"deployed"`) {
		t.Fatalf("authorized webhook = %d, events %q", response.Code, routines.events)
	}
}
