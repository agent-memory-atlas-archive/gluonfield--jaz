-- +goose Up
ALTER TABLE bots ADD COLUMN prompt TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE bots DROP COLUMN prompt;
