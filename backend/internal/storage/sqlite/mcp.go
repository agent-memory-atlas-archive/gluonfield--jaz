package sqlite

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	mcpconfig "github.com/wins/jaz/backend/internal/mcpconfig"
	oauthdb "github.com/wins/jaz/backend/internal/storage/sqlite/generated/integrationoauth"
	"github.com/wins/jaz/backend/internal/storage/sqlite/generated/mcpdb"
)

const emptyMCPEnvHeadersJSON = "[]"

func (s *Store) ListMCPServers() ([]mcpconfig.Server, error) {
	rows, err := mcpdb.New(s.db).ListMCPServers(context.Background())
	if err != nil {
		return nil, err
	}
	servers := make([]mcpconfig.Server, 0, len(rows))
	for _, row := range rows {
		server, err := decodeMCPServer(mcpdb.GetMCPServerRow(row))
		if err != nil {
			return nil, err
		}
		servers = append(servers, server)
	}
	return servers, nil
}

func (s *Store) LoadMCPServer(id string) (mcpconfig.Server, error) {
	row, err := mcpdb.New(s.db).GetMCPServer(context.Background(), id)
	if err != nil {
		return mcpconfig.Server{}, mcpServerError(err)
	}
	return decodeMCPServer(row)
}

func (s *Store) CreateMCPServer(input mcpconfig.ServerInput) (mcpconfig.Server, error) {
	input, err := mcpconfig.ValidateInput(input)
	if err != nil {
		return mcpconfig.Server{}, err
	}
	headers, oauth, err := encodeMCPConfig(input)
	if err != nil {
		return mcpconfig.Server{}, err
	}
	now := time.Now().UTC()
	server := mcpconfig.Server{
		ID:                newMCPServerID(),
		Name:              input.Name,
		Transport:         mcpconfig.TransportStreamableHTTP,
		URL:               input.URL,
		Enabled:           input.Enabled,
		BearerTokenEnvVar: input.BearerTokenEnvVar,
		Headers:           input.Headers,
		OAuth:             input.OAuth,
		ShowInUI:          input.ShowInUI,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	s.writeMu.Lock()
	err = mcpdb.New(s.db).CreateMCPServer(context.Background(), mcpdb.CreateMCPServerParams{
		ID:                server.ID,
		Name:              server.Name,
		Transport:         server.Transport,
		Url:               server.URL,
		Enabled:           boolInt(server.Enabled),
		BearerTokenEnvVar: nullDBString(server.BearerTokenEnvVar),
		HeadersJson:       headers,
		EnvHeadersJson:    emptyMCPEnvHeadersJSON,
		OauthJson:         oauth,
		ShowInUi:          boolInt(server.ShowInUI),
		CreatedAtMs:       timeToMs(server.CreatedAt),
		UpdatedAtMs:       timeToMs(server.UpdatedAt),
	})
	s.writeMu.Unlock()
	if err != nil {
		return mcpconfig.Server{}, err
	}
	return server, nil
}

func (s *Store) UpdateMCPServer(id string, input mcpconfig.ServerInput) (mcpconfig.Server, error) {
	input, err := mcpconfig.ValidateInput(input)
	if err != nil {
		return mcpconfig.Server{}, err
	}
	headers, oauth, err := encodeMCPConfig(input)
	if err != nil {
		return mcpconfig.Server{}, err
	}
	now := time.Now().UTC()
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	tx, err := s.db.BeginTx(context.Background(), nil)
	if err != nil {
		return mcpconfig.Server{}, err
	}
	defer tx.Rollback()
	mcpq := mcpdb.New(s.db).WithTx(tx)
	oauthq := oauthdb.New(s.db).WithTx(tx)
	current, err := mcpq.GetMCPServer(context.Background(), id)
	if err != nil {
		if err == sql.ErrNoRows {
			return mcpconfig.Server{}, fmt.Errorf("mcp server not found: %s", id)
		}
		return mcpconfig.Server{}, err
	}
	changed, err := mcpq.UpdateMCPServer(context.Background(), mcpdb.UpdateMCPServerParams{
		Name:              input.Name,
		Transport:         mcpconfig.TransportStreamableHTTP,
		Url:               input.URL,
		Enabled:           boolInt(input.Enabled),
		BearerTokenEnvVar: nullDBString(input.BearerTokenEnvVar),
		HeadersJson:       headers,
		EnvHeadersJson:    emptyMCPEnvHeadersJSON,
		OauthJson:         oauth,
		ShowInUi:          boolInt(input.ShowInUI),
		UpdatedAtMs:       timeToMs(now),
		ID:                id,
	})
	if err != nil {
		return mcpconfig.Server{}, err
	}
	if changed == 0 {
		return mcpconfig.Server{}, fmt.Errorf("mcp server not found: %s", id)
	}
	if current.Url != input.URL || current.OauthJson != oauth {
		if err := oauthq.DeleteToken(context.Background(), mcpconfig.OAuthConnectionID(id)); err != nil {
			return mcpconfig.Server{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return mcpconfig.Server{}, err
	}
	return mcpconfig.Server{
		ID:                id,
		Name:              input.Name,
		Transport:         mcpconfig.TransportStreamableHTTP,
		URL:               input.URL,
		Enabled:           input.Enabled,
		BearerTokenEnvVar: input.BearerTokenEnvVar,
		Headers:           input.Headers,
		OAuth:             input.OAuth,
		ShowInUI:          input.ShowInUI,
		CreatedAt:         msToTime(current.CreatedAtMs),
		UpdatedAt:         now,
	}, nil
}

func (s *Store) DeleteMCPServer(id string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	tx, err := s.db.BeginTx(context.Background(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	mcpq := mcpdb.New(s.db).WithTx(tx)
	oauthq := oauthdb.New(s.db).WithTx(tx)
	changed, err := mcpq.DeleteMCPServer(context.Background(), id)
	if err != nil {
		return err
	}
	if changed == 0 {
		return fmt.Errorf("mcp server not found: %s", id)
	}
	if err := oauthq.DeleteToken(context.Background(), mcpconfig.OAuthConnectionID(id)); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) SetMCPServerEnabled(id string, enabled bool) (mcpconfig.Server, error) {
	s.writeMu.Lock()
	changed, err := mcpdb.New(s.db).SetMCPServerEnabled(context.Background(), mcpdb.SetMCPServerEnabledParams{
		Enabled:     boolInt(enabled),
		UpdatedAtMs: timeToMs(time.Now().UTC()),
		ID:          id,
	})
	s.writeMu.Unlock()
	if err != nil {
		return mcpconfig.Server{}, err
	}
	if changed == 0 {
		return mcpconfig.Server{}, fmt.Errorf("mcp server not found: %s", id)
	}
	return s.LoadMCPServer(id)
}

// decodeMCPServer maps a stored row; List and Get select the same columns, so
// their row types convert to each other.
func decodeMCPServer(row mcpdb.GetMCPServerRow) (mcpconfig.Server, error) {
	server := mcpconfig.Server{
		ID:                row.ID,
		Name:              row.Name,
		Transport:         row.Transport,
		URL:               row.Url,
		Enabled:           row.Enabled != 0,
		BearerTokenEnvVar: row.BearerTokenEnvVar.String,
		ShowInUI:          row.ShowInUi != 0,
		CreatedAt:         msToTime(row.CreatedAtMs),
		UpdatedAt:         msToTime(row.UpdatedAtMs),
	}
	if err := json.Unmarshal([]byte(row.HeadersJson), &server.Headers); err != nil {
		return mcpconfig.Server{}, err
	}
	if err := json.Unmarshal([]byte(row.OauthJson), &server.OAuth); err != nil {
		return mcpconfig.Server{}, err
	}
	return server, nil
}

func mcpServerError(err error) error {
	if err == sql.ErrNoRows {
		return fmt.Errorf("mcp server not found")
	}
	return err
}

func encodeMCPConfig(input mcpconfig.ServerInput) (string, string, error) {
	headers, err := json.Marshal(input.Headers)
	if err != nil {
		return "", "", err
	}
	oauth, err := json.Marshal(input.OAuth)
	if err != nil {
		return "", "", err
	}
	return string(headers), string(oauth), nil
}

func newMCPServerID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("mcp_%d", time.Now().UTC().UnixNano())
	}
	return "mcp_" + hex.EncodeToString(b[:])
}
