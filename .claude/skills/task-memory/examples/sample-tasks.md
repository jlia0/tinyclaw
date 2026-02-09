# Task Extraction Examples

## Explicit — Create immediately

User: "Remind me to call mom tomorrow at 6pm"
→ title: "Call mom"
→ due: tomorrow 18:00
→ priority: normal
→ recurrence: null
→ Response: "Tracked: Call mom (due: tomorrow 6:00 PM)"

User: "Todo: buy groceries"
→ title: "Buy groceries"
→ due: null
→ priority: low
→ Response: "Tracked: Buy groceries (no due date)"

## Recurring — Create with recurrence field

User: "Every Friday remind me to review open PRs"
→ title: "Review open PRs"
→ due: next friday 17:00
→ priority: normal
→ recurrence: weekly/friday
→ Response: "Tracked: Review open PRs (recurring: every Friday)"

User: "Remind me daily to check emails at 9am"
→ title: "Check emails"
→ due: tomorrow 09:00
→ priority: normal
→ recurrence: daily
→ Response: "Tracked: Check emails (recurring: daily at 9:00 AM)"

## Implicit — Ask confirmation first

User: "I need to finish that report by Friday"
→ Ask: "Should I track 'Finish report' as a task due Friday?"
→ If yes: create with follow-up note "extracted from conversation"
→ If no: do nothing

User: "I told Sarah I'd send the designs next week"
→ Ask: "Should I track 'Send designs to Sarah' as a task due next week?"

## Dependencies

User: "After the report is done, send it to Sarah"
→ title: "Send report to Sarah"
→ blocked_by: [<report-task-id>]
→ Response: "Tracked: Send report to Sarah (blocked by: Finish report)"

## Heartbeat Responses

### Nothing due
→ "HEARTBEAT_OK"

### Task overdue
→ "Reminder: 'Call mom' was due 2 hours ago. Want to reschedule or mark done?"

### Task due today
→ "Heads up: 'Review open PRs' is due today at 5:00 PM"

### Task due within 1 hour
→ "Urgent: 'Team standup' is due in 30 minutes!"

### Old task with no due date
→ "You've had 'Buy groceries' open for 8 days with no due date. Still relevant?"
