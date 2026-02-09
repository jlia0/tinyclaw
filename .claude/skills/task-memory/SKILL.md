---
name: task-memory
description: >
  Manage persistent tasks, reminders, and follow-ups. Use when the user
  mentions deadlines, asks to remember something, sets reminders, says
  "todo/task/remind/don't forget/track", or during heartbeat processing.
  Also use when user asks "what's pending/open/due".
---

## Task Storage

Tasks live in `.tinyclaw/tasks/active/` as individual markdown files.
Completed tasks move to `.tinyclaw/tasks/completed/`.
Index at `.tinyclaw/tasks/index.json` for quick scanning.

File naming: `<timestamp>-<slug>.md` (e.g. `1738000000-call-mom.md`)
Use the template at [templates/task-template.md](templates/task-template.md) for new tasks.
See [examples/sample-tasks.md](examples/sample-tasks.md) for extraction examples.

## Creating Tasks

### Explicit (always create immediately)

Trigger words: "remind me", "add task", "todo", "track", "don't forget", "remember to"

1. Create task file in `.tinyclaw/tasks/active/`
2. Update `.tinyclaw/tasks/index.json`
3. Confirm to user: "Tracked: <title> (due: <date>)"

### Implicit (ask first)

When you detect action items, commitments, or deadlines in conversation:

1. Ask: "Should I track '<extracted item>' as a task?"
2. Only create if user confirms
3. Note in follow-ups: "extracted from conversation"

### Recurring

When user says "every day/week/friday/month":

1. Set `recurrence` field: `daily`, `weekly/<day>`, `monthly/<date>`
2. On completion of a recurring task, auto-create the next occurrence with updated due date
3. Completed instance moves to `completed/` as normal

### Dependencies

When user says "do X after Y is done" or "X depends on Y":

1. Set `blocked_by: [<task-id>]` in the new task
2. During heartbeat, skip reminders for blocked tasks
3. When blocking task completes, notify that dependent task is now unblocked

## Heartbeat Behavior

When processing a heartbeat message:

1. Read `.tinyclaw/tasks/index.json`
2. Get current time and compare against due dates
3. Decision tree:
   - **No tasks due or overdue** → respond ONLY with `HEARTBEAT_OK` (nothing else)
   - **Tasks due within 1 hour** → send urgent reminder via source channel
   - **Tasks overdue** → send reminder with how long overdue
   - **Tasks due today** → send a heads-up
   - **Tasks with no due date older than 7 days** → gentle nudge
4. Format reminders as short, actionable messages
5. If `.tinyclaw/heartbeat.md` itself seems stale or incomplete, update it

## Task Commands (natural language)

| User says | Action |
|---|---|
| "what's pending?" / "open tasks" / "what's due?" | List active tasks grouped by priority |
| "done with X" / "completed X" / "finished X" | Move to `completed/`, update index |
| "push X to tomorrow" / "reschedule X" | Update due date in task file and index |
| "cancel X" / "drop X" / "nevermind X" | Move to `completed/` with `status: cancelled` |
| "make X urgent" / "prioritize X" | Update priority field |
| "update heartbeat to include X" | Modify `.tinyclaw/heartbeat.md` directly |

## Index Maintenance

After ANY task create, update, complete, or delete:

1. Read all files in `.tinyclaw/tasks/active/`
2. Rebuild `.tinyclaw/tasks/index.json` with format:

```json
[{ "id": 0, "title": "", "status": "", "due": "", "priority": "", "source_channel": "", "recurrence": null }]
```

## Priority Levels

- **urgent**: due within 1 hour or explicitly marked
- **high**: due today
- **normal**: due this week (default)
- **low**: no due date or explicitly marked
