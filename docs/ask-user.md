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
- [x] Support radio buttons for one answer and checkboxes for multiple answers, with an open field alongside choices.
- [x] Tell the agent to provide concrete options whenever useful.
- [x] Verify selection, custom answers, navigation and submission in the rendered UI and MCP round trip.

`ask_user` accepts ordered `questions`, each with `id`, `question`, optional `header`, and optional `options` containing labels and descriptions. Options use radio buttons by default; `multi_select: true` uses checkboxes and requires options. The agent should provide concrete options whenever useful. Free text remains available alongside choices, and multi-select answers can combine choices with custom text. It uses the caller's thread binding, waits for all answers, and returns `answers` keyed by question id. Interruption returns `cancelled: true`. Replies use the existing transcript and permission lifecycle, without entering plan mode.

Verified: full backend suite, focused race checks for the new tool and native elicitation/steering, and affected static analysis. The HTTP MCP test supplies the real thread header and checks three questions, option descriptions, input order, single and multiple selections, custom answers, transcript persistence, rejected incomplete answers, and cleanup. Review found no need for a separate permission queue or answer endpoint.

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

## Choice controls

The user's screenshot showed a free-text-only first question: the simulation supplied choices only for Snowflake readiness. The tool description, field guidance and Jaz prompt now encourage concrete options. The shared question card uses native radio and checkbox inputs with visible descriptions and explicit Next navigation. Selection remains on the question until the user advances. Native elicitation array fields also preserve multiple-selection intent in the display contract.

Verified in an isolated preview of the real permission card: selecting and deselecting checkboxes, retaining multiple choices plus a custom answer across navigation, radio exclusivity, custom text replacing a single choice, required-answer submission gating and the final submitted arrays. The preview intercepted the HTTP response; the backend test independently exercises the real MCP round trip and answer normalization. Screenshots: `/Users/wins/.jaz/artifacts/ask-user-choices-20260930/{checkboxes,radios}.png`.

Full backend tests, focused race checks, affected vet, frontend tests, typecheck and targeted lint pass. No dependency was added.

Status: the base tool and steering correction are on local main; choice controls are on `jaz/ask-user-tool`. The updated backend/frontend must be activated before an agent trial of multi-select questions. Voluntary Codex/Claude adoption remains unmeasured; no native-parity release certification is claimed.
