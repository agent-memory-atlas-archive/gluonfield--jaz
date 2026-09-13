package jsonstore

import (
	"testing"
	"time"

	"github.com/wins/jaz/backend/internal/storage"
)

func TestUsageEventsWindow(t *testing.T) {
	store, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	session, err := store.CreateSession(storage.CreateSession{Slug: "usage-window", Runtime: storage.RuntimeACP})
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2024, 3, 10, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 0, 1)
	for _, instant := range []time.Time{start.Add(-time.Nanosecond), start, end.Add(-time.Nanosecond), end} {
		if err := store.appendUsageEvent(session, storage.Usage{InputTokens: 1}, 1, 0, instant); err != nil {
			t.Fatal(err)
		}
	}
	events, err := store.UsageEvents(start, end)
	if err != nil || len(events) != 2 || !events[0].CreatedAt.Equal(start) || !events[1].CreatedAt.Equal(end.Add(-time.Nanosecond)) {
		t.Fatalf("events = %#v, error = %v", events, err)
	}
	events, err = store.UsageEvents(end, time.Time{})
	if err != nil || len(events) != 1 || !events[0].CreatedAt.Equal(end) {
		t.Fatalf("unbounded events = %#v, error = %v", events, err)
	}
}
