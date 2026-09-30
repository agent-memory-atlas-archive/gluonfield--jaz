package acp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wins/jaz/backend/internal/mcpsession"
	"github.com/wins/jaz/backend/internal/sessionevents"
)

type MCPAskUserInput struct {
	Questions []UserQuestion `json:"questions" jsonschema:"One or more questions in display order."`
}

type UserQuestion struct {
	ID       string                            `json:"id" jsonschema:"Unique identifier used to return this question's answer."`
	Question string                            `json:"question" jsonschema:"Complete self-contained question."`
	Header   string                            `json:"header,omitempty" jsonschema:"Optional short label."`
	Options  []sessionevents.ACPQuestionOption `json:"options,omitempty" jsonschema:"Optional suggested answers. Free text is always available."`
}

type MCPAskUserOutput struct {
	Answers   map[string]InteractiveAnswerValue `json:"answers,omitempty"`
	Cancelled bool                              `json:"cancelled,omitempty"`
}

func (t *MCPTools) AskUser(ctx context.Context, req *mcp.CallToolRequest, input MCPAskUserInput) (*mcp.CallToolResult, MCPAskUserOutput, error) {
	out, err := t.Service.AskUser(ctx, mcpsession.SessionID(req), input)
	return nil, out, err
}

func (m *Manager) AskUser(ctx context.Context, sessionID string, input MCPAskUserInput) (MCPAskUserOutput, error) {
	if sessionID == "" {
		return MCPAskUserOutput{}, fmt.Errorf("ask_user requires a current Jaz thread")
	}
	job := m.jobByID(sessionID)
	if job == nil {
		return MCPAskUserOutput{}, fmt.Errorf("current Jaz thread is not active")
	}
	if len(input.Questions) == 0 {
		return MCPAskUserOutput{}, fmt.Errorf("at least one question is required")
	}
	questions := make([]sessionevents.ACPQuestion, 0, len(input.Questions))
	ids := make(map[string]bool, len(input.Questions))
	for _, question := range input.Questions {
		id := strings.TrimSpace(question.ID)
		text := strings.TrimSpace(question.Question)
		if id == "" || text == "" || ids[id] {
			return MCPAskUserOutput{}, fmt.Errorf("questions require unique nonempty ids and nonempty text")
		}
		ids[id] = true
		options := make([]sessionevents.ACPQuestionOption, 0, len(question.Options))
		labels := make(map[string]bool, len(question.Options))
		for _, option := range question.Options {
			option.Label = strings.TrimSpace(option.Label)
			option.Description = strings.TrimSpace(option.Description)
			if option.Label == "" || labels[option.Label] {
				return MCPAskUserOutput{}, fmt.Errorf("question %s requires unique nonempty option labels", id)
			}
			labels[option.Label] = true
			options = append(options, option)
		}
		questions = append(questions, sessionevents.ACPQuestion{
			ID: id, Header: strings.TrimSpace(question.Header), Question: text, IsOther: true, Options: options,
		})
	}
	encoder := func(answers map[string]InteractiveAnswerValue) (string, error) {
		out := MCPAskUserOutput{Answers: make(map[string]InteractiveAnswerValue, len(ids))}
		if len(answers) != len(ids) {
			return "", fmt.Errorf("answer every question before submitting")
		}
		for id, answer := range answers {
			values := trimmedAnswers(answer.Answers)
			if !ids[id] || len(values) != 1 {
				return "", fmt.Errorf("each question requires one nonempty answer")
			}
			out.Answers[id] = InteractiveAnswerValue{Answers: values}
		}
		raw, err := json.Marshal(out)
		return string(raw), err
	}
	raw := m.awaitQuestionAnswers(ctx, job, sessionevents.ACPPermission{
		ID: newPermissionID(), Title: "Questions", Questions: questions, Status: "pending",
	}, encoder)
	if raw == "" {
		return MCPAskUserOutput{Cancelled: true}, nil
	}
	var out MCPAskUserOutput
	err := json.Unmarshal([]byte(raw), &out)
	return out, err
}
