package usage

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/wins/jaz/backend/internal/storage"
	jsonstore "github.com/wins/jaz/backend/internal/storage/json"
	usagecore "github.com/wins/jaz/backend/internal/usage"
)

func TestDailyHandler(t *testing.T) {
	store, err := jsonstore.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	session, err := store.CreateSession(storage.CreateSession{
		Slug:          "usage",
		Runtime:       storage.RuntimeACP,
		RuntimeRef:    &storage.RuntimeRef{Agent: "codex"},
		ModelProvider: "openai",
		Model:         "gpt-5.4",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.AddUsage(session.ID, storage.Usage{
		InputTokens:       42,
		CachedInputTokens: 30,
		OutputTokens:      4,
	}); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/usage/daily?days=1&timezone=UTC", nil)
	res := httptest.NewRecorder()

	NewDailyHandler(usagecore.NewService(store)).ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", res.Code, res.Body.String())
	}
	var got struct {
		Days []struct {
			Usage  map[string]int64 `json:"usage"`
			Models []struct {
				Agent         string           `json:"agent"`
				ModelProvider string           `json:"model_provider"`
				Model         string           `json:"model"`
				Usage         map[string]int64 `json:"usage"`
				SessionCount  int              `json:"session_count"`
			} `json:"models"`
			Categories []struct {
				Category string           `json:"category"`
				Usage    map[string]int64 `json:"usage"`
			} `json:"categories"`
			SessionCount int `json:"session_count"`
		} `json:"days"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Days) != 1 || got.Days[0].SessionCount != 1 ||
		got.Days[0].Usage["input_tokens"] != 42 ||
		got.Days[0].Usage["cached_input_tokens"] != 30 ||
		got.Days[0].Usage["output_tokens"] != 4 ||
		got.Days[0].Usage["input_output_tokens"] != 16 {
		t.Fatalf("daily usage = %#v", got.Days)
	}
	if _, ok := got.Days[0].Usage["total_tokens"]; ok {
		t.Fatalf("daily response must not overload total_tokens: %#v", got.Days[0].Usage)
	}
	if len(got.Days[0].Models) != 1 {
		t.Fatalf("daily models = %#v", got.Days[0].Models)
	}
	model := got.Days[0].Models[0]
	if model.Agent != "codex" || model.ModelProvider != "openai" || model.Model != "gpt-5.4" ||
		model.Usage["input_tokens"] != 42 || model.Usage["cached_input_tokens"] != 30 ||
		model.Usage["output_tokens"] != 4 || model.Usage["input_output_tokens"] != 16 || model.SessionCount != 1 {
		t.Fatalf("daily model = %#v", model)
	}
	if len(got.Days[0].Categories) != 1 {
		t.Fatalf("daily categories = %#v", got.Days[0].Categories)
	}
	category := got.Days[0].Categories[0]
	if category.Category != "chat" || category.Usage["input_tokens"] != 42 ||
		category.Usage["output_tokens"] != 4 || category.Usage["input_output_tokens"] != 16 {
		t.Fatalf("daily category = %#v", category)
	}
}

func TestDailyHandlerRejectsInvalidDays(t *testing.T) {
	for _, path := range []string{"/v1/usage/daily?days=-1", "/v1/usage/daily?days=0"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		res := httptest.NewRecorder()

		NewDailyHandler(usagecore.NewService(nil)).ServeHTTP(res, req)

		if res.Code != http.StatusBadRequest {
			t.Fatalf("%s status = %d, body = %s", path, res.Code, res.Body.String())
		}
	}
}

func TestUsageHandlersRejectInvalidRanges(t *testing.T) {
	for name, handler := range map[string]http.Handler{
		"daily":  NewDailyHandler(usagecore.NewService(nil)),
		"models": NewModelsHandler(usagecore.NewService(nil)),
	} {
		for _, query := range []string{
			"start=",
			"end=",
			"start=&end=",
			"start=%20&end=%20",
			"start=2024-03-09",
			"end=2024-03-11",
			"start=2024-03-11&end=2024-03-09",
			"start=2024-01-01&end=2024-12-31",
			"start=2024-02-30&end=2024-03-01",
			"start=invalid&end=2024-03-01",
			"start=2024-03-09&end=2024-03-11&days=3",
		} {
			t.Run(name+"/"+query, func(t *testing.T) {
				res := httptest.NewRecorder()
				handler.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/?"+query, nil))
				if res.Code != http.StatusBadRequest {
					t.Fatalf("status = %d, body = %s", res.Code, res.Body.String())
				}
			})
		}
	}
}

func TestDailyHandlerCustomDateRange(t *testing.T) {
	store, err := jsonstore.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	res := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/?start=2024-03-09&end=2024-03-11&timezone=America%2FNew_York", nil)
	NewDailyHandler(usagecore.NewService(store)).ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", res.Code, res.Body.String())
	}
	var got dailyResponse
	if err := json.Unmarshal(res.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Days) != 3 || got.Days[0].Date != "2024-03-09" || got.Days[2].Date != "2024-03-11" {
		t.Fatalf("days = %#v", got.Days)
	}
	query, err := parseDailyQuery(req)
	if err != nil || query.Range == nil || query.Range.Start.Format(usagecore.DateLayout) != "2024-03-09" || query.Range.End.Format(usagecore.DateLayout) != "2024-03-11" || query.Location.String() != "America/New_York" {
		t.Fatalf("query = %#v, err = %v", query, err)
	}
}

func TestDailyHandlerDoesNotTreatZeroDateAsOmitted(t *testing.T) {
	store, err := jsonstore.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	res := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/?start=0001-01-01&end=0001-01-01&timezone=UTC", nil)
	NewDailyHandler(usagecore.NewService(store)).ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", res.Code, res.Body.String())
	}
	var got dailyResponse
	if err := json.Unmarshal(res.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Days) != 1 || got.Days[0].Date != "0001-01-01" {
		t.Fatalf("requested date was replaced by the default period: %#v", got.Days)
	}
}
