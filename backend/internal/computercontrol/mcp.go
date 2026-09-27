package computercontrol

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wins/jaz/backend/internal/mcpsession"
)

const (
	ToolStatus = "computer_status"
	ToolScript = "computer_js"
)

var toolNames = []string{ToolStatus, ToolScript}

type Backend interface {
	Call(context.Context, ActionInput) (ActionOutput, error)
}

type EmptyInput struct{}

type ScriptInput struct {
	Code string `json:"code" jsonschema:"JavaScript to run in the persistent native-computer session; pass an empty string for API documentation"`
}

type ToolOutput struct {
	Status string `json:"status"`
	Text   string `json:"text,omitempty"`
}

func MCPToolNames() []string {
	return append([]string(nil), toolNames...)
}

func AddMCPTools(server *mcp.Server, backend Backend) {
	tools := directTools{backend: backend}
	openWorld := true
	destructive := true
	mcp.AddTool(server, &mcp.Tool{
		Name:        ToolStatus,
		Title:       "Computer use status",
		Description: "Check whether this conversation is connected to Jaz desktop computer use and whether required operating-system permissions are granted.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: &openWorld},
	}, tools.Status)
	mcp.AddTool(server, &mcp.Tool{
		Name:        ToolScript,
		Title:       "Control native computer apps",
		Description: "Run JavaScript in this conversation's persistent native-computer session. Call with empty code for API documentation. Supports installed-app discovery and launch, native accessibility trees, screenshots, clicks, drags, typing, keys, and deterministic action sequences. Observe again after actions and use fresh window and element identifiers.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: &destructive, OpenWorldHint: &openWorld},
	}, tools.Script)
}

func RemoveMCPTools(server *mcp.Server) {
	server.RemoveTools(toolNames...)
}

type directTools struct {
	backend Backend
}

func (t directTools) Status(ctx context.Context, request *mcp.CallToolRequest, _ EmptyInput) (*mcp.CallToolResult, ToolOutput, error) {
	return t.call(ctx, request, ActionInput{Action: ActionStatus})
}

func (t directTools) Script(ctx context.Context, request *mcp.CallToolRequest, input ScriptInput) (*mcp.CallToolResult, ToolOutput, error) {
	return t.call(ctx, request, ActionInput{Action: ActionScript, Code: input.Code})
}

func (t directTools) call(ctx context.Context, request *mcp.CallToolRequest, input ActionInput) (*mcp.CallToolResult, ToolOutput, error) {
	input.Session = mcpsession.SessionID(request)
	output, err := t.backend.Call(ctx, input)
	if err != nil {
		return nil, ToolOutput{}, err
	}
	output.Text = limitText(output.Text, textLimit)
	content := make([]mcp.Content, 0, 2)
	if output.Text != "" {
		content = append(content, &mcp.TextContent{Text: output.Text})
	}
	if len(output.ImageData) > 0 {
		content = append(content, &mcp.ImageContent{Data: output.ImageData, MIMEType: output.ImageMIMEType})
	}
	var result *mcp.CallToolResult
	if len(content) > 0 {
		result = &mcp.CallToolResult{Content: content}
	}
	return result, ToolOutput{Status: output.Status, Text: output.Text}, nil
}
