package memorydreamprompt

import (
	"strings"
	"testing"
)

func TestRenderKeepsPolicyAndSlugBoundaries(t *testing.T) {
	got, err := Render(Data{
		Root:            "/tmp/memory",
		RunSlug:         "dreams/runs/2026-06-17",
		ReviewSlug:      "dreams/review/2026-06-17",
		ReceiptPath:     "/tmp/memory/.state/consolidation/run.json",
		Sources:         []string{"sources/chat/decision.md"},
		LongTermPolicy:  "profile-level memory only",
		ShortTermPolicy: "active working set only",
	})
	if err != nil {
		t.Fatal(err)
	}
	got = strings.ReplaceAll(got, "\r\n", "\n")
	for _, want := range []string{
		"Memory root:\n/tmp/memory",
		"Long-term policy:\nprofile-level memory only",
		"Short-term policy:\nactive working set only",
		"active working set at or below 5,000 characters",
		"Write a Markdown run report to `dreams/runs/2026-06-17.md`",
		"Leave uncertain candidates in `dreams/review/2026-06-17.md`",
		"/tmp/memory/.state/consolidation/run.json",
		"- sources/chat/decision.md",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("rendered memory dream prompt missing %q:\n%s", want, got)
		}
	}
}
