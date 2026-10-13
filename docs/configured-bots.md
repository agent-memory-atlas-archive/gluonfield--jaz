# Configured Bots

Add bots to `application.yaml`, or select a config file with
`APPLICATION_CONFIG=/path/to/application.yaml`:

```yaml
jaz:
  bots:
    - name: Research
      prompt: Keep me informed about robotics research. Send concise updates with sources.
      agent: codex
      model: gpt-6-astra
      schedules:
        - name: Morning Brief
          prompt: Summarize the most useful robotics news since the last brief.
          schedule:
            expr: "0 9 * * 1-5"
            timezone: Europe/London
```

The server applies these definitions before its scheduler starts. Bot names
identify existing bots; schedule names identify routines within that bot.
Names are matched case-insensitively and must be unique in their scope.
Restarting updates the declared settings while keeping thread and run history.
Changing the agent starts a fresh native session while retaining the saved transcript.
An unchanged schedule keeps its next run; a changed schedule computes a new one.
Removing a definition from the file leaves the saved bot or routine in place.

`prompt` supplies the bot's instructions in its own chat and group chats.
`model` is the agent's model identifier.
Each schedule runs as a turn in that bot's thread and uses its agent and model.
An omitted schedule prompt uses the bot's prompt. Schedules accept five-field
cron expressions, an optional IANA timezone (the server's timezone by default),
and `status: active` (default) or `status: paused`. Omit `schedules` for a bot
without scheduled work. Omit `agent` and `model` to use agent settings when
creating a bot and preserve its current choices on later starts.
