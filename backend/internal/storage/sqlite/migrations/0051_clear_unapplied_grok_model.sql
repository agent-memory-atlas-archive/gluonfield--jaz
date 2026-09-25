-- +goose Up
-- `grok agent stdio` ignores --model, so a saved Grok model never took effect.
-- Jaz now applies it; clear it once so installs keep the model they actually
-- ran, Grok's own default.
UPDATE settings
SET value_json = json_remove(value_json, '$.acp.grok.model')
WHERE namespace = 'agents'
  AND key = 'defaults'
  AND json_valid(value_json)
  AND json_extract(value_json, '$.acp.grok.model') IS NOT NULL;

UPDATE settings
SET value_json = json_remove(value_json, '$.model')
WHERE namespace = 'memory'
  AND key = 'settings'
  AND json_valid(value_json)
  AND json_extract(value_json, '$.agent') = 'grok';

UPDATE loops SET model = '' WHERE acp_agent = 'grok';

-- +goose Down
SELECT 1;
