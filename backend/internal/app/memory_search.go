package app

import (
	"github.com/wins/jaz/backend/internal/acp"
	"github.com/wins/jaz/backend/internal/memorysearch"
	"github.com/wins/jaz/backend/internal/memoryservice"
	sqlitestore "github.com/wins/jaz/backend/internal/storage/sqlite"
)

func ConfigureMemorySearch(memory *memoryservice.Service, store *sqlitestore.Store, manager *acp.Manager) {
	memory.SetSearcher(memorysearch.New(store, manager))
}
