# Ask user experiment

- [x] Expose a dedicated Jaz tool for one or more questions in the current thread, including optional choices and free-text answers, outside plan mode.
- [x] Reuse the existing question card and answer/cancellation lifecycle.
- [x] Verify the MCP request/answer round trip, cancellation, input validation, and existing native question paths.
- [x] Review the implementation; commit after verification.
- [x] Complete the requested thermo-nuclear review, repair reproduced defects, and verify the revised lifecycle.
- [x] Merge the reviewed changes into local main.
- [x] Read the six extracted skills and attempt a live question call for the Databricks-to-Snowflake scenario.
- [x] Reproduce and repair the immediate cancellation seen after native steering.
- [ ] Activate the steering correction and complete the live question/answer trial.

`ask_user` accepts ordered `questions`, each with `id`, `question`, optional `header`, and optional `options` containing labels and descriptions. It uses the caller's thread binding, displays the existing question card, waits for all answers, and returns `answers` keyed by question id. Free text is always available. Interruption returns `cancelled: true`. Replies use the existing transcript and permission lifecycle. There is no new plan-mode requirement or frontend implementation.

Verified: full backend suite, focused race checks for the new tool and native elicitation/steering, and affected static analysis. The HTTP MCP test supplies the real thread header and checks two questions, option descriptions, input order, a selected answer, a custom answer, transcript persistence, rejected incomplete answers, and cleanup. Review found no need for a separate form, permission queue, or answer endpoint.

## Thermo-nuclear review

Consolidated native approvals, native elicitation and `ask_user` onto one typed permission wait path. Answers stay typed internally, with ACP encoding at the protocol boundary and MCP binding in the MCP adapter. Removed duplicate waits, the internal JSON round trip, and redundant channel-send fallbacks. The review removes 33 production lines relative to the initial implementation.

Fixed two reproduced lifecycle defects: cancellation could overwrite an already accepted answer, and turn cancellation could publish a response before the question request. Completion belongs to the actor that removes the pending request; other waiters receive that actor's result. Each request has a publication barrier, keeping request/response ordering without holding the global permission mutex across storage writes. Both regression tests fail with their respective fixes removed.

Validation: `go test ./...`; three runs under the race detector covering `ask_user`, native elicitation, permission approvals, plan exit and steering; affected `go vet`. All pass. No new dependencies, frontend changes or files crossing 1,000 lines.

## Adoption test after activation

Use fresh ordinary-mode Codex and Claude threads with the same model/effort as the baseline. Give each the same migration prompt without naming the tool, for example:

> Help me plan moving our Databricks workloads to Snowflake. We have SQL pipelines, Spark notebooks, and ML jobs. Identify what you need from me before choosing the migration sequence and cutover approach.

Record whether a structured question card appears voluntarily, whether the questions affect the plan, and whether the agent uses the submitted answers. Compare with fresh threads on the current build. A forced tool call verifies availability; voluntary use measures adoption. Keep tool-response timeout behavior under observation during the live trial.

## First live trial

The tool was available in the current Codex session. After reading all six skills, the migration example asked about workload scope, goal/deadline, target readiness and cutover constraints. It immediately returned `cancelled: true`, with no confirmed question-card display. The native-steering HTTP MCP regression reproduces this: overlapping native steering calls were counted as a queued future prompt. The queue guard now applies only to adapters advertising prompt queueing. Initial-prompt and native-steering round trips pass, queued elicitation still cancels correctly, and the full backend suite, repeated race checks and affected vet pass.

Status: the initial reviewed implementation is on local main. The steering correction needs backend activation before another live question/answer trial. Voluntary Codex/Claude adoption remains unmeasured; no native-parity release certification is claimed.
