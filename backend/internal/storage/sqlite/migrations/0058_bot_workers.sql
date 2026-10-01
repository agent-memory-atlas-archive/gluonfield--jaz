-- +goose Up
-- The agent, model and effort a bot's background workers run with; empty
-- means the bot's own.
ALTER TABLE bots ADD COLUMN worker_agent TEXT NOT NULL DEFAULT '';
ALTER TABLE bots ADD COLUMN worker_model TEXT NOT NULL DEFAULT '';
ALTER TABLE bots ADD COLUMN worker_effort TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE bots DROP COLUMN worker_effort;
ALTER TABLE bots DROP COLUMN worker_model;
ALTER TABLE bots DROP COLUMN worker_agent;
