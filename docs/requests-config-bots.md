# Configured Bots

- [x] Load named bot definitions from `jaz.bots` in the config file.
- [x] Persist each bot's prompt and apply its agent and model.
- [x] Create named schedules as routines in the bot's existing thread.
- [x] Reapply config on startup without duplicating bots or routines or resetting run history.
- [x] Document the format, validate configuration, run the full backend suite, review and commit.

Verification: Go 1.26 full backend suite (101 passing packages), build, two isolated server starts with stable bot/routine IDs and next-run times, and controls proving the tests reject recreated routines and omitted prompts. Strict review passed; staticcheck matches HEAD exactly with 50 existing findings.
