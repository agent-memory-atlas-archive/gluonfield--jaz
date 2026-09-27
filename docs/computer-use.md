# Native computer use

Computer Use adds two Jaztools, disabled by default:

- `computer_status` reports the desktop connection, platform, pinned driver version, OS permissions and the conversation holding the machine lease.
- `computer_js` runs persistent JavaScript with native app discovery, window observations, accessibility, screenshots and input.

Enable it in **Settings → Computer Use** on the desktop. Accessibility and Screen Recording grants are requested only by the permission button. Status queries and scripts never request them. macOS may require restarting the application after a grant. Web clients show that the desktop app is required.

## Agent API

An empty `computer_js` call returns documentation, including when permissions are missing.

```js
await computer.tools()
await computer.tools('list_apps')
const apps = await computer.call('list_apps', {})
nodeRepl.write(apps)
```

`computer.tools(name)` returns the driver's description and JSON input schema. `computer.call(name, args)` returns its structured data, emits its text, and forwards the last screenshot as MCP image content. Supported tools are selected from the driver's capability metadata; Jaz has no duplicate tool-schema catalog.

The surface includes native app/window, accessibility, input, screen, clipboard, menu, state-verification and cursor capabilities. Driver configuration, session administration, recording/installers and browser automation stay outside this API. Jaz's side browser retains its own controls and settings.

Observe at the start of each script and after actions. Use exact window IDs and fresh `snapshot_id`, `element_token` or `capture_id` values. Background delivery is the default; a foreground retry is an explicit agent decision. Unsupported native routes and stale identifiers remain driver errors. Numeric values outside JavaScript's safe range are refused instead of rounding native identities.

JavaScript declarations survive between calls. Each script owns a fresh native driver session, so native snapshot tokens expire after that script. Cancellation, disconnecting or leaving the conversation resets the interpreter. Await each action; parallel native actions inside a script are rejected.

## Ownership and transport

The authenticated session WebSocket runs independently of side-browser visibility:

```text
MCP → Go computercontrol → session WebSocket → renderer QuickJS → restricted IPC → Electron Cua runtime
```

Electron main owns the machine lease, including while the driver starts or shuts down. Other sessions receive a busy error; status remains available. Script IDs are unique and checked with the owning renderer. Cancellation travels over the existing socket as a separate message, aborts the native call and keeps the lease until native cleanup completes. Renderer destruction, navigation, socket closure, timeout and app shutdown cancel active work.

QuickJS exposes only the computer API and text output. It has no Node, Electron, host filesystem or shell bindings. Scripts have a 60-second budget, 64 MiB guest memory and a short CPU-interruption budget. Output is bounded to 12,000 UTF-8 bytes plus one image; native structured/text responses are bounded to 4 MiB and image base64 to 32 MiB.

