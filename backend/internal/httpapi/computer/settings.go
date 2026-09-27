package computer

import (
	"encoding/json"
	"net/http"

	"github.com/wins/jaz/backend/internal/httpapi"
	jazsettings "github.com/wins/jaz/backend/internal/settings"
	"github.com/wins/jaz/backend/internal/storage"
)

type SettingsHandler struct {
	Store  storage.SettingsStorage
	OnSave func()
}

type settingsInput struct {
	Enabled *bool `json:"enabled"`
}

func (h SettingsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	settings, err := jazsettings.LoadComputerSettings(h.Store)
	if err != nil {
		httpapi.WriteError(w, http.StatusInternalServerError, err)
		return
	}
	if r.Method == http.MethodPut {
		var input settingsInput
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input); err != nil {
			httpapi.WriteError(w, http.StatusBadRequest, err)
			return
		}
		if input.Enabled != nil {
			settings.Enabled = *input.Enabled
		}
		settings, err = jazsettings.SaveComputerSettings(h.Store, settings)
		if err != nil {
			httpapi.WriteError(w, http.StatusInternalServerError, err)
			return
		}
		if h.OnSave != nil {
			h.OnSave()
		}
	}
	httpapi.WriteJSON(w, http.StatusOK, settings)
}
