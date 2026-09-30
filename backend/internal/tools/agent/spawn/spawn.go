package spawn

import (
	"context"
	"encoding/json"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wins/jaz/backend/internal/acp"
	"github.com/wins/jaz/backend/internal/helpers"
	"github.com/wins/jaz/backend/internal/mcpsession"
	"github.com/wins/jaz/backend/internal/sessioncontext"
	"github.com/wins/jaz/backend/internal/tools"
)

type Tool struct {
	Service acp.MCPService
}

func (t *Tool) Definition() tools.Definition {
	def := acp.NewMCPTools(t.Service).CreateDefinition()
	data, err := json.Marshal(def.InputSchema)
	if err != nil {
		panic(err)
	}
	var schema map[string]any
	if err := json.Unmarshal(data, &schema); err != nil {
		panic(err)
	}
	return tools.Function(def.Name, def.Description, true, schema)
}

func (t *Tool) Execute(ctx context.Context, inputs map[string]any) (tools.Result, error) {
	input, err := helpers.DecodeMap[acp.MCPCreateInput](inputs)
	if err != nil {
		return tools.Result{}, err
	}
	req := &mcp.CallToolRequest{Extra: &mcp.RequestExtra{Header: mcpsession.Header(sessioncontext.SessionID(ctx))}}
	_, result, err := acp.NewMCPTools(t.Service).Create(ctx, req, input)
	if err != nil {
		return tools.Result{}, err
	}
	return tools.JSONResult(result)
}