Jaz pins `@trycua/cua-driver` to `0.30.1`, uses its same-process `CuaDriver.create(undefined)` standard permission mode, and awaits `shutdown()` before destroying the native handle. The optional platform package and Electron-compatible N-API runtime are unpacked from ASAR. No standalone daemon installation is needed. See [Cua SDK documentation](https://cua.ai/docs/reference/cua-driver/sdk-reference) and [upstream source](https://github.com/trycua/cua/tree/main/libs/cua-driver).

## Verification

Normal checks, from their respective backend/frontend directories:

```sh
go test ./...
go test -race ./internal/computercontrol ./internal/app ./internal/jaztools
bun test
bun run typecheck
bun run build:bundle
```

The opt-in live probe runs from `frontend`:

```sh
bun run test:computer:native
```

It lists apps/windows, then requires the test host's existing macOS grants. With grants, it creates a separate Calculator instance, captures its native AX tree and image, computes 6 × 7 in the background, verifies 42 in the screenshot using macOS Vision through Swift, and checks foreground/pointer preservation. It also tests a foreground drag in a separate canvas process: Cua protects its own authorization host from input and refuses background dragging on macOS. The drag temporarily brings the fixture forward and uses the pointer; the test checks foreground restoration afterward. Leave the mouse and keyboard untouched while this probe runs. It closes only its own fixture processes. Missing grants produce a failing result with the blocker, never a skipped pass or an automatic permission prompt.

`JAZ_COMPUTER_DRIVER_MODULE` may point to the packaged SDK's `dist/index.js` file URL to check the shipped native library. This does not change the test host's macOS permission identity. Development Electron and installed Jaz can have different grants.

## Local activation

The implementation branch is `jaz/native-computer-use`, in `/Users/wins/.jaz/workspaces/default/.worktrees/native-computer-use`. The running checkout is `/Users/wins/.jaz/workspaces/default/jaz`; work in the isolated checkout does not activate it.

After integrating the branch, install the pinned dependencies in the running checkout with `bun install --frozen-lockfile` from `frontend`. Restart the desktop with `bun run dev`; it also starts its local backend. If using an independently launched backend, restart that process too. Then enable Computer Use and grant permissions from its settings. Verify `computer_status` and a native observation before allowing input. The development watcher may reload Jaz when source files change, so integration belongs at the end of the conversation.

An unsigned macOS ARM64 package can be prepared from `frontend` with:

```sh
bun run build:backend
bun run build:bundle
CSC_IDENTITY_AUTO_DISCOVERY=false bunx electron-builder --dir --mac --arm64 --config.mac.identity=null
```

The output is `frontend/dist/mac-arm64/Jaz.app`. Release signing and notarization use the existing release workflow.

## Verification record — 2026-09-27

- All Go packages pass; the computer-control, app-routing and Jaztools packages also pass the race detector.
- 278 frontend tests, typecheck, changed-file ESLint, desktop build and ARM64 package checks pass.
- The full Electron browser regression passes on rerun, including the shared REPL through MCP/Go/Electron. Initial timing failures also occurred in an unchanged checkout; the focused model-picker check passes.
- Full-repository ESLint reports the same 13 existing errors on this branch and the unchanged checkout.
- After grants, real Electron probes list native apps/windows, read Calculator AX, capture its screenshot and compute 42 through background keyboard input. A separate canvas process receives a foreground drag with one press, 20 movement events and one release. The full foreground/pointer preservation gate is inconclusive while the user uses the desktop; the live Jaztools path still requires the query-auth fix below to be activated. Windows execution remains unverified.
- The rendered Settings component was inspected and exercised with a controlled permission fixture: enabling tools does not request a grant, the permission button refreshes status, and the separate Screen Recording settings action works.
- Strict maintainability review completed: shared QuickJS extraction, Electron-owned admission/cleanup, transport/domain separation, bounded responses, exact numeric identities and rejected cancelled/malformed requests. No provider model, prompt, context-window or authentication implementation was changed.

The follow-up strict review reproduced and fixed a queued-write cancellation race: a script cancelled while waiting for the socket writer could still be dispatched. Cancellation is now checked after acquiring the writer, and a real WebSocket regression verifies that the cancelled script never arrives while subsequent status calls still work. The connection's stored terminal error now owns its closed state, removing a redundant boolean. Focused Go race checks pass. No further structural blockers were found; live Jaztools acceptance remains outstanding.

The first activated test found a missing authentication route: browser WebSockets carry credentials in the query string, but `/computer` was absent from that allowlist. The fix permits query authentication for that exact session route; the integration test now dials without an Authorization header, and middleware tests cover valid/invalid query keys, rejected POSTs and approved-device tokens. Server, app and computer-control race checks pass. Native permissions are now granted, and direct native Calculator AX/capture/input produced 42; the live Jaztools bridge requires the backend to reload this fix before its end-to-end acceptance can finish.

### Interface review

| Before | After |
| --- | --- |
| Settings had browser control only. | A separate Computer Use section enables the two native tools. |
| Native OS grants had no Jaz control surface. | Accessibility and Screen Recording rows show current state, with explicit permission/settings actions. |
| Web clients had no native-control availability explanation. | The section identifies the desktop requirement and disables its local control. |
