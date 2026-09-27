package computercontrol

import (
	"context"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wins/jaz/backend/internal/mcpsession"
)

type recordingBackend struct {
	input ActionInput
}

func (b *recordingBackend) Call(_ context.Context, input ActionInput) (ActionOutput, error) {
	b.input = input
	return ActionOutput{
		Status: "ok", Text: strings.Repeat("🌏", 4000),
		ImageData: []byte("screenshot"), ImageMIMEType: "image/png",
	}, nil
}

func TestMCPKeepsSessionImageAndBoundedUTF8(t *testing.T) {
	backend := &recordingBackend{}
	result, output, err := (directTools{backend: backend}).Script(context.Background(), &mcp.CallToolRequest{
		Extra: &mcp.RequestExtra{Header: mcpsession.Header("native-thread")},
	}, ScriptInput{Code: "await computer.tools()"})
	if err != nil {
		t.Fatal(err)
	}
	if backend.input.Session != "native-thread" || backend.input.Action != ActionScript || backend.input.Code != "await computer.tools()" {
		t.Fatalf("script routing=%+v", backend.input)
	}
	if len(output.Text) > textLimit || !utf8.ValidString(output.Text) || !strings.Contains(output.Text, "truncated") {
		t.Fatalf("unbounded or broken text: %d bytes", len(output.Text))
	}
	if len(result.Content) != 2 {
		t.Fatalf("content=%+v", result.Content)
	}
	image, ok := result.Content[1].(*mcp.ImageContent)
	if !ok || string(image.Data) != "screenshot" || image.MIMEType != "image/png" {
		t.Fatalf("image=%+v", image)
	}
}
