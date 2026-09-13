package usage

import (
	"errors"
	"testing"
	"time"

	"github.com/wins/jaz/backend/internal/storage"
)

type fakeUsageEventStore struct {
	events []storage.UsageEvent
	since  time.Time
	until  time.Time
	err    error
}

func (s *fakeUsageEventStore) UsageEvents(since, until time.Time) ([]storage.UsageEvent, error) {
	s.since = since
	s.until = until
	if s.err != nil {
		return nil, s.err
	}
	return s.events, nil
}

func TestDailyAggregatesUsageByLocalDay(t *testing.T) {
	loc := time.FixedZone("plus2", 2*60*60)
	now := time.Date(2026, 6, 16, 12, 0, 0, 0, loc)
	store := &fakeUsageEventStore{events: []storage.UsageEvent{
		{
			SessionID: "ignored",
			Usage:     storage.Usage{InputTokens: 100},
			Source:    storage.UsageEventSourceTurn,
			CreatedAt: time.Date(2026, 6, 14, 21, 59, 0, 0,
				time.UTC),
		},
		{
			SessionID: "session-1",
			Usage: storage.Usage{
				InputTokens:  10,
				OutputTokens: 2,
			},
			Source:    storage.UsageEventSourceTurn,
			CreatedAt: time.Date(2026, 6, 14, 22, 30, 0, 0, time.UTC),
		},
		{
			SessionID: "imported",
			Usage: storage.Usage{
				InputTokens:  1_000_000,
				OutputTokens: 1_000_000,
			},
			Source:    storage.UsageEventSourceSessionImport,
			CreatedAt: time.Date(2026, 6, 14, 22, 45, 0, 0, time.UTC),
		},
		{
			SessionID:     "session-1",
			Runtime:       storage.RuntimeACP,
			Agent:         "codex",
			ModelProvider: "openai",
			Model:         "gpt-5.4",
			Usage: storage.Usage{
				CachedInputTokens: 3,
				CachedWriteTokens: 4,
				OutputTokens:      5,
			},
			Source:    storage.UsageEventSourceTurn,
			CreatedAt: time.Date(2026, 6, 15, 21, 59, 0, 0, time.UTC),
		},
		{
			SessionID: "session-2",
			Usage: storage.Usage{
				InputTokens:           7,
				CachedInputTokens:     11,
				CachedWriteTokens:     13,
				OutputTokens:          17,
				ReasoningOutputTokens: 19,
			},
			Source:    storage.UsageEventSourceTurn,
			CreatedAt: time.Date(2026, 6, 15, 22, 15, 0, 0, time.UTC),
		},
	}}
	daily, err := (Service{
		store: store,
		now:   func() time.Time { return now },
	}).Daily(DailyQuery{Days: 2, Location: loc})
	if err != nil {
		t.Fatal(err)
	}
	wantSince := time.Date(2026, 6, 14, 22, 0, 0, 0, time.UTC)
	if !store.since.Equal(wantSince) {
		t.Fatalf("since = %s, want %s", store.since, wantSince)
	}
	if len(daily) != 2 {
		t.Fatalf("days = %d, want 2", len(daily))
	}
	if daily[0].Date != "2026-06-15" || daily[0].SessionCount != 1 {
		t.Fatalf("first bucket = %#v", daily[0])
	}
	if daily[0].Usage.InputTokens != 10 ||
		daily[0].Usage.CachedInputTokens != 3 ||
		daily[0].Usage.CachedWriteTokens != 4 ||
		daily[0].Usage.OutputTokens != 7 ||
		daily[0].Usage.InputOutputTokens() != 14 {
		t.Fatalf("first bucket usage = %#v", daily[0].Usage)
	}
	if len(daily[0].Models) != 1 {
		t.Fatalf("first bucket models = %#v", daily[0].Models)
	}
	model := daily[0].Models[0]
	if model.Agent != "codex" || model.ModelProvider != "openai" || model.Model != "gpt-5.4" ||
		model.Usage.CachedInputTokens != 3 || model.Usage.CachedWriteTokens != 4 ||
		model.Usage.OutputTokens != 5 || model.SessionCount != 1 {
		t.Fatalf("first bucket model = %#v", model)
	}
	if daily[1].Date != "2026-06-16" || daily[1].SessionCount != 1 {
		t.Fatalf("second bucket = %#v", daily[1])
	}
	if daily[1].Usage.InputTokens != 7 ||
		daily[1].Usage.CachedInputTokens != 11 ||
		daily[1].Usage.CachedWriteTokens != 13 ||
		daily[1].Usage.OutputTokens != 17 ||
		daily[1].Usage.ReasoningOutputTokens != 19 ||
		daily[1].Usage.InputOutputTokens() != 17 {
		t.Fatalf("second bucket usage = %#v", daily[1].Usage)
	}
}

