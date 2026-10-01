-- +goose Up
-- A bot's background threads run on the bot's own agent and model.
ALTER TABLE bots DROP COLUMN worker_effort;
ALTER TABLE bots DROP COLUMN worker_model;
ALTER TABLE bots DROP COLUMN worker_agent;

-- +goose Down
ALTER TABLE bots ADD COLUMN worker_agent TEXT NOT NULL DEFAULT '';
ALTER TABLE bots ADD COLUMN worker_model TEXT NOT NULL DEFAULT '';
ALTER TABLE bots ADD COLUMN worker_effort TEXT NOT NULL DEFAULT '';
