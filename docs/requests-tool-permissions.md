# Tool Permissions

Request: Jaz must never show raw tool-execution confirmation cards like the shell-command Yes/No card in CAS Product Form Factor UI/UX (thread `20261014T093753-26f08537`, 14 October 2026).

- [x] Automatically answer provider tool-permission requests without publishing confirmation cards.
- [x] Preserve missing-input questions, explicit plan review and cancellation.
- [x] Verify the behavior, review the change and commit it.

The handler selects the provider's allow-once option, falling back to allow-always when it is the only approval offered. Cancelled turns and requests without an approval option return cancelled. Plan review uses the provider's `switch_mode` tool kind, including requests that inherit it from an earlier tool update; input questions keep their existing path.

Validation: full backend suite and 326 frontend tests pass. Removing automatic approval makes the regression test fail. Strict code review consolidated the old generic confirmation test into the existing plan-review test. No release or running backend was changed.