func TestDailyCategorizesUsageBySourceType(t *testing.T) {
	now := time.Date(2026, 6, 16, 12, 0, 0, 0, time.UTC)
	day := time.Date(2026, 6, 16, 9, 0, 0, 0, time.UTC)
	store := &fakeUsageEventStore{events: []storage.UsageEvent{
		{SessionID: "chat-a", Usage: storage.Usage{InputTokens: 100, OutputTokens: 10}, Source: storage.UsageEventSourceTurn, CreatedAt: day},
		{SessionID: "chat-b", Usage: storage.Usage{InputTokens: 50, OutputTokens: 5}, Source: storage.UsageEventSourceTurn, CreatedAt: day},
		{SessionID: "loop-1", SourceType: storage.SourceLoopRun, Usage: storage.Usage{InputTokens: 40, OutputTokens: 8}, Source: storage.UsageEventSourceTurn, CreatedAt: day},
		{SessionID: "dream-1", SourceType: storage.SourceMemoryDream, Usage: storage.Usage{InputTokens: 30, OutputTokens: 3}, Source: storage.UsageEventSourceTurn, CreatedAt: day},
		{SessionID: "search-1", SourceType: storage.SourceMemorySearch, Usage: storage.Usage{InputTokens: 20, OutputTokens: 2}, Source: storage.UsageEventSourceTurn, CreatedAt: day},
		{SessionID: "browser-1", SourceType: storage.LegacySourceBrowserTask, Usage: storage.Usage{InputTokens: 10, OutputTokens: 1}, Source: storage.UsageEventSourceTurn, CreatedAt: day},
		{SessionID: "imported", SourceType: storage.SourceLoopRun, Usage: storage.Usage{InputTokens: 9_000}, Source: storage.UsageEventSourceSessionImport, CreatedAt: day},
	}}
	daily, err := (Service{store: store, now: func() time.Time { return now }}).Daily(DailyQuery{Days: 1, Location: time.UTC})
	if err != nil {
		t.Fatal(err)
	}
	bucket := daily[len(daily)-1]
	got := map[string]int64{}
	var summed int64
	for _, category := range bucket.Categories {
		got[category.Category] = category.Usage.InputOutputTokens()
		summed += category.Usage.InputOutputTokens()
	}
	want := map[string]int64{
		CategoryChat:                    165, // two chat sessions, session import excluded
		storage.SourceLoopRun:           48,
		storage.SourceMemoryDream:       33,
		storage.SourceMemorySearch:      22,
		storage.LegacySourceBrowserTask: 11,
	}
	for category, total := range want {
		if got[category] != total {
			t.Fatalf("category %q = %d, want %d (all: %#v)", category, got[category], total, bucket.Categories)
		}
	}
	if summed != bucket.Usage.InputOutputTokens() {
		t.Fatalf("categories sum to %d, daily total is %d", summed, bucket.Usage.InputOutputTokens())
	}
	if first := bucket.Categories[0].Category; first != CategoryChat {
		t.Fatalf("categories not ranked by tokens, first = %q", first)
	}
}

