-- name: UpsertBot :exec
INSERT INTO bots (thread_id, kind, shape, color, members, worker_agent, worker_model, worker_effort)
VALUES (sqlc.arg(thread_id), sqlc.arg(kind), sqlc.arg(shape), sqlc.arg(color), sqlc.arg(members), sqlc.arg(worker_agent), sqlc.arg(worker_model), sqlc.arg(worker_effort))
ON CONFLICT(thread_id) DO UPDATE SET
  kind = excluded.kind,
  shape = excluded.shape,
  color = excluded.color,
  members = excluded.members,
  worker_agent = excluded.worker_agent,
  worker_model = excluded.worker_model,
  worker_effort = excluded.worker_effort;

-- name: GetBot :one
SELECT thread_id, kind, shape, color, members, worker_agent, worker_model, worker_effort
FROM bots
WHERE thread_id = sqlc.arg(thread_id)
LIMIT 1;

-- name: ListBots :many
SELECT thread_id, kind, shape, color, members, worker_agent, worker_model, worker_effort
FROM bots;
