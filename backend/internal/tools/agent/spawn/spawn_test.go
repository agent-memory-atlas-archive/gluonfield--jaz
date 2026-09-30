package spawn

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/wins/jaz/backend/internal/acp"
	"github.com/wins/jaz/backend/internal/sessioncontext"
	"github.com/wins/jaz/backend/internal/tools"
)

type createService struct {
	acp.MCPService
	spawned acp.SpawnRequest
	sent    acp.SendRequest
}

func (s *createService) Agents() []string {
	return []string{acp.AgentCodex}
}

func (s *createService) Spawn(_ context.Context, req acp.SpawnRequest) (acp.SpawnResult, error) {
	s.spawned = req
	return acp.SpawnResult{SessionID: "child"}, nil
}

func (s *createService) Send(_ context.Context, req acp.SendRequest) (acp.Job, error) {
	s.sent = req
	return acp.Job{ID: "child", State: acp.StateRunning}, nil
}

func TestCreateThreadSharesMCPSchemaAndPreservesNativeCaller(t *testing.T) {
	service := &createService{}
	tool := &Tool{Service: service}
	def := tool.Definition()
	mcp := acp.NewMCPTools(service).CreateDefinition()
	data, err := json.Marshal(mcp.InputSchema)
	if err != nil {
		t.Fatal(err)
	}
	var want map[string]any
	if err := json.Unmarshal(data, &want); err != nil {
		t.Fatal(err)
	}
	if tools.DefinitionName(def) != "create_thread" || !reflect.DeepEqual(map[string]any(def.GetFunction().Parameters), want) {
		t.Fatal("native and MCP create_thread schemas differ")
	}
	ctx := sessioncontext.WithSessionID(context.Background(), "parent")
	if _, err := tool.Execute(ctx, map[string]any{"prompt": "Inspect the checkout", "agent": "codex"}); err != nil {
		t.Fatal(err)
	}
	if service.spawned.ParentID != "parent" || service.spawned.ACPAgent != "codex" ||
		service.sent.Session != "child" || service.sent.Message != "Inspect the checkout" {
		t.Fatalf("lost caller or prompt: %#v %#v", service.spawned, service.sent)
	}
}
