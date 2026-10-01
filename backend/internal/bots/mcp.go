package bots

import (
	"context"
	"fmt"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wins/jaz/backend/internal/mcpsession"
)

type MCPTools struct {
	service *Service
}

func NewMCPTools(service *Service) *MCPTools {
	return &MCPTools{service: service}
}

func (t *MCPTools) AddTo(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_bots",
		Title:       "List Jaz bots",
		Description: "List the user's Jaz bots and group chats with their ids.",
	}, t.List)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "message_bot",
		Title:       "Message a Jaz bot",
		Description: "Send a message to a Jaz bot or post it to a group chat. Delivery is asynchronous: a bot's reply arrives later as a new turn in this thread, so do not wait for it.",
	}, t.Message)
}

// AddBotTo adds the tools only a bot's own thread gets.
func (t *MCPTools) AddBotTo(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "send_message",
		Title:       "Send a chat message",
		Description: "Send a chat message as yourself. It is the only thing anyone sees from you. In a group chat turn it posts to the group, when answering a bot it goes to that bot, and otherwise it reaches the user in your chat.",
	}, t.Send)
}

type MCPListInput struct{}

type MCPBot struct {
	ID      string   `json:"id"`
	Kind    string   `json:"kind"`
	Name    string   `json:"name"`
	Members []string `json:"members,omitempty"`
}

type MCPListOutput struct {
	Bots []MCPBot `json:"bots"`
}

func (t *MCPTools) List(context.Context, *mcp.CallToolRequest, MCPListInput) (*mcp.CallToolResult, MCPListOutput, error) {
	bots, err := t.service.List()
	if err != nil {
		return nil, MCPListOutput{}, err
	}
	out := MCPListOutput{Bots: make([]MCPBot, 0, len(bots))}
	for _, bot := range bots {
		out.Bots = append(out.Bots, MCPBot{ID: bot.ID, Kind: bot.Kind, Name: bot.Name, Members: bot.Members})
	}
	return nil, out, nil
}

type MCPMessageInput struct {
	Bot     string `json:"bot" jsonschema:"bot or group id, a bot:<id> mention target, or the exact name"`
	Message string `json:"message"`
}

type MCPMessageOutput struct {
	Delivered bool `json:"delivered"`
}

func (t *MCPTools) Message(_ context.Context, req *mcp.CallToolRequest, input MCPMessageInput) (*mcp.CallToolResult, MCPMessageOutput, error) {
	id, err := t.resolve(input.Bot)
	if err != nil {
		return nil, MCPMessageOutput{}, err
	}
	if err := t.service.Message(mcpsession.SessionID(req), id, input.Message); err != nil {
		return nil, MCPMessageOutput{}, err
	}
	return nil, MCPMessageOutput{Delivered: true}, nil
}

type MCPSendInput struct {
	Message string `json:"message"`
}

type MCPSendOutput struct {
	Sent bool `json:"sent"`
}

func (t *MCPTools) Send(_ context.Context, req *mcp.CallToolRequest, input MCPSendInput) (*mcp.CallToolResult, MCPSendOutput, error) {
	if err := t.service.Say(mcpsession.SessionID(req), input.Message); err != nil {
		return nil, MCPSendOutput{}, err
	}
	return nil, MCPSendOutput{Sent: true}, nil
}

func (t *MCPTools) resolve(ref string) (string, error) {
	ref = strings.TrimPrefix(strings.TrimSpace(ref), "bot:")
	bots, err := t.service.List()
	if err != nil {
		return "", err
	}
	for _, bot := range bots {
		if bot.ID == ref || strings.EqualFold(bot.Name, ref) {
			return bot.ID, nil
		}
	}
	return "", fmt.Errorf("no bot or group named %q", ref)
}
