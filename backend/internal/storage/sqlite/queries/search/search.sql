-- name: SearchThreadMessages :many
WITH hits AS (
  SELECT d.thread_id, d.seq,
    snippet(message_search_fts, 0, char(31), char(30), '...', 18) AS snippet,
    bm25(message_search_fts) AS score,
    '' AS event_prefix
  FROM message_search_fts(CAST(sqlc.arg(match) AS TEXT))
  JOIN message_search_docs d ON d.id = message_search_fts.rowid
  UNION ALL
  SELECT d.thread_id, 0 AS seq,
    snippet(event_search_fts, 0, char(31), char(30), '...', 18) AS snippet,
    bm25(event_search_fts) AS score,
    substr(e.content, 1, 100) AS event_prefix
  FROM event_search_fts(CAST(sqlc.arg(match) AS TEXT))
  JOIN event_search_docs d ON d.id = event_search_fts.rowid
  JOIN session_events e ON e.thread_id = d.thread_id AND e.seq = d.seq
)
SELECT
  t.id,
  t.slug,
  coalesce(t.title, '') AS title,
  t.status,
  t.runtime,
  coalesce(t.acp_agent, '') AS agent,
  coalesce(t.parent_id, '') AS parent_id,
  t.archived,
  hits.seq,
  hits.snippet,
  hits.score,
  hits.event_prefix,
  t.updated_at_ms,
  t.last_attention_at_ms
FROM hits
JOIN threads t ON t.id = hits.thread_id
WHERE (CAST(sqlc.arg(include_archived) AS INTEGER) = 1 OR t.archived = 0)
  AND coalesce(t.source_type, '') = ''
ORDER BY hits.score
LIMIT sqlc.arg(limit);

-- name: SearchThreadMetadata :many
SELECT
  t.id,
  t.slug,
  coalesce(t.title, '') AS title,
  t.status,
  t.runtime,
  coalesce(t.acp_agent, '') AS agent,
  coalesce(t.parent_id, '') AS parent_id,
  t.archived,
  snippet(thread_search_fts, 0, char(31), char(30), '...', 12) AS title_snippet,
  snippet(thread_search_fts, 1, char(31), char(30), '...', 12) AS slug_snippet,
  bm25(thread_search_fts, 3.0, 2.0, 1.0) AS score,
  t.updated_at_ms,
  t.last_attention_at_ms
FROM thread_search_fts(CAST(sqlc.arg(match) AS TEXT))
JOIN thread_search_docs d ON d.id = thread_search_fts.rowid
JOIN threads t ON t.id = d.thread_id
WHERE (CAST(sqlc.arg(include_archived) AS INTEGER) = 1 OR t.archived = 0)
  -- Exclude loop-run / sourced threads, matching the default thread list.
  AND coalesce(t.source_type, '') = ''
ORDER BY bm25(thread_search_fts, 3.0, 2.0, 1.0)
LIMIT sqlc.arg(limit);
