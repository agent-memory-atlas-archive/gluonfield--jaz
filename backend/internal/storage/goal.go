package storage

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/wins/jaz/backend/internal/goal"
	"github.com/wins/jaz/backend/internal/sessionevents"
)

type SessionGoalStore interface {
	UpdateSessionGoal(id string, previous, next *goal.State) (sessionevents.Event, error)
}

var ErrGoalChanged = errors.New("goal changed while updating")
var ErrGoalNotRequested = errors.New("goal mode is off")

func GoalMutationEvent(session Session, previous, next *goal.State) (sessionevents.Event, error) {
	event := sessionevents.Event{SessionID: session.ID, Type: sessionevents.TypeGoalClear, At: time.Now().UTC()}
	if next == nil {
		return event, nil
	}
	currentRaw, err := MarshalGoalState(session.Goal)
	if err != nil {
		return sessionevents.Event{}, err
	}
	previousRaw, err := MarshalGoalState(previous)
	if err != nil {
		return sessionevents.Event{}, err
	}
	if currentRaw != previousRaw {
		return sessionevents.Event{}, ErrGoalChanged
	}
	if (session.Goal == nil || next.ID != session.Goal.ID) && (session.Turn == nil || !session.Turn.GoalRequested) {
		return sessionevents.Event{}, ErrGoalNotRequested
	}
	event.Type = sessionevents.TypeGoalUpdate
	event.Goal = next
	return event, nil
}

type GoalProjection struct {
	Seen  bool
	State *goal.State
}

func MarshalGoalState(state *goal.State) (string, error) {
	if state == nil {
		return "{}", nil
	}
	state = goal.NormalizeState(state)
	if state == nil {
		return "", fmt.Errorf("invalid goal state")
	}
	data, err := json.Marshal(state)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func UnmarshalGoalState(raw string) (*goal.State, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "null" || raw == "{}" {
		return nil, nil
	}
	var state goal.State
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		return nil, fmt.Errorf("goal state: %w", err)
	}
	normalized := goal.NormalizeState(&state)
	if normalized == nil {
		return nil, fmt.Errorf("invalid goal state")
	}
	if normalized.Status == goal.StatusRequested {
		return nil, nil
	}
	return normalized, nil
}

func GoalProjectionFromEvents(events ...sessionevents.Event) (GoalProjection, error) {
	var latest GoalProjection
	for _, event := range events {
		projection, ok, err := GoalProjectionFromEvent(event)
		if err != nil {
			return GoalProjection{}, err
		}
		if ok {
			latest = projection
		}
	}
	return latest, nil
}

func GoalProjectionFromEvent(event sessionevents.Event) (GoalProjection, bool, error) {
	if event.Type == sessionevents.TypeGoalClear {
		return GoalProjection{Seen: true}, true, nil
	}
	if event.Type != sessionevents.TypeGoalUpdate {
		return GoalProjection{}, false, nil
	}
	event.NormalizePayload()
	if event.Goal == nil {
		return GoalProjection{}, true, fmt.Errorf("goal update missing goal")
	}
	state := goal.NormalizeState(event.Goal)
	if state == nil {
		return GoalProjection{}, true, fmt.Errorf("invalid goal state")
	}
	if !goal.CompleteSnapshot(state) {
		if state.Objective != "" && state.Status == goal.StatusRequested {
			return GoalProjection{Seen: true}, true, nil
		}
		return GoalProjection{}, true, fmt.Errorf("goal update is not a complete snapshot")
	}
	return GoalProjection{Seen: true, State: state}, true, nil
}
