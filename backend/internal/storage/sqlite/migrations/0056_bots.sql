-- +goose Up
-- A bot is a thread with an avatar; a group is a thread whose members are bots.
CREATE TABLE IF NOT EXISTS bots (
  thread_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  shape TEXT NOT NULL,
  color TEXT NOT NULL,
  members TEXT NOT NULL DEFAULT '[]',
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

ALTER TABLE loops ADD COLUMN bot_id TEXT NOT NULL DEFAULT '';
ALTER TABLE loops ADD COLUMN event_trigger TEXT NOT NULL DEFAULT '';
ALTER TABLE loops ADD COLUMN webhook_hash TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE loops DROP COLUMN webhook_hash;
ALTER TABLE loops DROP COLUMN event_trigger;
ALTER TABLE loops DROP COLUMN bot_id;
DROP TABLE IF EXISTS bots;
