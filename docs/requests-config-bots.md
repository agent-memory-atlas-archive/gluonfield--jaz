# Configured Bots

- [x] Load named bot definitions from `jaz.bots` in the config file.
- [x] Persist each bot's prompt and apply its agent and model.
- [x] Create named schedules as routines in the bot's existing thread.
- [x] Reapply config on startup without duplicating bots or routines or resetting run history.
- [x] Document the format, validate configuration, run the full backend suite, review and commit.

Verification: Go 1.26 full backend suite (101 passing packages), build, two isolated server starts with stable bot/routine IDs and next-run times, and controls proving the tests reject recreated routines and omitted prompts. Strict review passed; staticcheck matches HEAD exactly with 50 existing findings.

- [x] Complete the explicitly requested thermo-nuclear review, repair findings, verify and commit.

Follow-up review repaired four findings: validate all saved-name targets before writes, use one Unicode identity rule, start HTTP before declaration updates, and persist prompts before model resume. Regression controls reproduce all four defects on the original code. See [review](review-configured-bots.md).

- [x] Repeat the thermo-nuclear review of the completed branch, repair findings and verify.

The second pass found a startup shutdown race: HTTP shutdown could precede listener registration. Closing the listener directly fixes it; the existing lifecycle test fails once in 50 repetitions before the fix and passes all 100 afterwards. No further structural blockers were found in configured bots or the Canvas panel.
