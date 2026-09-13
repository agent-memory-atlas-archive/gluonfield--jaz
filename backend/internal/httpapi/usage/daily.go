package usage

import (
	"errors"
	"net/http"

	"github.com/wins/jaz/backend/internal/httpapi"
	usagecore "github.com/wins/jaz/backend/internal/usage"
)

type dailyHandler struct {
	service usagecore.Service
}

type dailyResponse struct {
	Days []dailyUsageDTO `json:"days"`
}

type dailyUsageDTO struct {
	Date         string             `json:"date"`
	Usage        usageTotalsDTO     `json:"usage"`
	Models       []modelUsageDTO    `json:"models,omitempty"`
	Categories   []categoryUsageDTO `json:"categories,omitempty"`
	SessionCount int                `json:"session_count"`
}

type categoryUsageDTO struct {
	Category string         `json:"category"`
	Usage    usageTotalsDTO `json:"usage"`
}

type usageTotalsDTO struct {
	InputTokens           int64 `json:"input_tokens,omitempty"`
	CachedInputTokens     int64 `json:"cached_input_tokens,omitempty"`
	CachedWriteTokens     int64 `json:"cached_write_tokens,omitempty"`
	OutputTokens          int64 `json:"output_tokens,omitempty"`
	ReasoningOutputTokens int64 `json:"reasoning_output_tokens,omitempty"`
	InputOutputTokens     int64 `json:"input_output_tokens,omitempty"`
}

func NewDailyHandler(service usagecore.Service) http.Handler {
	return dailyHandler{service: service}
}

func (h dailyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	query, err := parseDailyQuery(r)
	if err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, err)
		return
	}
	days, err := h.service.Daily(query)
	switch {
	case errors.Is(err, usagecore.ErrUnsupported):
		httpapi.WriteError(w, http.StatusNotImplemented, err)
	case errors.Is(err, usagecore.ErrInvalidDays), errors.Is(err, usagecore.ErrInvalidRange):
		httpapi.WriteError(w, http.StatusBadRequest, err)
	case err != nil:
		httpapi.WriteError(w, http.StatusInternalServerError, err)
	default:
		httpapi.WriteJSON(w, http.StatusOK, dailyResponse{Days: dailyDTOs(days)})
	}
}

func dailyDTOs(days []usagecore.DailyBucket) []dailyUsageDTO {
	out := make([]dailyUsageDTO, len(days))
	for i, day := range days {
		out[i] = dailyUsageDTO{
			Date:         day.Date,
			Usage:        usageDTO(day.Usage),
			Models:       modelDTOs(day.Models),
			Categories:   categoryDTOs(day.Categories),
			SessionCount: day.SessionCount,
		}
	}
	return out
}

func categoryDTOs(categories []usagecore.CategoryUsage) []categoryUsageDTO {
	out := make([]categoryUsageDTO, len(categories))
	for i, category := range categories {
		out[i] = categoryUsageDTO{
			Category: category.Category,
			Usage:    usageDTO(category.Usage),
		}
	}
	return out
}

func usageDTO(usage usagecore.UsageTotals) usageTotalsDTO {
	return usageTotalsDTO{
		InputTokens:           usage.InputTokens,
		CachedInputTokens:     usage.CachedInputTokens,
		CachedWriteTokens:     usage.CachedWriteTokens,
		OutputTokens:          usage.OutputTokens,
		ReasoningOutputTokens: usage.ReasoningOutputTokens,
		InputOutputTokens:     usage.InputOutputTokens(),
	}
}
