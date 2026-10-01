package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/wins/jaz/backend/internal/storage"
	"github.com/wins/jaz/backend/internal/storage/sqlite/generated/botdb"
)

func (s *Store) SaveBot(record storage.BotRecord) error {
	members, err := json.Marshal(record.Members)
	if err != nil {
		return err
	}
	if record.Members == nil {
		members = []byte("[]")
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	return botdb.New(s.db).UpsertBot(context.Background(), botdb.UpsertBotParams{
		ThreadID:     record.ThreadID,
		Kind:         record.Kind,
		Shape:        record.Shape,
		Color:        record.Color,
		Members:      string(members),
		WorkerAgent:  record.Worker.Agent,
		WorkerModel:  record.Worker.Model,
		WorkerEffort: record.Worker.ReasoningEffort,
	})
}

func (s *Store) LoadBot(threadID string) (storage.BotRecord, error) {
	row, err := botdb.New(s.db).GetBot(context.Background(), threadID)
	if errors.Is(err, sql.ErrNoRows) {
		return storage.BotRecord{}, storage.ErrBotNotFound
	}
	if err != nil {
		return storage.BotRecord{}, err
	}
	return botFromDB(row), nil
}

func (s *Store) ListBots() ([]storage.BotRecord, error) {
	rows, err := botdb.New(s.db).ListBots(context.Background())
	if err != nil {
		return nil, err
	}
	records := make([]storage.BotRecord, 0, len(rows))
	for _, row := range rows {
		records = append(records, botFromDB(row))
	}
	return records, nil
}

// PinBots pins exactly ids, in that order, and unpins every other bot.
func (s *Store) PinBots(ids []string) error {
	ctx := context.Background()
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	q := botdb.New(tx)
	if err := q.UnpinBots(ctx); err != nil {
		return err
	}
	for i, id := range ids {
		if err := q.PinBot(ctx, botdb.PinBotParams{Pinned: int64(i + 1), ThreadID: id}); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func botFromDB(row botdb.Bot) storage.BotRecord {
	var members []string
	_ = json.Unmarshal([]byte(row.Members), &members)
	return storage.BotRecord{
		ThreadID: row.ThreadID, Kind: row.Kind, Shape: row.Shape, Color: row.Color, Pinned: int(row.Pinned), Members: members,
		Worker: storage.BotWorker{Agent: row.WorkerAgent, Model: row.WorkerModel, ReasoningEffort: row.WorkerEffort},
	}
}
