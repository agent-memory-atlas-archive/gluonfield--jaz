package integrationingest

import (
	"context"
	"sync"

	"github.com/charmbracelet/log"
	"github.com/wins/jaz/backend/internal/sourcequeue"
	"github.com/wins/jaz/backend/pkg/integrations"
)

type MaterializingWriter struct {
	Raw             RawWriter
	Projector       SourceProjector
	ProjectionQueue PendingSourceStore
	Observers       *Observers
	Log             *log.Logger
}

// Observers hear the incoming messages in every batch of records once it is
// stored.
type Observers struct {
	mu        sync.RWMutex
	listeners []func(context.Context, []Incoming)
}

func NewObservers() *Observers {
	return &Observers{}
}

func (o *Observers) Add(listener func(context.Context, []Incoming)) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.listeners = append(o.listeners, listener)
}

func (o *Observers) notify(ctx context.Context, records []integrations.Record) {
	messages := incoming(records)
	if len(messages) == 0 {
		return
	}
	o.mu.RLock()
	defer o.mu.RUnlock()
	for _, listener := range o.listeners {
		listener(ctx, messages)
	}
}

func (w MaterializingWriter) WriteRecords(ctx context.Context, records []integrations.Record) error {
	prepared := make([]integrations.Record, 0, len(records))
	for _, record := range records {
		prepared = append(prepared, w.Raw.prepare(record))
	}
	if err := w.Raw.WriteRecords(ctx, prepared); err != nil {
		return err
	}
	if w.Observers != nil {
		w.Observers.notify(ctx, prepared)
	}
	sources, err := w.Projector.PlanRecords(ctx, prepared)
	if err != nil {
		w.warn("source projection planning failed", err)
	}
	for _, source := range sources {
		if err := w.markProjectionPending(ctx, source); err != nil {
			w.warn("source projection queue update failed", err)
		}
	}
	return nil
}

func (w MaterializingWriter) markProjectionPending(ctx context.Context, source sourcequeue.Source) error {
	if w.ProjectionQueue == nil {
		return nil
	}
	return w.ProjectionQueue.MarkPendingSource(ctx, source)
}

func (w MaterializingWriter) warn(message string, err error) {
	if err != nil && w.Log != nil {
		w.Log.WithPrefix("integration-ingest").Warn(message, "error", err)
	}
}
