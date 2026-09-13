# MCP refresh in existing chats

Jaz attaches its stable `jaz_mcp` proxy when a session starts, including when
there are no user MCP servers. Existing tool policies still decide whether a
session receives that proxy.

Settings changes publish the updated catalog before agents refresh. Unchanged
upstream connections are reused when their configuration and OAuth credentials
match. Reauthorization and credential removal replace the old connection.
Replaced connections remain alive until their
active tool calls finish. A failed configuration read preserves the live catalog.
The proxy updates its registrations and emits standard tool-list notifications.

Before the next ordinary turn, ACP compares the proxy revision with the revision
accepted by that agent process. Supported agents refresh once for the latest
revision. A failed refresh leaves the revision pending and does not persist or
submit the new message. Active turns and steering continue through their existing
native paths.

| Adapter | Refresh mechanism |
| --- | --- |
| Claude | Native SDK `reconnectMcpServer("jaz_mcp")` |
| Kimi | Native session `reconnectMcpServer("jaz_mcp")` |
| OpenCode | Standard `notifications/tools/list_changed` |
| Grok | Native `_x.ai/session/update_mcp_servers`; a revision header changes only the Jaz proxy connection |
| Codex | Native `config/mcpServer/reload`, with the companion native reconnect fix described below |
| Antigravity | Does not advertise session MCP support; no refresh is attempted |

Claude, Kimi and enabled Codex adapters advertise
`agentCapabilities._meta.mcpRefresh.method = "_session/mcp/refresh"`.
The request is `{ "sessionId": "…", "serverNames": ["jaz_mcp"] }`.
Errors propagate normally. Grok uses its existing MCP SDK extension and native
acknowledgement. No agent process is restarted for catalog refresh.

## Codex runtime requirement

Native Codex 0.153.4 and 0.154.0 acknowledge reload but reuse the cached tool
catalog when server configuration is unchanged. The companion native patch
submits the existing `Op::RefreshMcpServers` after reloading MCP configuration.
It changes five production lines and keeps the provider thread alive.

The Codex ACP extension is disabled by default. Enable `CODEX_ACP_MCP_REFRESH=1`
only alongside a verified runtime containing this fix or equivalent upstream
behavior. Merely updating the ACP adapter is insufficient. Native Codex refreshes
all loaded threads and configured servers; its API cannot narrow the operation
to the requested server name.

## Integration status

Implementation is local and unreleased. Adapter changes live in sibling
worktrees `mcp-refresh-codex-20260913`, `mcp-refresh-claude-20260913`, and
`mcp-refresh-kimi-20260913`; the native fix is in
`mcp-refresh-native-codex-20260913`. Release pins remain unchanged until the
coordinated adapter/runtime artifacts exist and pass native parity verification.

Tests cover an initially empty catalog, additions, schema changes, removal,
unchanged connections, active calls, failed configuration reads, policy filtering,
OAuth replacement/removal, refresh coalescing, retries, message admission and
native acknowledgement.
Native checks verify Claude/Kimi catalog refresh, Grok tool execution and terminal
survival, and an actual Codex OAuth turn calling an added tool with the patch.
The native Codex regression also invokes the added tool through app-server.

Before release, compare the packaged adapters with native harnesses for model
metadata, initial prompt count/size, resume, compaction, tool capabilities and
OAuth authentication. These local checks do not establish full release parity.
Existing running processes need to load the upgraded adapter once; continuing
the same stored chat then uses its current MCP configuration.
