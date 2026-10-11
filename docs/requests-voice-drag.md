# Voice Overlay Drag Crash

- [x] Fix the desktop voice overlay crash reported while dragging (`setPosition`, argument 1 conversion failure, 11 October 2026).
- [x] Reproduce the native failure, cover the drag behavior in the normal test suite, review the fix, and run verification.

Rounding fractional drag coordinates near the screen origin can produce JavaScript's negative zero. Electron rejects that value as an integer argument. Adding zero to each rounded coordinate normalizes it without changing other positions.

Verified: the unchanged handler reproduces the exact exception in a hidden, non-activating Electron window; the fixed handler crosses both origins and remains resizable. The new regression test fails before the fix and passes afterward. All 318 frontend tests, the full backend suite (Go 1.26), typecheck and lint pass. Strict code review found no remaining issues; the change stays at the native window boundary.

Work is isolated in this worktree; the running desktop checkout is unchanged. Native probe scripts and logs are in the ignored `runs/voice-drag/` directory.
