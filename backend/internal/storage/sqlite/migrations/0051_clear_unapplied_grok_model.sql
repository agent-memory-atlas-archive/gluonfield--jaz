-- +goose Up
-- `grok agent stdio` ignores --model, so a Grok model saved in agent settings
-- never took effect. Jaz now applies it; clear it once so installs keep the
-- model they actually ran, Grok's own default.
UPDATE settings
SET value_json = json_remove(value_json, '$.acp.grok.model')
WHERE namespace = 'agents'
  AND key = 'defaults'
  AND json_valid(value_json)
  AND json_extract(value_json, '$.acp.grok.model') IS NOT NULL;

-- +goose Down
SELECT 1;
