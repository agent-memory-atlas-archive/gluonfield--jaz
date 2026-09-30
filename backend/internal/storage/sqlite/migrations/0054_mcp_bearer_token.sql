-- +goose Up
-- A server's API key, sent as its bearer token in place of OAuth sign-in.
ALTER TABLE mcp_servers ADD COLUMN bearer_token TEXT;

-- +goose Down
ALTER TABLE mcp_servers DROP COLUMN bearer_token;
