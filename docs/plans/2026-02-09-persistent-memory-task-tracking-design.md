# Feature 1: Persistent Memory + Task Tracking

## Overview

Add persistent task management to TinyClaw using Claude Code's native skills system. Claude extracts tasks from conversation (explicit and implicit), stores them as individual markdown files with YAML frontmatter, and proactively follows up via the heartbeat system — mirroring OpenClaw's core task tracking behavior.

## Architecture

```
User message ("remind me to call mom")
       ↓
Claude (with task-memory skill loaded)
       ↓
Creates .tinyclaw/tasks/active/1738000000-call-mom.md
Updates .tinyclaw/tasks/index.json
       ↓
Heartbeat (every 5 min) reads index.json
       ↓
Due/overdue? → Send reminder via source channel
Nothing due? → Respond "HEARTBEAT_OK" (silent, no message sent)
```

## Task Storage

```
.tinyclaw/tasks/
├── active/                              # Current tasks
│   ├── 1738000000-call-mom.md
│   └── 1738000100-review-pr-42.md
├── completed/                           # Done/cancelled tasks
│   └── 1737999000-send-invoice.md
└── index.json                           # Lightweight index for quick lookups
```

### Task File Format

```yaml
---
id: 1738000000
title: Call mom
status: active
priority: normal
due: 2026-02-10T18:00:00
source_channel: whatsapp
source_sender: "You"
created: 2026-02-09T14:30:00
tags: [personal]
recurrence: null
blocked_by: []
---

## Context
You mentioned wanting to call mom during our conversation about weekend plans.

## Follow-ups
- 2026-02-09 14:30 — Task created from conversation
```

### Index Format

```json
[
  {
    "id": 1738000000,
    "title": "Call mom",
    "status": "active",
    "due": "2026-02-10T18:00:00",
    "priority": "normal",
    "source_channel": "whatsapp",
    "recurrence": null
  }
]
```

## Skill Definition

Location: `.claude/skills/task-memory/SKILL.md`

### Task Extraction

- **Explicit** (create immediately): Trigger words like "remind me", "add task", "todo", "track", "don't forget". Confirm to user after creation.
- **Implicit** (ask first): Claude detects action items, deadlines, commitments in conversation. Asks "Should I track X as a task?" before creating.
- **Recurring**: "every day/week/friday/month" sets `recurrence` field. On completion, auto-creates next occurrence.
- **Dependencies**: "do X after Y" sets `blocked_by` field linking to another task ID.

### Natural Language Commands

- "what's pending?" — list active tasks grouped by priority
- "done with X" / "completed X" — move to completed/, update index
- "push X to tomorrow" — update due date
- "cancel X" — move to completed/ with status: cancelled
- "update heartbeat to include X" — modify .tinyclaw/heartbeat.md

### Priority Levels

- **urgent**: due within 1 hour or explicitly marked
- **high**: due today
- **normal**: due this week (default)
- **low**: no due date or explicitly marked

## Heartbeat Changes

### Updated .tinyclaw/heartbeat.md

Replaces the static prompt with a smart checklist:

1. Read `.tinyclaw/tasks/index.json`
2. Check for overdue, due-today, and due-within-1-hour tasks
3. If nothing needs attention: respond ONLY with "HEARTBEAT_OK"
4. If tasks need attention: send reminders to the source channel
5. If heartbeat.md itself is stale, update it
6. Nudge about tasks with no due date older than 7 days

### HEARTBEAT_OK Suppression

Change to `queue-processor.js`: when Claude responds with `HEARTBEAT_OK` for a heartbeat message, skip writing to the outgoing queue. This prevents sending empty messages to WhatsApp.

```javascript
if (messageData.channel === 'heartbeat' && response.trim() === 'HEARTBEAT_OK') {
  log('INFO', 'Heartbeat: all clear, no action needed');
  return;
}
```

## Files to Create/Modify

| File | Action |
|---|---|
| `.claude/skills/task-memory/SKILL.md` | Create — main skill instructions |
| `.claude/skills/task-memory/templates/task-template.md` | Create — template for new tasks |
| `.claude/skills/task-memory/examples/sample-tasks.md` | Create — examples for Claude |
| `.tinyclaw/tasks/active/` | Create directory |
| `.tinyclaw/tasks/completed/` | Create directory |
| `.tinyclaw/tasks/index.json` | Create — empty array initially |
| `.tinyclaw/heartbeat.md` | Modify — smart checklist replacing static prompt |
| `queue-processor.js` | Modify — suppress HEARTBEAT_OK from outgoing queue |

## References

- [OpenClaw Heartbeat System](https://docs.openclaw.ai/gateway/heartbeat) — HEARTBEAT_OK silent response pattern
- [Beads Task Memory](https://github.com/steveyegge/beads) — git-backed task tracking for Claude Code
- [Claude Code Skills Docs](https://code.claude.com/docs/en/skills) — skill creation and frontmatter reference
- [Claude Code Memory Docs](https://code.claude.com/docs/en/memory) — auto memory and CLAUDE.md system
