package sqlite

import (
	"errors"
	"reflect"
	"testing"

	"github.com/wins/jaz/backend/internal/loops"
	"github.com/wins/jaz/backend/internal/storage"
)

func TestBotRecordAndRoutineOwnershipRoundTrip(t *testing.T) {
	store, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	thread, err := store.CreateSession(storage.CreateSession{Slug: "group", Title: "Launch", SourceType: storage.SourceBot})
	if err != nil {
		t.Fatal(err)
	}
	record := storage.BotRecord{ThreadID: thread.ID, Kind: "group", Shape: "cloud", Color: "teal", Members: []string{"a", "b"}}
	if err := store.SaveBot(record); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.LoadBot(thread.ID)
	if err != nil || !reflect.DeepEqual(loaded, record) {
		t.Fatalf("loaded bot = %+v, %v", loaded, err)
	}
	if _, err := store.LoadBot("missing"); !errors.Is(err, storage.ErrBotNotFound) {
		t.Fatalf("missing bot = %v", err)
	}

	service := newLoopServiceForTest(store, nil)
	created, err := service.Create(loops.CreateLoop{Prompt: "ping me", BotID: thread.ID, Trigger: &loops.Trigger{Kind: loops.TriggerWebhook}})
	if err != nil {
		t.Fatal(err)
	}
	stored, err := store.LoadLoop(created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.BotID != thread.ID || stored.Trigger == nil || stored.Trigger.Kind != loops.TriggerWebhook || stored.WebhookHash == "" || stored.WebhookSecret != "" {
		t.Fatalf("stored routine = %+v", stored)
	}
	if !loops.VerifyWebhookSecret(stored, created.WebhookSecret) {
		t.Fatal("the secret returned at creation does not open the stored routine")
	}
}
