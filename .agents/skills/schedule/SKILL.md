---
name: schedule
description: "Create, list, and delete scheduled (cron) tasks that send messages to the tinyclaw incoming queue at specified intervals. Use when the user wants to: schedule a recurring task for an agent, set up a cron job that triggers an agent, list existing scheduled tasks, delete or remove a scheduled task, or automate periodic agent work (reports, checks, reminders, syncs)."
---

# Schedule Skill

Manage cron-based scheduled tasks that deliver messages to the tinyclaw incoming queue. Each schedule fires at a cron interval and writes a routed message (`@agent_id <task>`) to `queue/incoming/`, where the queue processor picks it up and invokes the target agent.

## Commands

Use the bundled CLI `scripts/schedule.sh` for all operations.

### Create a schedule

```bash
scripts/schedule.sh create \
  --cron "EXPR" \
  --agent AGENT_ID \
  --message "Task context for the agent" \
  [--channel CHANNEL] \
  [--sender SENDER] \
  [--label LABEL]
```

- `--cron` — 5-field cron expression (required). Examples: `"0 9 * * *"` (daily 9am), `"*/30 * * * *"` (every 30 min), `"0 0 * * 1"` (weekly Monday midnight).
- `--agent` — Target agent ID (required). Must match an agent configured in settings.json.
- `--message` — The task context / prompt sent to the agent (required).
- `--channel` — Channel name in the queue message (default: `schedule`).
- `--sender` — Sender name in the queue message (default: `Scheduler`).
- `--label` — Unique label to identify this schedule (default: auto-generated). Use a descriptive label for easy management.

### List schedules

```bash
scripts/schedule.sh list [--agent AGENT_ID]
```

Lists all tinyclaw schedules. Optionally filter by `--agent` to show only schedules targeting a specific agent.

### Delete a schedule

```bash
scripts/schedule.sh delete --label LABEL
scripts/schedule.sh delete --all
```

Delete a specific schedule by label, or delete all tinyclaw schedules.

## Workflow

1. Confirm the target agent ID exists (check `settings.json` or ask the user).
2. Determine the cron expression from the user's description (e.g., "every morning" → `"0 9 * * *"`).
3. Compose a clear task message — this is the prompt the agent will receive.
4. Run `scripts/schedule.sh create` with the parameters.
5. Verify with `scripts/schedule.sh list`.

## Cron expression quick reference

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-7, 0 and 7 = Sunday)
│ │ │ │ │
* * * * *
```

| Pattern           | Meaning                    |
|-------------------|----------------------------|
| `0 9 * * *`       | Daily at 9:00 AM           |
| `0 9 * * 1-5`     | Weekdays at 9:00 AM        |
| `*/15 * * * *`    | Every 15 minutes           |
| `0 */2 * * *`     | Every 2 hours              |
| `0 0 * * 0`       | Weekly on Sunday midnight  |
| `0 0 1 * *`       | Monthly on the 1st         |
| `30 8 * * 1`      | Monday at 8:30 AM          |

## Examples

### Daily report

```bash
scripts/schedule.sh create \
  --cron "0 9 * * *" \
  --agent analyst \
  --message "Generate the daily metrics report and post a summary" \
  --label daily-report
```

### Periodic health check

```bash
scripts/schedule.sh create \
  --cron "*/30 * * * *" \
  --agent devops \
  --message "Run health checks on all services and report any issues" \
  --label health-check
```

### Weekly code review reminder

```bash
scripts/schedule.sh create \
  --cron "0 10 * * 1" \
  --agent coder \
  --message "Review open PRs and summarize status" \
  --label weekly-pr-review
```

### List and clean up

```bash
# See all schedules
scripts/schedule.sh list

# See only schedules for @coder
scripts/schedule.sh list --agent coder

# Remove one
scripts/schedule.sh delete --label health-check

# Remove all
scripts/schedule.sh delete --all
```

## How it works

- Schedules are stored as system cron entries tagged with `# tinyclaw-schedule:<label>`.
- When a cron job fires, it writes a JSON message to `queue/incoming/` with the `@agent_id` routing prefix.
- The queue processor picks up the message and invokes the target agent, exactly like a message from any channel.
- Responses appear in `queue/outgoing/` and can be consumed by channel clients.

For queue message format details, see `references/queue-format.md`.
