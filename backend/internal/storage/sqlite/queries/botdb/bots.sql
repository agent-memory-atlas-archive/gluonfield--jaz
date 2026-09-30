-- name: UpsertBot :exec
INSERT INTO bots (thread_id, kind, shape, color, members)
VALUES (sqlc.arg(thread_id), sqlc.arg(kind), sqlc.arg(shape), sqlc.arg(color), sqlc.arg(members))
ON CONFLICT(thread_id) DO UPDATE SET
  kind = excluded.kind,
  shape = excluded.shape,
  color = excluded.color,
  members = excluded.members;

-- name: GetBot :one
SELECT thread_id, kind, shape, color, members
FROM bots
WHERE thread_id = sqlc.arg(thread_id)
LIMIT 1;

-- name: ListBots :many
SELECT thread_id, kind, shape, color, members
FROM bots;
