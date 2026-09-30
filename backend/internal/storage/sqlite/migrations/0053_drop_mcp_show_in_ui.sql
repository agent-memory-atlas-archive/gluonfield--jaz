-- +goose Up
-- Servers declare sidebar apps with OpenAI's global entrypoints instead.
ALTER TABLE mcp_servers DROP COLUMN show_in_ui;

-- +goose Down
ALTER TABLE mcp_servers ADD COLUMN show_in_ui INTEGER NOT NULL DEFAULT 0;
