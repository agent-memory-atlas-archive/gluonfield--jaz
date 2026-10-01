-- +goose Up
-- A pinned bot's place among the pins, from 1; 0 when it is not pinned.
ALTER TABLE bots ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
UPDATE bots SET pinned = 1 WHERE thread_id IN (SELECT id FROM threads WHERE pinned != 0);
UPDATE threads SET pinned = 0 WHERE id IN (SELECT thread_id FROM bots);

-- +goose Down
UPDATE threads SET pinned = 1 WHERE id IN (SELECT thread_id FROM bots WHERE pinned != 0);
ALTER TABLE bots DROP COLUMN pinned;
