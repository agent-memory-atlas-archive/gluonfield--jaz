package acp

import (
	"context"
	"fmt"
	"strings"

	"github.com/wins/jaz/backend/internal/sessionevents"
)

type AskUserInput struct {
	Questions []UserQuestion `json:"questions" jsonschema:"One or more questions in display order."`
}

type UserQuestion struct {
	ID          string                            `json:"id" jsonschema:"Unique identifier used to return this question's answer."`
	Question    string                            `json:"question" jsonschema:"Complete self-contained question."`
	Header      string                            `json:"header,omitempty" jsonschema:"Optional short label."`
	MultiSelect bool                              `json:"multi_select,omitempty" jsonschema:"Allow multiple answers, shown as checkboxes. Requires options. Otherwise options are single-choice radio buttons."`
	Options     []sessionevents.ACPQuestionOption `json:"options,omitempty" jsonschema:"Provide concrete answer options whenever useful, so the user can select rather than type. Free text is always available alongside choices."`
}

type AskUserOutput struct {
	Answers   map[string]InteractiveAnswerValue `json:"answers,omitempty"`
	Cancelled bool                              `json:"cancelled,omitempty"`
}

func (m *Manager) AskUser(ctx context.Context, sessionID string, input AskUserInput) (AskUserOutput, error) {
	if sessionID == "" {
		return AskUserOutput{}, fmt.Errorf("ask_user requires a current Jaz thread")
	}
	job := m.jobByID(sessionID)
	if job == nil {
		return AskUserOutput{}, fmt.Errorf("current Jaz thread is not active")
	}
	if len(input.Questions) == 0 {
		return AskUserOutput{}, fmt.Errorf("at least one question is required")
	}
	questions := make([]sessionevents.ACPQuestion, 0, len(input.Questions))
	multiSelectByID := make(map[string]bool, len(input.Questions))
	for _, question := range input.Questions {
		id := strings.TrimSpace(question.ID)
		text := strings.TrimSpace(question.Question)
		_, duplicate := multiSelectByID[id]
		if id == "" || text == "" || duplicate {
			return AskUserOutput{}, fmt.Errorf("questions require unique nonempty ids and nonempty text")
		}
		multiSelectByID[id] = question.MultiSelect
		if question.MultiSelect && len(question.Options) == 0 {
			return AskUserOutput{}, fmt.Errorf("question %s requires options for multiple selection", id)
		}
		options := make([]sessionevents.ACPQuestionOption, 0, len(question.Options))
		labels := make(map[string]bool, len(question.Options))
		for _, option := range question.Options {
			option.Label = strings.TrimSpace(option.Label)
			option.Description = strings.TrimSpace(option.Description)
			if option.Label == "" || labels[option.Label] {
				return AskUserOutput{}, fmt.Errorf("question %s requires unique nonempty option labels", id)
			}
			labels[option.Label] = true
			options = append(options, option)
		}
		questions = append(questions, sessionevents.ACPQuestion{
			ID: id, Header: strings.TrimSpace(question.Header), Question: text, IsOther: true, Options: options, MultiSelect: question.MultiSelect,
		})
	}
	prepare := func(answers map[string]InteractiveAnswerValue) (map[string]InteractiveAnswerValue, error) {
		if len(answers) != len(multiSelectByID) {
			return nil, fmt.Errorf("answer every question before submitting")
		}
		normalized := make(map[string]InteractiveAnswerValue, len(multiSelectByID))
		for id, answer := range answers {
			values := trimmedAnswers(answer.Answers)
			multiSelect, known := multiSelectByID[id]
			if !known || len(values) == 0 {
				return nil, fmt.Errorf("each question requires a nonempty answer")
			}
			if !multiSelect && len(values) != 1 {
				return nil, fmt.Errorf("question %s requires one answer", id)
			}
			normalized[id] = InteractiveAnswerValue{Answers: values}
		}
		return normalized, nil
	}
	answer := m.awaitPermissionAnswer(ctx, job, sessionevents.ACPPermission{
		ID: newPermissionID(), Title: "Questions", Questions: questions, Status: "pending",
	}, prepare)
	return AskUserOutput{Answers: answer.Answers, Cancelled: answer.Answers == nil}, nil
}
