package app

import (
	"github.com/gluonfield/jazmem/pkg/jazmem"
	"github.com/wins/jaz/backend/internal/acp"
	"github.com/wins/jaz/backend/internal/memorydream"
	sqlitestore "github.com/wins/jaz/backend/internal/storage/sqlite"
)

func ConfigureMemoryDreamRunner(memory *jazmem.Memory, store *sqlitestore.Store, manager *acp.Manager, queue MemorySourceQueue) {
	memory.SetDreamRunner(memorydream.New(store, manager, queue.Queue))
}
