# Heartbeat Check

1. Read `.tinyclaw/tasks/index.json`
2. Check for overdue, due-today, and due-within-1-hour tasks
3. If nothing needs attention: respond ONLY with "HEARTBEAT_OK"
4. If tasks need attention: send reminders to the source channel
5. If you notice this heartbeat file is stale or missing checks, update it

Optional checks:
- Pending tasks with no due date older than 7 days — nudge about them
- Blocked tasks where the blocker is now completed — notify unblocked
