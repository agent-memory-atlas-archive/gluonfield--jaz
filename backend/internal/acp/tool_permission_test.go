package acp

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	acpschema "github.com/gluonfield/acp-transport/acp"
	"github.com/gluonfield/acp-transport/jsonrpc"
	"github.com/wins/jaz/backend/internal/sessionevents"
	"github.com/wins/jaz/backend/internal/storage"
	jsonstore "github.com/wins/jaz/backend/internal/storage/json"
)

func TestToolPermissionContinuesWithoutUserConfirmation(t *testing.T) {
	for _, tc := range []struct {
		name      string
		kind      acpschema.ToolKind
		options   []acpschema.PermissionOption
		cancelled bool
		want      string
	}{
		{
			name: "shell command", kind: acpschema.ToolKindExecute,
			options: []acpschema.PermissionOption{
				{OptionID: "allow-once", Name: "Yes", Kind: acpschema.PermissionOptionKindAllowOnce},
				{OptionID: "reject", Name: "No", Kind: acpschema.PermissionOptionKindRejectOnce},
			},
			want: "allow-once",
		},
		{
			name: "prefer once", kind: acpschema.ToolKindEdit,
			options: []acpschema.PermissionOption{
				{OptionID: "reject", Kind: acpschema.PermissionOptionKindRejectOnce},
				{OptionID: "always", Kind: acpschema.PermissionOptionKindAllowAlways},
				{OptionID: "once", Kind: acpschema.PermissionOptionKindAllowOnce},
			},
			want: "once",
		},
		{
			name: "allow always only", kind: acpschema.ToolKindRead,
			options: []acpschema.PermissionOption{
				{OptionID: "always", Kind: acpschema.PermissionOptionKindAllowAlways},
			},
			want: "always",
		},
		{
			name: "no approval option",
			options: []acpschema.PermissionOption{
				{OptionID: "reject", Kind: acpschema.PermissionOptionKindRejectOnce},
			},
		},
		{
			name: "cancelled turn", cancelled: true,
			options: []acpschema.PermissionOption{
				{OptionID: "once", Kind: acpschema.PermissionOptionKindAllowOnce},
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store, err := jsonstore.New(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			session, err := store.CreateSession(storage.CreateSession{Slug: "tool-permission", Runtime: storage.RuntimeACP})
			if err != nil {
				t.Fatal(err)
			}
			manager := NewManager(store, Config{}, nil)
			manager.Events = sessionevents.New()
			job := &jobState{
				Job: Job{ID: session.ID, ACPSession: "acp-session"},
				toolByID: map[string]sessionevents.ACPToolCall{
					"tool": {ID: "tool", Kind: string(tc.kind)},
				},
			}
			manager.jobsByID[session.ID] = job
			manager.jobsByACP["acp-session"] = job
			ctx, cancel := context.WithTimeout(t.Context(), time.Second)
			defer cancel()
			if tc.cancelled {
				cancel()
			}
			raw, rpcErr := manager.handleJSONRPC(ctx, jsonrpc.Request{
				Method: acpschema.ClientMethodSessionRequestPermission,
				Params: mustJSON(t, acpschema.RequestPermissionRequest{
					SessionID: "acp-session",
					Options:   tc.options,
					ToolCall:  acpschema.ToolCallUpdate{ToolCallID: "tool", Title: "Run tool"},
				}),
			})
			if rpcErr != nil {
				t.Fatal(rpcErr)
			}
			var response map[string]map[string]string
			if err := json.Unmarshal(raw, &response); err != nil {
				t.Fatal(err)
			}
			outcome := "selected"
			if tc.want == "" {
				outcome = "cancelled"
			}
			if response["outcome"]["outcome"] != outcome || response["outcome"]["optionId"] != tc.want {
				t.Fatalf("permission response = %s", raw)
			}
			events, err := store.LoadSessionEvents(session.ID)
			if err != nil {
				t.Fatal(err)
			}
			if len(events) != 0 || len(job.Permissions) != 0 || len(manager.pendingPermission) != 0 {
				t.Fatalf("tool permission became a user confirmation: events=%+v permissions=%+v", events, job.Permissions)
			}
		})
	}
}
