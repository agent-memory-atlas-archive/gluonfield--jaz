# App-started threads

- [x] Let an MCP App start a new Jaz chat with a prompt, for Tasks' `<jaz.newthread prompt:"..." />` button.
- [x] Accept the request only from the app the user is working in.
- [x] Start it with the agent, model, effort and project currently selected for new threads, keeping the composer draft.
- [x] Verify in the hidden desktop suite with negative controls, review and commit.

Contract: every app frame advertises `experimental["jaz/threads"]` and answers the `jaz/threads/create` request (`{ prompt }` → `{}`). A request from a frame that does not hold focus fails with "Only the app in use can start a chat". Otherwise Jaz opens `/new` with the prompt in history state. Once the new-thread controls are `ready`, the page clears that state and starts the prompt as if sent, without touching the composer draft, and the thread replaces `/new` in history so Back returns to the app.

The new-thread page owns the start because its controls hold the current selection; an app frame mounted earlier would launch with stale settings. Any connected app the user is clicking in can start a chat; the prompt runs with the agent's normal permissions.

Verification: the app-navigation suite drives a sandboxed SDK peer against production MCPApps and the real new-thread page. A request from Tasks while CRM holds focus is refused and creates nothing; a focused one creates one session with the selected agent, model and effort, queues the exact prompt, opens the thread and keeps the composer draft, and Back returns to the app without a second start. Removing the focus check, the history replacement or the draft guard each fails the suite. Full frontend tests, typecheck, lint and the full hidden browser suite pass.