func TestModelsAggregatesACPUsageByModel(t *testing.T) {
	loc := time.FixedZone("plus2", 2*60*60)
	now := time.Date(2026, 6, 16, 12, 0, 0, 0, loc)
	store := &fakeUsageEventStore{events: []storage.UsageEvent{
		{
			SessionID:     "codex-1",
			Runtime:       storage.RuntimeACP,
			Agent:         "codex",
			ModelProvider: "openai",
			Model:         "gpt-5.4",
			Usage: storage.Usage{
				InputTokens:  10,
				OutputTokens: 5,
			},
			Source:    storage.UsageEventSourceTurn,
			CreatedAt: time.Date(2026, 6, 14, 22, 30, 0, 0, time.UTC),
		},
		{
			SessionID:     "codex-1",
			Runtime:       storage.RuntimeACP,
			Agent:         "codex",
			ModelProvider: "openai",
			Model:         "gpt-5.4",
			Usage: storage.Usage{
				CachedInputTokens: 3,
				OutputTokens:      7,
			},
			Source:    storage.UsageEventSourceTurn,
			CreatedAt: time.Date(2026, 6, 15, 22, 15, 0, 0, time.UTC),
		},
		{
			SessionID:     "claude-1",
			Runtime:       storage.RuntimeACP,
			Agent:         "claude",
			ModelProvider: "anthropic",
			Model:         "sonnet",
			Usage: storage.Usage{
				InputTokens:  50,
				OutputTokens: 30,
			},
			Source:    storage.UsageEventSourceTurn,
			CreatedAt: time.Date(2026, 6, 15, 22, 20, 0, 0, time.UTC),
		},
		{
			SessionID: "imported-large",
			Runtime:   storage.RuntimeACP,
			Model:     "ignored-model",
			Usage: storage.Usage{
				InputTokens:  1_000_000,
				OutputTokens: 1_000_000,
			},
			Source:    storage.UsageEventSourceSessionImport,
			CreatedAt: time.Date(2026, 6, 15, 22, 25, 0, 0, time.UTC),
		},
		{
			SessionID: "imported",
			Runtime:   storage.RuntimeACP,
			Agent:     "codex",
			Model:     "gpt-5.4",
			Usage: storage.Usage{
				InputTokens:  1_000_000,
				OutputTokens: 1_000_000,
			},
			Source:    storage.UsageEventSourceSessionImport,
			CreatedAt: time.Date(2026, 6, 15, 22, 30, 0, 0, time.UTC),
		},
	}}
	models, err := (Service{
		store: store,
		now:   func() time.Time { return now },
	}).Models(DailyQuery{Days: 2, Location: loc})
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 2 {
		t.Fatalf("models = %#v, want 2 groups", models)
	}
	if models[0].Agent != "claude" || models[0].ModelProvider != "anthropic" || models[0].Model != "sonnet" {
		t.Fatalf("first model = %#v", models[0])
	}
	if models[0].Usage.InputOutputTokens() != 80 || models[0].SessionCount != 1 {
		t.Fatalf("first model totals = %#v", models[0])
	}
	if models[1].Agent != "codex" || models[1].ModelProvider != "openai" || models[1].Model != "gpt-5.4" {
		t.Fatalf("second model = %#v", models[1])
	}
	if models[1].Usage.InputTokens != 10 ||
		models[1].Usage.CachedInputTokens != 3 ||
		models[1].Usage.OutputTokens != 12 ||
		models[1].Usage.InputOutputTokens() != 19 ||
		models[1].SessionCount != 1 {
		t.Fatalf("second model totals = %#v", models[1])
	}
}

func TestDailyDefaultsAndClampsDays(t *testing.T) {
	now := time.Date(2026, 2, 3, 10, 0, 0, 0, time.UTC)
	service := Service{
		store: &fakeUsageEventStore{},
		now:   func() time.Time { return now },
	}
	daily, err := service.Daily(DailyQuery{Location: time.UTC})
	if err != nil {
		t.Fatal(err)
	}
	if len(daily) != DefaultDailyDays || daily[0].Date != "2026-01-05" || daily[len(daily)-1].Date != "2026-02-03" {
		t.Fatalf("default daily range = %#v", daily)
	}
	daily, err = service.Daily(DailyQuery{Days: MaxDailyDays + 1, Location: time.UTC})
	if err != nil {
		t.Fatal(err)
	}
	if len(daily) != MaxDailyDays {
		t.Fatalf("clamped days = %d, want %d", len(daily), MaxDailyDays)
	}
}

func TestDailyValidationAndUnsupportedStore(t *testing.T) {
	_, err := NewService(nil).Daily(DailyQuery{Days: -1, Location: time.UTC})
	if !errors.Is(err, ErrInvalidDays) {
		t.Fatalf("negative days error = %v, want ErrInvalidDays", err)
	}
	_, err = NewService(nil).Daily(DailyQuery{Days: 1, Location: time.UTC})
	if !errors.Is(err, ErrUnsupported) {
		t.Fatalf("nil store error = %v, want ErrUnsupported", err)
	}
}

func TestCustomWindowIncludesWholeLocalDays(t *testing.T) {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	for _, start := range []time.Time{
		time.Date(2024, 2, 28, 0, 0, 0, 0, loc),
		time.Date(2024, 3, 9, 0, 0, 0, 0, loc),
		time.Date(2024, 11, 2, 0, 0, 0, 0, loc),
	} {
		t.Run(start.Format(DateLayout), func(t *testing.T) {
			end := start.AddDate(0, 0, 3)
			store := &fakeUsageEventStore{}
			for i, date := range []time.Time{start.Add(-time.Nanosecond), start, end.Add(-time.Nanosecond), end} {
				store.events = append(store.events, storage.UsageEvent{
					SessionID:  "session",
					Runtime:    storage.RuntimeACP,
					Agent:      "codex",
					Source:     storage.UsageEventSourceTurn,
					SourceType: "loop_run",
					CreatedAt:  date.UTC(),
					Usage:      storage.Usage{InputTokens: int64(1 << i)},
				})
			}
			service := Service{store: store, now: func() time.Time {
				return time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
			}}
			query := DailyQuery{Range: &DateRange{Start: start, End: end.AddDate(0, 0, -1)}, Location: loc}
			daily, err := service.Daily(query)
			if err != nil {
				t.Fatal(err)
			}
			if !store.since.Equal(start) || !store.until.Equal(end) || len(daily) != 3 {
				t.Fatalf("since = %s, days = %d", store.since, len(daily))
			}
			for i, want := range []int64{2, 0, 4} {
				day := daily[i]
				if day.Date != start.AddDate(0, 0, i).Format(DateLayout) || day.Usage.InputTokens != want {
					t.Fatalf("day %d = %#v, want %d tokens", i, day, want)
				}
				if want > 0 && (len(day.Models) != 1 || day.Models[0].Usage.InputTokens != want ||
					len(day.Categories) != 1 || day.Categories[0].Usage.InputTokens != want) {
					t.Fatalf("breakdowns do not match day: %#v", day)
				}
			}
			models, err := service.Models(query)
			if err != nil || len(models) != 1 || models[0].Usage.InputTokens != 6 || models[0].SessionCount != 1 {
				t.Fatalf("models = %#v, err = %v", models, err)
			}
		})
	}
}

