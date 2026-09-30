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
- [x] Complete the requested review of choice controls; repair native custom-answer routing and consolidate question state.
- [x] Merge the verified choice-control review fixes into local main.
- [x] Redesign the question card from the user's screenshot: plain option text beside visible controls, no per-option borders, title/subtitle rows or strong highlighting.
- [x] Simplify `ask_user` options to plain strings and remove the redundant `header` field, keeping concrete-options guidance, multiple questions and `multi_select`.
- [x] Keep native elicitation headers and option descriptions intact at the protocol boundary.
- [x] Verify the redesigned card in the integrated browser, review maintainability and commit in the isolated worktree.
- [x] Review corrections: 40px hit areas for options and actions, a neutral `1 / 4` counter in place of the dots, and plain option text with no native descriptions drawn.
- [x] Restore `header` in the TypeScript question contract.
- [x] Remove the question slide so the outgoing question can no longer take clicks.
- [x] Replace the numeric question counter with a small neutral progress bar, retaining the question position for screen readers.
- [x] Merge the redesigned question UI and visual progress into local main.
- [x] Keep Submit enabled for partial answers and allow questions to be skipped.
- [x] Render questions inline at their chronological position, preserving their position after submission.
- [x] Show submitted choices and custom text as visible, read-only history; persist structured answers for reopening the conversation.

`ask_user` accepts ordered `questions`, each with `id`, `question`, optional plain-text `options`, and optional `multi_select`. Options use radio buttons by default; `multi_select: true` uses checkboxes and requires options. The agent should provide concrete options whenever useful. Free text remains available alongside choices, and multi-select answers can combine choices with custom text. It uses the caller's thread binding, waits for submission, and returns only answered questions in `answers` keyed by question id. Interruption returns `cancelled: true`. Replies use the existing transcript and permission lifecycle, without entering plan mode.

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

## Choice-control review

Found and reproduced incorrect native response encoding for array questions with a separate custom-answer property: custom text went into the enum choices array, and the declared custom field was omitted. Split choices and custom answers before the shared scalar/array encoding. The regression checks choices-only, mixed and custom-only responses and fails on the reviewed revision.

Consolidated choices and custom text into one state entry per question, eliminating cross-map synchronization. Checkbox updates now read the previous state inside their updater. An isolated component-handler probe queues two changes without rerendering: the reviewed revision loses the first checkbox selection; the correction preserves both, custom text, radio exclusivity and the submission payload. Updaters also pass a repeated-invocation check. This probe uses a mocked hook runtime; it establishes handler behavior rather than browser timing.

Full backend tests, two focused race runs, affected vet, 281 frontend tests, typecheck and targeted lint pass. The side browser was disconnected during this review, so rendered UI verification was not repeated. Appearance is unchanged; no dependencies or files crossing 1,000 lines were added.

Status: the choice implementation (`b48ffe16`) and verified review fixes (`52dd0378`) are merged into local main. Backend/frontend activation and the live agent multi-select trial remain open. Voluntary Codex/Claude adoption remains unmeasured; no native-parity release certification is claimed.

## Question UI redesign

The user's screenshot showed a bordered card per option, bold titles with description subtitles, a card heading, an uppercase header, a `1 / 4` counter and a blue progress pill. The card now shows the question, then one line of plain text per option beside a native radio or checkbox, then a borderless filled field for another answer. Only the outer card keeps a border. Option rows and the answer field are 40px tall, with a neutral hover band; the same band marks keyboard focus only during Tab navigation. Checked controls use the ink colour, so Submit is the only accent. The footer holds a small neutral `1 / 4` counter on the left, with Back and Next or Submit on the right. The buttons keep their 32px pills, and a pseudo-element extends each hit area to 40px without overlapping its neighbour. The settled summary gets the same extension. Questions switch immediately: the slide animation, its direction state and the dot navigation are gone. Without an exiting copy of the previous question, a click can land only on the question on screen. Enter in the answer field keeps focus in the field as the next question appears. Settled questions keep the one-line summary, which also collapses the card again. A disabled fieldset owns the locked state.

`ask_user` options are plain strings; its `header` field and option descriptions are gone, and the tool description is shorter. Native elicitation is unchanged at the protocol boundary: provider headers and option descriptions still reach the event and remain in the shared TypeScript types. The card draws only option labels and the question text. Permission titles stay in the event for voice status text but are not drawn in the card.

Verified in the Jaz integrated browser against the real `PermissionCard`, in an isolated harness outside the repository, in dark and light themes. Measured element frames: option rows 40px (60px when wrapped), the answer field 40px, Back/Next/Submit 32px pills with 40.5px hit areas, and the summary 28px with a 40.5px hit area. Back and Next do not overlap. Full-row clicks toggle checkboxes, and radios are exclusive. Custom text combines with multiple choices and replaces a single choice. Submit stays disabled until every question is answered, the submitted arrays are correct, and a settled card ignores clicks and collapses. Native options show labels only.

