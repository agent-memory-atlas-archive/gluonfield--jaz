package bots

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	botcore "github.com/wins/jaz/backend/internal/bots"
	"github.com/wins/jaz/backend/internal/httpapi"
	"github.com/wins/jaz/backend/internal/loops"
	"github.com/wins/jaz/backend/internal/storage"
)

type Handler struct {
	bots     *botcore.Service
	routines Routines
}

// Routines is what webhook deliveries need from the loop service.
type Routines interface {
	Load(string) (loops.Loop, error)
	RunTriggered(context.Context, string, string) (loops.Run, error)
}

func NewHandler(bots *botcore.Service, routines Routines) *Handler {
	return &Handler{bots: bots, routines: routines}
}

type listResponse struct {
	Bots []botcore.Bot `json:"bots"`
}

type groupRequest struct {
	Name    string   `json:"name"`
	Members []string `json:"members"`
}

type messageRequest struct {
	Text string `json:"text"`
}

func (h *Handler) List(w http.ResponseWriter, _ *http.Request) {
	bots, err := h.bots.List()
	if err != nil {
		httpapi.WriteError(w, http.StatusInternalServerError, err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, listResponse{Bots: bots})
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	bot, err := h.bots.Load(r.PathValue("bot"))
	writeBot(w, bot, err)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var input botcore.CreateBot
	if !decode(w, r, &input) {
		return
	}
	bot, err := h.bots.Create(r.Context(), input)
	writeBot(w, bot, err)
}

func (h *Handler) CreateGroup(w http.ResponseWriter, r *http.Request) {
	var input groupRequest
	if !decode(w, r, &input) {
		return
	}
	bot, err := h.bots.CreateGroup(input.Name, input.Members)
	writeBot(w, bot, err)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	var input botcore.UpdateBot
	if !decode(w, r, &input) {
		return
	}
	bot, err := h.bots.Update(r.Context(), r.PathValue("bot"), input)
	writeBot(w, bot, err)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	if err := h.bots.Delete(r.PathValue("bot")); err != nil {
		httpapi.WriteError(w, errorStatus(err), err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) Post(w http.ResponseWriter, r *http.Request) {
	var input messageRequest
	if !decode(w, r, &input) {
		return
	}
	if err := h.bots.Post(r.PathValue("bot"), input.Text); err != nil {
		httpapi.WriteError(w, errorStatus(err), err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

// Webhook runs a webhook routine. The caller proves itself with the
// routine's secret as a bearer token; the body is handed to the run.
func (h *Handler) Webhook(w http.ResponseWriter, r *http.Request) {
	routine, err := h.routines.Load(r.PathValue("routine"))
	secret := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if err != nil || !loops.VerifyWebhookSecret(routine, secret) {
		httpapi.WriteError(w, http.StatusNotFound, errors.New("no such webhook"))
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 16<<10))
	if err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, err)
		return
	}
	event := "webhook"
	if text := strings.TrimSpace(string(body)); text != "" {
		event = fmt.Sprintf("webhook with body:\n%s", text)
	}
	if _, err := h.routines.RunTriggered(context.WithoutCancel(r.Context()), routine.ID, event); err != nil {
		httpapi.WriteError(w, http.StatusConflict, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func decode(w http.ResponseWriter, r *http.Request, target any) bool {
	if err := json.NewDecoder(r.Body).Decode(target); err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, err)
		return false
	}
	return true
}

func writeBot(w http.ResponseWriter, bot botcore.Bot, err error) {
	if err != nil {
		httpapi.WriteError(w, errorStatus(err), err)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, bot)
}

func errorStatus(err error) int {
	if errors.Is(err, storage.ErrBotNotFound) {
		return http.StatusNotFound
	}
	return http.StatusBadRequest
}
