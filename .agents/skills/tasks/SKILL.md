---
name: tasks
description: "Manage your assigned tasks on the TinyAGI kanban board — list tasks, update task status, create new tasks, and add or view comments. Use when: you receive a message with a [task:ID] tag and need to mark it done, you want to check your task queue, you want to propose new work, or you need to add a comment/update to a task. Triggers: 'update task', 'mark task done', 'list my tasks', 'create task', 'check tasks', 'comment on task', 'task comments', or any message containing [task:ID]."
---

# Tasks

Manage tasks on the TinyAGI kanban board via the REST API.

## Automatic task completion

When you receive a message containing a `[task:TASK_ID]` tag, it means this work was dispatched from the task board. After you finish the work:

```bash
<skill_dir>/scripts/tasks.sh update TASK_ID --status done
```

Replace `TASK_ID` with the ID from the `[task:...]` tag in the message.

You should also leave a comment on the task to summarize what you did:

```bash
<skill_dir>/scripts/tasks.sh comment TASK_ID --content "Completed: brief summary of what was done"
```

## Commands

### List tasks

```bash
# List all tasks
<skill_dir>/scripts/tasks.sh list

# List only your own tasks (uses TINYAGI_AGENT_ID env var)
<skill_dir>/scripts/tasks.sh list --mine

# List tasks with a specific status
<skill_dir>/scripts/tasks.sh list --status in_progress

# Combine filters
<skill_dir>/scripts/tasks.sh list --mine --status in_progress
```

### Update a task

```bash
# Move task to done
<skill_dir>/scripts/tasks.sh update TASK_ID --status done

# Move task to review
<skill_dir>/scripts/tasks.sh update TASK_ID --status review
```

Valid statuses: `backlog`, `in_progress`, `review`, `done`

### Create a task

New tasks are always created in `backlog` status.

```bash
# Create a task assigned to yourself
<skill_dir>/scripts/tasks.sh create --title "Refactor auth module"

# Create with description
<skill_dir>/scripts/tasks.sh create --title "Fix login bug" --description "Login fails on mobile Safari"

# Create and assign to another agent
<skill_dir>/scripts/tasks.sh create --title "Review PR #42" --assignee reviewer --assignee-type agent
```

### Add a comment to a task

```bash
# Add a comment to a task (author defaults to your agent ID)
<skill_dir>/scripts/tasks.sh comment TASK_ID --content "Started working on this, found the root cause in auth.ts"

# Use comments to provide progress updates, share findings, or summarize completed work
<skill_dir>/scripts/tasks.sh comment TASK_ID --content "Completed: refactored auth module, PR #55 is up for review"
```

### List comments on a task

```bash
# View all comments on a task
<skill_dir>/scripts/tasks.sh comments TASK_ID
```

## Environment

- `TINYAGI_AGENT_ID` — your agent ID (set automatically, used by `--mine` and as default comment author)
- `TINYAGI_API_PORT` — API port (default: 3777)
