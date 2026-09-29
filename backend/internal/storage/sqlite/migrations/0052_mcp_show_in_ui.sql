-- +goose Up
-- Servers that publish an MCP App can be pinned to the left rail as a section.
ALTER TABLE mcp_servers ADD COLUMN show_in_ui INTEGER NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE mcp_servers DROP COLUMN show_in_ui;
