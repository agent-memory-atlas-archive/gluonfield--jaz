package acp

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wins/jaz/backend/internal/mcpsession"
	"github.com/wins/jaz/backend/internal/provider"
	"github.com/wins/jaz/backend/internal/sessionevents"
	"github.com/wins/jaz/backend/internal/storage"
	jsonstore "github.com/wins/jaz/backend/internal/storage/json"
)

func askUserFixture(t *testing.T) (*Manager, *jsonstore.Store, storage.Session, context.Context) {
	t.Helper()
	store, err := jsonstore.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	session, err := store.CreateSession(storage.CreateSession{Slug: "ask-user", Runtime: storage.RuntimeACP})
	if err != nil {
		t.Fatal(err)
	}
	manager := NewManager(store, Config{}, nil)
	manager.Events = sessionevents.New()
	manager.jobsByID[session.ID] = &jobState{Job: Job{ID: session.ID, ACPSession: "native-session", State: StateRunning}}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	return manager, store, session, ctx
}

type askUserTransport struct {
	sessionID string
}

func (t askUserTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	req.Header.Set(mcpsession.HeaderName, t.sessionID)
	return http.DefaultTransport.RoundTrip(req)
}

func TestAskUserMCPRoundTripInOrdinaryMode(t *testing.T) {
	manager, store, session, ctx := askUserFixture(t)
	events := manager.Events.Subscribe(ctx, session.ID)
	server := mcp.NewServer(&mcp.Implementation{Name: "jaztools", Version: "1"}, nil)
	NewMCPTools(manager).AddTo(server)
	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server {
		return server
	}, &mcp.StreamableHTTPOptions{JSONResponse: true})
	httpServer := httptest.NewServer(handler)
	defer httpServer.Close()
	client, err := mcp.NewClient(&mcp.Implementation{Name: "agent", Version: "1"}, nil).Connect(ctx, &mcp.StreamableClientTransport{
		Endpoint:   httpServer.URL,
		HTTPClient: &http.Client{Transport: askUserTransport{sessionID: session.ID}},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	tools, err := client.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, tool := range tools.Tools {
		if tool.Name == "ask_user" {
			found = true
		}
	}
	if !found {
		t.Fatal("ask_user is not advertised")
	}
	done := make(chan *mcp.CallToolResult, 1)
	errs := make(chan error, 1)
	go func() {
		call, err := client.CallTool(ctx, &mcp.CallToolParams{Name: "ask_user", Arguments: AskUserInput{Questions: []UserQuestion{
			{ID: "z_strategy", Header: "Strategy", Question: "Which migration approach?", Options: []sessionevents.ACPQuestionOption{
				{Label: "Phased", Description: "Validate each domain before cutover"},
				{Label: "Single cutover", Description: "Move the whole estate together"},
			}},
			{ID: "a_constraints", Question: "What downtime is acceptable?"},
		}}})
		if err != nil {
			errs <- err
			return
		}
		done <- call
	}()
	var permission sessionevents.ACPPermission
	select {
	case event := <-events:
		if event.Type != "permission_request" || event.Permission == nil {
			t.Fatalf("unexpected event: %#v", event)
		}
		permission = *event.Permission
	case err := <-errs:
		t.Fatal(err)
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if len(permission.Questions) != 2 || permission.Questions[0].ID != "z_strategy" ||
		permission.Questions[1].ID != "a_constraints" || !permission.Questions[0].IsOther ||
		permission.Questions[0].Options[0].Description != "Validate each domain before cutover" {
		t.Fatalf("questions lost ordering or choices: %#v", permission)
	}
	select {
	case <-done:
		t.Fatal("tool returned before the user answered")
	default:
	}
	for _, answers := range []map[string]InteractiveAnswerValue{
		{"z_strategy": {Answers: []string{"Phased"}}},
		{"z_strategy": {Answers: []string{"Phased"}}, "unknown": {Answers: []string{"No downtime"}}},
	} {
		if err := manager.AnswerInteractive(ctx, InteractiveAnswer{Session: session.ID, RequestID: permission.ID, Answers: answers}); err == nil {
			t.Fatal("accepted incomplete or unrelated answers")
		}
	}
	answers := map[string]InteractiveAnswerValue{
		"z_strategy":    {Answers: []string{"Phased"}},
		"a_constraints": {Answers: []string{"No downtime during business hours"}},
	}
	if err := manager.AnswerInteractive(ctx, InteractiveAnswer{Session: session.ID, RequestID: permission.ID, Answers: answers}); err != nil {
		t.Fatal(err)
	}
	select {
	case call := <-done:
		out := structuredContent[AskUserOutput](t, call)
		if out.Cancelled || out.Answers["z_strategy"].Answers[0] != "Phased" ||
			out.Answers["a_constraints"].Answers[0] != "No downtime during business hours" {
			t.Fatalf("tool answers = %#v", out)
		}
	case err := <-errs:
		t.Fatal(err)
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	messages, err := store.LoadMessages(session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 || !strings.Contains(provider.MessageContent(messages[0]), "No downtime during business hours") {
		t.Fatalf("answer was not persisted: %#v", messages)
	}
	if len(manager.jobByID(session.ID).Permissions) != 0 || len(manager.pendingPermission) != 0 {
		t.Fatal("answered questions remained pending")
	}
}

func TestAskUserCancellationClearsQuestion(t *testing.T) {
	for _, mode := range []string{"context", "steer"} {
		t.Run(mode, func(t *testing.T) {
			manager, _, session, ctx := askUserFixture(t)
			ctx, cancel := context.WithCancel(ctx)
			defer cancel()
			events := manager.Events.Subscribe(ctx, session.ID)
			done := make(chan AskUserOutput, 1)
			go func() {
				out, _ := manager.AskUser(ctx, session.ID, AskUserInput{Questions: []UserQuestion{{ID: "q", Question: "Which approach?"}}})
				done <- out
			}()
			select {
			case <-events:
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			if mode == "context" {
				cancel()
			} else {
				manager.cancelPendingPermissions(session.ID)
			}
			select {
			case out := <-done:
				if !out.Cancelled || out.Answers != nil {
					t.Fatalf("cancellation = %#v", out)
				}
			case <-time.After(time.Second):
				t.Fatal("cancellation did not release tool")
			}
			if len(manager.jobByID(session.ID).Permissions) != 0 || len(manager.pendingPermission) != 0 {
				t.Fatal("cancelled questions remained pending")
			}
		})
	}
}

func TestAskUserRejectsInvalidRequestsBeforePublishing(t *testing.T) {
	manager, _, session, ctx := askUserFixture(t)
	for _, test := range []struct {
		sessionID string
		questions []UserQuestion
	}{
		{sessionID: ""},
		{sessionID: "another-thread"},
		{sessionID: session.ID},
		{sessionID: session.ID, questions: []UserQuestion{{ID: " ", Question: "Which?"}}},
		{sessionID: session.ID, questions: []UserQuestion{{ID: "q", Question: " "}}},
		{sessionID: session.ID, questions: []UserQuestion{{ID: "q", Question: "Which?"}, {ID: " q ", Question: "Which?"}}},
		{sessionID: session.ID, questions: []UserQuestion{{ID: "q", Question: "Which?", Options: []sessionevents.ACPQuestionOption{{Label: " "}}}}},
		{sessionID: session.ID, questions: []UserQuestion{{ID: "q", Question: "Which?", Options: []sessionevents.ACPQuestionOption{{Label: "A"}, {Label: " A "}}}}},
	} {
		if _, err := manager.AskUser(ctx, test.sessionID, AskUserInput{Questions: test.questions}); err == nil {
			t.Fatalf("accepted invalid request: %#v", test)
		}
	}
	if len(manager.pendingPermission) != 0 || len(manager.jobByID(session.ID).Permissions) != 0 {
		t.Fatal("invalid requests opened questions")
	}
}

type heldAnswerStore struct {
	Store
	claimed chan struct{}
	release chan struct{}
}

func (s *heldAnswerStore) AppendMessages(id string, messages ...provider.Message) error {
	close(s.claimed)
	<-s.release
	return s.Store.AppendMessages(id, messages...)
}

func TestAskUserAcceptedAnswerWinsConcurrentCancellation(t *testing.T) {
	manager, _, session, ctx := askUserFixture(t)
	held := &heldAnswerStore{Store: manager.store, claimed: make(chan struct{}), release: make(chan struct{})}
	manager.store = held
	release := sync.OnceFunc(func() {
		close(held.release)
	})
	t.Cleanup(release)
	events := manager.Events.Subscribe(ctx, session.ID)
	callCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan AskUserOutput, 1)
	go func() {
		out, _ := manager.AskUser(callCtx, session.ID, AskUserInput{Questions: []UserQuestion{{ID: "q", Question: "Which approach?"}}})
		done <- out
	}()
	var requestID string
	select {
	case event := <-events:
		requestID = event.Permission.ID
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	submitted := make(chan error, 1)
	go func() {
		submitted <- manager.AnswerInteractive(ctx, InteractiveAnswer{
			Session: session.ID, RequestID: requestID,
			Answers: map[string]InteractiveAnswerValue{"q": {Answers: []string{"Phased"}}},
		})
	}()
	select {
	case <-held.claimed:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	cancel()
	select {
	case out := <-done:
		t.Fatalf("accepted answer lost to cancellation: %#v", out)
	case <-time.After(50 * time.Millisecond):
	}
	release()
	if err := <-submitted; err != nil {
		t.Fatal(err)
	}
	select {
	case out := <-done:
		if out.Cancelled || out.Answers["q"].Answers[0] != "Phased" {
			t.Fatalf("accepted answer = %#v", out)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	select {
	case event := <-events:
		if event.Type != "permission_response" || event.Permission.Status != "selected" {
			t.Fatalf("terminal event = %#v", event)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	select {
	case event := <-events:
		t.Fatalf("duplicate terminal event = %#v", event)
	default:
	}
}

type heldPermissionStore struct {
	Store
	started chan struct{}
	release chan struct{}
}

func (s *heldPermissionStore) TouchSessionAttention(id string) error {
	close(s.started)
	<-s.release
	return s.Store.TouchSessionAttention(id)
}

func TestAskUserPublishesRequestBeforeCancellation(t *testing.T) {
	manager, _, session, ctx := askUserFixture(t)
	held := &heldPermissionStore{Store: manager.store, started: make(chan struct{}), release: make(chan struct{})}
	manager.store = held
	release := sync.OnceFunc(func() {
		close(held.release)
	})
	t.Cleanup(release)
	events := manager.Events.Subscribe(ctx, session.ID)
	done := make(chan AskUserOutput, 1)
	go func() {
		out, _ := manager.AskUser(ctx, session.ID, AskUserInput{Questions: []UserQuestion{{ID: "q", Question: "Which approach?"}}})
		done <- out
	}()
	select {
	case <-held.started:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	cancelled := make(chan struct{})
	go func() {
		manager.cancelPendingPermissions(session.ID)
		close(cancelled)
	}()
	select {
	case event := <-events:
		t.Fatalf("resolution published before question: %#v", event)
	case <-time.After(50 * time.Millisecond):
	}
	release()
	for _, want := range []string{"permission_request", "permission_response"} {
		select {
		case event := <-events:
			if event.Type != want {
				t.Fatalf("event = %q, want %q", event.Type, want)
			}
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
	select {
	case out := <-done:
		if !out.Cancelled {
			t.Fatalf("cancellation = %#v", out)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	<-cancelled
	if len(manager.jobByID(session.ID).Permissions) != 0 {
		t.Fatal("cancelled question remained live")
	}
}
