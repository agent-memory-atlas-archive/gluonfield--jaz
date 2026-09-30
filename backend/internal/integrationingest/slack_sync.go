package integrationingest

import (
	"context"
	"errors"
	"sync"
	"time"

	slackconnector "github.com/wins/jaz/backend/internal/connectors/slack"
	"github.com/wins/jaz/backend/pkg/integrations"
	integrationoauth "github.com/wins/jaz/backend/pkg/integrations/oauth"
)

type SlackSyncStore interface {
	integrationoauth.Store
	ListConnections(context.Context, string) ([]integrations.Connection, error)
}

// SlackSyncer observes new Slack messages through search while Wanted says
// something listens for them, starting from when it first looks.
type SlackSyncer struct {
	Store      SlackSyncStore
	Writer     RecordWriter
	Wanted     func() bool
	APIBaseURL string

	mu   sync.Mutex
	last map[string]time.Time
}

func (s *SlackSyncer) Run(ctx context.Context, interval time.Duration, onError func(error)) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		if s.Wanted() {
			if err := s.SyncOnce(ctx); err != nil && ctx.Err() == nil {
				onError(err)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *SlackSyncer) SyncOnce(ctx context.Context) error {
	connections, err := s.Store.ListConnections(ctx, slackconnector.ProviderID)
	if err != nil {
		return err
	}
	var errs []error
	for _, connection := range connections {
		errs = append(errs, s.syncConnection(ctx, connection))
	}
	return errors.Join(errs...)
}

func (s *SlackSyncer) syncConnection(ctx context.Context, connection integrations.Connection) error {
	client, err := (integrationoauth.Refresher{Store: s.Store}).Client(ctx, connection.ID)
	if errors.Is(err, integrationoauth.ErrTokenNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	s.mu.Lock()
	if s.last == nil {
		s.last = make(map[string]time.Time)
	}
	since, seen := s.last[connection.ID]
	s.mu.Unlock()
	if !seen {
		since = now
	}
	messages, err := slackconnector.RecentMessages(ctx, client, s.APIBaseURL, since)
	if err != nil {
		return err
	}
	newest := since
	var records []integrations.Record
	for _, message := range messages {
		at := message.PostedAt()
		if !at.After(since) {
			continue
		}
		records = append(records, slackconnector.MessageRecord(connection, message))
		if at.After(newest) {
			newest = at
		}
	}
	s.mu.Lock()
	s.last[connection.ID] = newest
	s.mu.Unlock()
	if len(records) == 0 {
		return nil
	}
	return s.Writer.WriteRecords(ctx, records)
}
