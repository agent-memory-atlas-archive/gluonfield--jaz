package app

import (
	"context"
	"net/http"
	"time"

	"github.com/wins/jaz/backend/internal/computercontrol"
	computerapi "github.com/wins/jaz/backend/internal/httpapi/computer"
	"github.com/wins/jaz/backend/internal/jaztools"
	mcpruntime "github.com/wins/jaz/backend/internal/mcp"
	"github.com/wins/jaz/backend/internal/settings"
	sqlitestore "github.com/wins/jaz/backend/internal/storage/sqlite"
	"go.uber.org/fx"
)

type ComputerSettingsHandler struct {
	http.Handler
}

func NewComputerSettingsHandler(store *sqlitestore.Store, jaz *jaztools.Service, mcp *mcpruntime.Manager, backend *computercontrol.DesktopBackend) *ComputerSettingsHandler {
	return &ComputerSettingsHandler{Handler: computerapi.SettingsHandler{Store: store, OnSave: func() {
		if !settings.ComputerEnabled(store) {
			_ = backend.Close()
		}
		jaz.Sync()
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			mcp.Refresh(ctx)
		}()
	}}}
}

func ConfigureComputerTools(jaz *jaztools.Service, store *sqlitestore.Store, backend *computercontrol.DesktopBackend) {
	jaz.SetComputer(store, backend)
}

func CloseComputerBackend(lifecycle fx.Lifecycle, backend *computercontrol.DesktopBackend) {
	lifecycle.Append(fx.Hook{OnStop: func(context.Context) error {
		return backend.Close()
	}})
}
