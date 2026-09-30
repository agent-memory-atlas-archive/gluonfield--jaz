# Ask user experiment

- [x] Expose a dedicated Jaz tool for one or more questions in the current thread, including optional choices and free-text answers, outside plan mode.
- [x] Reuse the existing question card and answer/cancellation lifecycle.
- [x] Verify the MCP request/answer round trip, cancellation, input validation, and existing native question paths.
- [x] Review the implementation; commit after verification.

`ask_user` accepts ordered `questions`, each with `id`, `question`, optional `header`, and optional `options` containing labels and descriptions. It uses the caller's thread binding, displays the existing question card, waits for all answers, and returns `answers` keyed by question id. Free text is always available. Interruption returns `cancelled: true`. Replies use the existing transcript and permission lifecycle. There is no new plan-mode requirement or frontend implementation.

Verified: full backend suite, focused race checks for the new tool and native elicitation/steering, and affected static analysis. The HTTP MCP test supplies the real thread header and checks two questions, option descriptions, input order, a selected answer, a custom answer, transcript persistence, rejected incomplete answers, and cleanup. Review found no need for a separate form, permission queue, or answer endpoint.

## Adoption test after activation

Use fresh ordinary-mode Codex and Claude threads with the same model/effort as the baseline. Give each the same migration prompt without naming the tool, for example:

> Help me plan moving our Databricks workloads to Snowflake. We have SQL pipelines, Spark notebooks, and ML jobs. Identify what you need from me before choosing the migration sequence and cutover approach.

Record whether a structured question card appears voluntarily, whether the questions affect the plan, and whether the agent uses the submitted answers. Compare with fresh threads on the current build. A forced tool call verifies availability; voluntary use measures adoption. Keep tool-response timeout behavior under observation during the live trial.

Status: implemented and tested on `jaz/ask-user-tool`; merge, backend activation, actual UI smoke check, and voluntary Codex/Claude adoption remain pending. No live agent test or native-parity release certification is claimed.
