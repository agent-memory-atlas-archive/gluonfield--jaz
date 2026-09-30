-- +goose Up
CREATE TABLE event_search_docs (
  id INTEGER PRIMARY KEY,
  thread_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  UNIQUE(thread_id, seq),
  FOREIGN KEY (thread_id, seq) REFERENCES session_events(thread_id, seq) ON DELETE CASCADE
);

CREATE VIEW event_search_content AS
SELECT d.id, d.thread_id, d.seq, e.content
FROM event_search_docs d
JOIN session_events e ON e.thread_id = d.thread_id AND e.seq = d.seq;

CREATE VIRTUAL TABLE event_search_fts USING fts5(
  content,
  content='event_search_content',
  content_rowid='id',
  tokenize='unicode61',
  prefix='2 3 4'
);

INSERT INTO event_search_docs(thread_id, seq)
SELECT thread_id, seq FROM session_events
WHERE type = 'acp_message' AND trim(content) <> ''
  AND json_valid(acp) AND json_extract(acp, '$.id') = thread_id;

INSERT INTO event_search_fts(rowid, content)
SELECT id, content FROM event_search_content;

-- +goose StatementBegin
CREATE TRIGGER event_search_fts_ai AFTER INSERT ON session_events
WHEN new.type = 'acp_message' AND trim(new.content) <> ''
  AND json_valid(new.acp) AND json_extract(new.acp, '$.id') = new.thread_id
BEGIN
  INSERT INTO event_search_docs(thread_id, seq) VALUES (new.thread_id, new.seq);
  INSERT INTO event_search_fts(rowid, content)
  SELECT id, content FROM event_search_content
  WHERE thread_id = new.thread_id AND seq = new.seq;
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER event_search_fts_bd BEFORE DELETE ON session_events
BEGIN
  INSERT INTO event_search_fts(event_search_fts, rowid, content)
  SELECT 'delete', id, content FROM event_search_content
  WHERE thread_id = old.thread_id AND seq = old.seq;
  DELETE FROM event_search_docs WHERE thread_id = old.thread_id AND seq = old.seq;
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER event_search_fts_bu BEFORE UPDATE ON session_events
BEGIN
  INSERT INTO event_search_fts(event_search_fts, rowid, content)
  SELECT 'delete', id, content FROM event_search_content
  WHERE thread_id = old.thread_id AND seq = old.seq;
  DELETE FROM event_search_docs WHERE thread_id = old.thread_id AND seq = old.seq;
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER event_search_fts_au AFTER UPDATE ON session_events
WHEN new.type = 'acp_message' AND trim(new.content) <> ''
  AND json_valid(new.acp) AND json_extract(new.acp, '$.id') = new.thread_id
BEGIN
  INSERT INTO event_search_docs(thread_id, seq) VALUES (new.thread_id, new.seq);
  INSERT INTO event_search_fts(rowid, content)
  SELECT id, content FROM event_search_content
  WHERE thread_id = new.thread_id AND seq = new.seq;
END;
-- +goose StatementEnd

-- +goose Down
DROP TRIGGER event_search_fts_au;
DROP TRIGGER event_search_fts_bu;
DROP TRIGGER event_search_fts_bd;
DROP TRIGGER event_search_fts_ai;
DROP TABLE event_search_fts;
DROP VIEW event_search_content;
DROP TABLE event_search_docs;
