package preview

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/wins/jaz/backend/internal/httpapi"
	"github.com/wins/jaz/backend/internal/serverconfig"
)

const probePath = "/.well-known/jaz-preview"
const proxyTTL = 8 * time.Hour

type Handler struct {
	mu             sync.RWMutex
	byBase         map[string]previewEntry
	byHost         map[string]previewEntry
	originTemplate *originTemplate
}

type previewEntry struct {
	id        string
	baseURL   string
	serve     http.HandlerFunc
	host      string
	expiresAt time.Time
}

func NewHandler(config serverconfig.Config) (*Handler, error) {
	template, err := parseOriginTemplate(config.PreviewURLTemplate)
	if err != nil {
		return nil, err
	}
	return &Handler{
		byBase:         make(map[string]previewEntry),
		byHost:         make(map[string]previewEntry),
		originTemplate: template,
	}, nil
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if proxy, ok := h.lookup(r.Host); ok {
		if (r.Method == http.MethodGet || r.Method == http.MethodHead) && r.URL.EscapedPath() == probePath {
			serveProbe(w)
			return
		}
		proxy.serve(w, r)
		return
	}
	if r.Method == http.MethodPost && r.URL.EscapedPath() == "/v1/preview/proxies" {
		h.createProxy(w, r)
		return
	}
	if r.Method == http.MethodPost && r.URL.EscapedPath() == "/v1/preview/files" {
		h.createFile(w, r)
		return
	}
	httpapi.WriteError(w, http.StatusNotFound, fmt.Errorf("not found"))
}

func (h *Handler) IsPublicHostRequest(r *http.Request) bool {
	_, ok := h.lookup(r.Host)
	return ok
}

type createPreviewResponse struct {
	URL     string `json:"url"`
	BaseURL string `json:"base_url"`
}

func (h *Handler) register(w http.ResponseWriter, r *http.Request, target *url.URL, entry previewEntry) {
	now := time.Now()
	h.mu.Lock()
	h.pruneLocked(now)
	previous, ok := h.byBase[entry.baseURL]
	id := previous.id
	if !ok {
		var err error
		id, err = randomID()
		if err != nil {
			h.mu.Unlock()
			httpapi.WriteError(w, http.StatusInternalServerError, err)
			return
		}
	}
	source, err := h.previewURL(r, id, target)
	if err != nil {
		h.mu.Unlock()
		httpapi.WriteError(w, http.StatusServiceUnavailable, err)
		return
	}
	host, err := previewHost(source)
	if err != nil {
		h.mu.Unlock()
		httpapi.WriteError(w, http.StatusInternalServerError, err)
		return
	}
	if previous.host != "" && previous.host != host {
		delete(h.byHost, previous.host)
	}
	entry.id = id
	entry.host = host
	entry.expiresAt = now.Add(proxyTTL)
	h.byBase[entry.baseURL] = entry
	h.byHost[host] = entry
	h.mu.Unlock()
	httpapi.WriteJSON(w, http.StatusOK, createPreviewResponse{URL: source, BaseURL: entry.baseURL})
}

func (h *Handler) previewURL(r *http.Request, id string, target *url.URL) (string, error) {
	if h.originTemplate != nil {
		return h.originTemplate.previewURL(id, target), nil
	}
	if source, ok := localPreviewURL(r, id, target); ok {
		return source, nil
	}
	return "", fmt.Errorf("remote preview origin is not configured; set --preview-url-template to an isolated origin containing {id}")
}

func randomID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

func (h *Handler) lookup(host string) (previewEntry, bool) {
	now := time.Now()
	host = canonicalHost(host)
	h.mu.RLock()
	entry, ok := h.byHost[host]
	h.mu.RUnlock()
	if !ok {
		return previewEntry{}, false
	}
	if now.After(entry.expiresAt) {
		h.mu.Lock()
		entry, ok = h.byHost[host]
		if ok && now.After(entry.expiresAt) {
			h.deleteLocked(entry)
			ok = false
		}
		h.mu.Unlock()
		if !ok {
			return previewEntry{}, false
		}
	}
	return entry, true
}

func (h *Handler) pruneLocked(now time.Time) {
	for _, entry := range h.byBase {
		if now.After(entry.expiresAt) {
			h.deleteLocked(entry)
		}
	}
}

func (h *Handler) deleteLocked(proxy previewEntry) {
	delete(h.byHost, proxy.host)
	delete(h.byBase, proxy.baseURL)
}

func serveProbe(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Expose-Headers", "X-Jaz-Preview")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Jaz-Preview", "ready")
	w.WriteHeader(http.StatusNoContent)
}
