package sessions

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/wins/jaz/backend/internal/storage"
)

type goalRuntimeStub struct {
	session string
	err     error
}

func (r *goalRuntimeStub) ClearGoal(_ context.Context, session string) error {
	r.session = session
	return r.err
}

func TestGoalClearHTTP(t *testing.T) {
	for _, test := range []struct {
		err    error
		status int
	}{
		{nil, http.StatusNoContent},
		{storage.ErrSessionNotFound, http.StatusNotFound},
		{errors.New("write failed"), http.StatusInternalServerError},
	} {
		runtime := &goalRuntimeStub{err: test.err}
		request := httptest.NewRequest(http.MethodDelete, "/v1/sessions/thread/goal", nil)
		request.SetPathValue("session", "thread")
		response := httptest.NewRecorder()
		NewGoalHandler(runtime).ServeHTTP(response, request)
		if response.Code != test.status || runtime.session != "thread" {
			t.Fatalf("clear goal = %d, session %q", response.Code, runtime.session)
		}
		if test.err == nil && response.Body.Len() != 0 {
			t.Fatalf("204 body = %q", response.Body.String())
		}
	}
}