func TestCustomWindowLength(t *testing.T) {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2024, 1, 1, 0, 0, 0, 0, loc)
	service := NewService(&fakeUsageEventStore{})
	for _, days := range []int{1, 365, 366, 0} {
		buckets, err := service.Daily(DailyQuery{Range: &DateRange{Start: start, End: start.AddDate(0, 0, days-1)}, Location: loc})
		if days < 1 || days > 365 {
			if !errors.Is(err, ErrInvalidRange) {
				t.Fatalf("%d days: error = %v", days, err)
			}
		} else if err != nil || len(buckets) != days {
			t.Fatalf("%d days: buckets = %d, error = %v", days, len(buckets), err)
		}
	}
}

func TestHistoricalCalendarTransitions(t *testing.T) {
	for _, test := range []struct {
		zone, first, last, start, end string
		days                          int
	}{
		{"America/Sao_Paulo", "2018-11-04", "2018-11-04", "2018-11-04T03:00:00Z", "2018-11-05T02:00:00Z", 1},
		{"America/Havana", "2024-11-03", "2024-11-03", "2024-11-03T04:00:00Z", "2024-11-04T05:00:00Z", 1},
		{"Pacific/Apia", "2011-12-29", "2011-12-31", "2011-12-29T10:00:00Z", "2011-12-31T10:00:00Z", 3},
		{"Pacific/Apia", "2011-12-30", "2011-12-30", "2011-12-30T10:00:00Z", "2011-12-30T10:00:00Z", 1},
	} {
		t.Run(test.zone+"/"+test.first, func(t *testing.T) {
			loc, err := time.LoadLocation(test.zone)
			if err != nil {
				t.Fatal(err)
			}
			first, _ := time.Parse(DateLayout, test.first)
			last, _ := time.Parse(DateLayout, test.last)
			start, _ := time.Parse(time.RFC3339, test.start)
			end, _ := time.Parse(time.RFC3339, test.end)
			store := &fakeUsageEventStore{}
			for _, instant := range []time.Time{start.Add(-time.Nanosecond), start, end.Add(-time.Nanosecond), end} {
				store.events = append(store.events, storage.UsageEvent{
					Runtime:   storage.RuntimeACP,
					Source:    storage.UsageEventSourceTurn,
					CreatedAt: instant,
					Usage:     storage.Usage{InputTokens: 1},
				})
			}
			service := NewService(store)
			query := DailyQuery{Range: &DateRange{Start: first, End: last}, Location: loc}
			days, err := service.Daily(query)
			if err != nil || len(days) != test.days || days[0].Date != test.first || days[len(days)-1].Date != test.last {
				t.Fatalf("days = %#v, error = %v", days, err)
			}
			if !store.since.Equal(start) || !store.until.Equal(end) {
				t.Fatalf("bounds = [%s, %s), want [%s, %s)", store.since, store.until, start, end)
			}
			var tokens int64
			for _, day := range days {
				tokens += day.Usage.InputTokens
				if day.Date == "2011-12-30" && day.Usage.InputTokens != 0 {
					t.Fatalf("usage on skipped date: %#v", day)
				}
			}
			want := int64(2)
			if start.Equal(end) {
				want = 0
			}
			if tokens != want {
				t.Fatalf("daily tokens = %d, want %d", tokens, want)
			}
			models, err := service.Models(query)
			if err != nil || (want == 0 && len(models) != 0) || (want > 0 && (len(models) != 1 || models[0].Usage.InputTokens != want)) {
				t.Fatalf("models = %#v, error = %v", models, err)
			}
		})
	}
}