The outgoing-question bug has a direct probe. Clicking Next and immediately probing the previous row's position hits the outgoing Q1 row on `664a18ae` and Q2's row on the new code. An immediate click after Next selected Q2's option and left Q1's checkbox unchanged. On `664a18ae`, the same click reached the outgoing question, and that control's end state was confounded because Motion exits stalled while the side browser was not painting.

Limit: the side browser delivered no native key events. Enter-to-advance was checked with a dispatched DOM event, and Tab focus with `focus({ focusVisible: true })` plus the keyboard-focus attribute; without the attribute the band disappears. Screenshots: `/Users/wins/.jaz/artifacts/ask-user-redesign-20260930-v2/`.

The review corrections changed only frontend files. After them, 281 frontend tests, typecheck and targeted lint pass. From the first redesign commit, backend `acp` and `jaztools` tests, focused `ask_user`/elicitation race runs and affected vet pass. The full backend run fails only in `internal/terminal` with a PTY `device not configured` error; that package depends on no changed package, and its behaviour on this machine is not otherwise verified.

Follow-up: the footer counter is now a 64px-wide, 4px-high neutral bar showing the current question's position. Screen readers retain “Question N of total” through progressbar semantics. Integrated-browser checks confirmed dark/light rendering, Back/Next updates and accessibility values for all four questions; the fill measured 16px on question one, 32px on question two and 64px on question four. Submission remains independently gated by answered questions. Typecheck, targeted lint and a maintainability review pass. Screenshot: `/Users/wins/.jaz/artifacts/ask-user-progress-20260930/dark-progress.png`.

Status: merged the redesign through `2f6cef33` into local main at the user's request. The merge has no conflicts, and the affected production files match the reviewed branch. ACP and Jaztools tests, frontend typecheck, targeted lint and all 282 frontend tests pass on the merged tree. No push or runtime restart was performed.

## Partial submission

Submit remains enabled when questions are unanswered, including when every answer is blank. It is disabled only while a submission is in progress. Missing or blank answers are omitted from the tool result; submitting nothing returns `answers: {}` and resolves the request successfully. Cancellation remains a separate result. Unknown question ids and multiple answers to single-choice questions are still rejected. The tool description explicitly tells agents that users may skip questions.

Verification: real HTTP MCP round trips cover complete, partial, empty-map and blank submissions, both on initial turns and native steering. They check normalized returned answers, transcript persistence and pending-request cleanup. Partial/empty/blank cases fail with the old production code. The real card in an isolated side-browser harness submits one answer with three blank questions, and also submits four blanks; Submit is enabled in both cases, the HTTP payload is correct and the card settles. Browser responses were intercepted with the endpoint’s actual 200 JSON response shape; backend acceptance is independently covered by the MCP tests. ACP, Jaztools and server package tests, focused permission/elicitation race checks, affected vet, typecheck, lint and all 282 frontend tests pass.

## Inline question history

Questions remain at the point where they were asked, both while pending and after submission. Their historical card stays visible alongside the conversation instead of folding into the work disclosure. Other permission approvals retain their existing placement.

After submission, the card shows each question and only its submitted values, with quiet checkmarks. Skipped questions show “Skipped”; cancelled requests show “Cancelled”. Secret values remain masked in the card. The form controls and collapsed “Asked N questions” button are replaced by this read-only summary. Older answered events without saved values show “Answered” rather than inventing selections or skipped answers.

Resolved permission events store an `answers` map from question id to string arrays, including empty arrays for skipped questions. This is transcript data: existing tool results, native answer encoding and stored user-answer messages are preserved. The component reads the saved values directly on a fresh mount. No MCP resource, iframe or additional transport is needed.

Verification: the HTTP MCP tests reload stored events for complete, partial and empty submissions and compare their typed answers. Timeline tests cover pending/resolved questions in both grouping modes, visible historical cards and existing approval placement. Rendered component tests check choices, custom text, skipped answers, secret masking, cancellation and old records. Old production code fails the new persistence, placement and history controls. The real `Transcript` and question component were checked in a temporary side-browser harness: checkbox choices plus custom text, exclusive radios with custom text replacing a choice, partial submission, correct HTTP payload, visible history after a fresh navigation, dark/light themes and a 380px container with no horizontal overflow. The browser endpoint response was intercepted; actual MCP acceptance and durable storage are independently checked in backend tests. Screenshot: `/Users/wins/.jaz/artifacts/ask-user-inline-20260930/light-history.png`.

Affected backend tests, focused permission/elicitation race checks, vet, frontend typecheck/lint and all 285 frontend tests pass. Implementation review retains the existing lifecycle and removes the settled-card expansion state; no dependencies or native protocol changes were added. Runtime activation requires a Jaz restart after merging.

Browser limit: the first harness omitted sequence numbers on its two commentary events, causing duplicate React keys. Its observed submission, question history and reload were correct; the fixture was then corrected to use distinct persisted-event sequence numbers. The side browser disconnected before that clean rerun. The final production edit after the screenshots only corrected indentation, and all checks were rerun on the final source.
