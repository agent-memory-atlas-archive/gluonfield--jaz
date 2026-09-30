package mcpconfig_test

import (
	"strings"
	"testing"

	"github.com/wins/jaz/backend/internal/mcpconfig"
	sqlitestore "github.com/wins/jaz/backend/internal/storage/sqlite"
)

// JAZ_MCP_SERVERS wires a deployment's servers on every start: added once,
// kept under their name, and restored to the declared settings.
func TestDeclareAppliesServersByName(t *testing.T) {
	store, err := sqlitestore.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	declare := func(raw string) []mcpconfig.Server {
		t.Helper()
		if err := mcpconfig.Declare(store, raw); err != nil {
			t.Fatal(err)
		}
		servers, err := store.ListMCPServers()
		if err != nil {
			t.Fatal(err)
		}
		return servers
	}
	if servers := declare(" "); len(servers) != 0 {
		t.Fatalf("an empty declaration added servers: %+v", servers)
	}
	tasks := `[{"name":"Tasks","url":"http://tasks:7400/mcp","bearer_token_env_var":"JAZ_TASKS_API_KEY"}]`
	first := declare(tasks)
	if len(first) != 1 || first[0].Name != "Tasks" || !first[0].Enabled || first[0].BearerTokenEnvVar != "JAZ_TASKS_API_KEY" {
		t.Fatalf("declared servers = %+v", first)
	}
	if _, err := store.SetMCPServerEnabled(first[0].ID, false); err != nil {
		t.Fatal(err)
	}
	moved := declare(strings.Replace(tasks, "tasks:7400", "tasks.internal:7400", 1))
	if len(moved) != 1 || moved[0].ID != first[0].ID || moved[0].URL != "http://tasks.internal:7400/mcp" || !moved[0].Enabled {
		t.Fatalf("a restart should update the same server to the declared settings: %+v", moved)
	}
	for _, bad := range []string{`{"name":"Tasks"}`, `[{"name":"Tasks","url":"ftp://tasks"}]`} {
		if err := mcpconfig.Declare(store, bad); err == nil {
			t.Fatalf("Declare(%s) should fail", bad)
		}
	}
}
