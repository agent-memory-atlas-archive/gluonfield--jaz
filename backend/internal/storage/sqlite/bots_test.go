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

func TestPinBotsReplacesTheOrderAndSurvivesEdits(t *testing.T) {
	store, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	var ids []string
	for _, slug := range []string{"a", "b", "c"} {
		thread, err := store.CreateSession(storage.CreateSession{Slug: slug, Title: slug, SourceType: storage.SourceBot})
		if err != nil {
			t.Fatal(err)
		}
		if err := store.SaveBot(storage.BotRecord{ThreadID: thread.ID, Kind: "bot", Shape: "circle", Color: "blue"}); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, thread.ID)
	}
	pins := func() []int {
		var out []int
		for _, id := range ids {
			record, err := store.LoadBot(id)
			if err != nil {
				t.Fatal(err)
			}
			out = append(out, record.Pinned)
		}
		return out
	}
	if err := store.PinBots([]string{ids[0], ids[1]}); err != nil {
		t.Fatal(err)
	}
	if err := store.PinBots([]string{ids[2], ids[0]}); err != nil {
		t.Fatal(err)
	}
	if got := pins(); !reflect.DeepEqual(got, []int{2, 0, 1}) {
		t.Fatalf("pins after reorder = %v", got)
	}
	if err := store.SaveBot(storage.BotRecord{ThreadID: ids[2], Kind: "bot", Shape: "cloud", Color: "teal"}); err != nil {
		t.Fatal(err)
	}
	if got := pins(); !reflect.DeepEqual(got, []int{2, 0, 1}) {
		t.Fatalf("pins after an edit = %v", got)
	}
}
