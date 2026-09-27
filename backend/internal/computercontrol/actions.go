package computercontrol

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"
)

const (
	textLimit    = 12000
	ActionStatus = "status"
	ActionScript = "script"

	computerImageBase64Limit = 32 << 20
	computerWireReadLimit    = 34 << 20
)

type ActionInput struct {
	Action  string `json:"action"`
	Code    string `json:"code,omitempty"`
	Session string `json:"-"`
}

type ActionOutput struct {
	Status        string          `json:"status"`
	Text          string          `json:"text,omitempty"`
	Data          json.RawMessage `json:"data,omitempty"`
	ImageData     []byte          `json:"image_base64,omitempty"`
	ImageMIMEType string          `json:"image_mime_type,omitempty"`
}

type wireOutput struct {
	Status        string          `json:"status"`
	Text          string          `json:"text,omitempty"`
	Data          json.RawMessage `json:"data,omitempty"`
	ImageBase64   string          `json:"image_base64,omitempty"`
	ImageMIMEType string          `json:"image_mime_type,omitempty"`
}

func normalizeInput(input ActionInput) (ActionInput, error) {
	switch input.Action {
	case ActionStatus:
		input.Code = ""
	case ActionScript:
		if len(input.Code) > 150000 {
			return ActionInput{}, errors.New("computer script exceeds 150000 bytes")
		}
	default:
		return ActionInput{}, errors.New("unsupported computer action")
	}
	return input, nil
}

func decodeOutput(output wireOutput) (ActionOutput, error) {
	result := ActionOutput{
		Status:        output.Status,
		Text:          output.Text,
		Data:          output.Data,
		ImageMIMEType: output.ImageMIMEType,
	}
	if output.ImageBase64 == "" {
		return result, nil
	}
	if len(output.ImageBase64) > computerImageBase64Limit {
		return ActionOutput{}, errors.New("computer screenshot is too large")
	}
	if output.ImageMIMEType != "image/png" && output.ImageMIMEType != "image/jpeg" && output.ImageMIMEType != "image/webp" {
		return ActionOutput{}, errors.New("computer returned an unsupported image type")
	}
	image, err := base64.StdEncoding.DecodeString(output.ImageBase64)
	if err != nil {
		return ActionOutput{}, errors.New("computer returned an invalid screenshot")
	}
	result.ImageData = image
	return result, nil
}

func limitText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) <= limit {
		return value
	}
	const marker = "\n[truncated: computer output exceeded 12000 bytes]"
	value = value[:limit-len(marker)]
	for !utf8.ValidString(value) {
		value = value[:len(value)-1]
	}
	return value + marker
}
