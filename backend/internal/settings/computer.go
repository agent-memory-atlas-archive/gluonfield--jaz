package settings

import (
	"encoding/json"
	"errors"

	"github.com/wins/jaz/backend/internal/storage"
)

const (
	ComputerSettingsNamespace = "computer"
	ComputerSettingsKey       = "settings"
)

type ComputerSettings struct {
	Enabled bool `json:"enabled"`
}

func LoadComputerSettings(store storage.SettingsStorage) (ComputerSettings, error) {
	setting, err := store.LoadSetting(ComputerSettingsNamespace, ComputerSettingsKey)
	if errors.Is(err, storage.ErrSettingNotFound) {
		return ComputerSettings{}, nil
	}
	if err != nil {
		return ComputerSettings{}, err
	}
	var settings ComputerSettings
	if err := json.Unmarshal([]byte(setting.Value), &settings); err != nil {
		return ComputerSettings{}, err
	}
	return settings, nil
}

func SaveComputerSettings(store storage.SettingsStorage, settings ComputerSettings) (ComputerSettings, error) {
	data, err := json.Marshal(settings)
	if err != nil {
		return ComputerSettings{}, err
	}
	if _, err := store.SaveSetting(ComputerSettingsNamespace, ComputerSettingsKey, data); err != nil {
		return ComputerSettings{}, err
	}
	return settings, nil
}

func ComputerEnabled(store storage.SettingsStorage) bool {
	settings, err := LoadComputerSettings(store)
	return err == nil && settings.Enabled
}
