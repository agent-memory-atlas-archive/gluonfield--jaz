//go:build !windows

package acp_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/wins/jaz/backend/internal/acp"
	"github.com/wins/jaz/backend/internal/storage"
	jsonstore "github.com/wins/jaz/backend/internal/storage/json"
)

func TestRunWorkerClosesProcess(t *testing.T) {
	for _, cancelDuringPrompt := range []bool{false, true} {
		t.Run(strconv.FormatBool(cancelDuringPrompt), func(t *testing.T) {
			store, err := jsonstore.New(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			startLog := filepath.Join(t.TempDir(), "starts")
			manager := newFakeAgentManager(t, store, t.TempDir(), map[string]string{"JAZ_FAKE_ACP_START_LOG": startLog})
			t.Cleanup(manager.Close)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			message := "say hello"
			if cancelDuringPrompt {
				message = "block until cancelled"
				go func() {
					ticker := time.NewTicker(10 * time.Millisecond)
					defer ticker.Stop()
					for {
						select {
						case <-ctx.Done():
							return
						case <-ticker.C:
							for _, job := range manager.List() {
								if len(job.ToolCalls) > 0 {
									cancel()
									return
								}
							}
						}
					}
				}()
			}
			job, err := manager.RunWorker(ctx, acp.SpawnRequest{ACPAgent: "fake", Slug: "worker", SourceType: storage.SourceMemorySearch}, message)
			if cancelDuringPrompt {
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("error = %v", err)
				}
			} else if err != nil || job.Assistant != "hello from fake agent" {
				t.Fatalf("result = %#v, error = %v", job, err)
			}
			data, err := os.ReadFile(startLog)
			if err != nil {
				t.Fatal(err)
			}
			pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
			if err != nil {
				t.Fatal(err)
			}
			deadline := time.Now().Add(2 * time.Second)
			for syscall.Kill(pid, 0) == nil && time.Now().Before(deadline) {
				time.Sleep(10 * time.Millisecond)
			}
			if syscall.Kill(pid, 0) == nil || len(manager.List()) != 0 {
				t.Fatal("worker process or registered job survived completion")
			}
		})
	}
}
