---
name: tinyclaw-admin
description: "Manage and operate the TinyClaw system itself — agents, teams, settings, queue, tasks, daemon lifecycle, and source code. Use when the agent needs to: list/add/remove/update agents or teams, check queue status, view logs, start/stop/restart TinyClaw, change settings (provider, model, channels), send messages to the queue, manage tasks, retry dead-letter messages, view recent responses, modify TinyClaw source code or configuration, or perform any administrative operation on the TinyClaw platform. Triggers: 'manage tinyclaw', 'add an agent', 'remove a team', 'check queue', 'view logs', 'restart tinyclaw', 'change provider', 'update settings', 'create a task', 'modify tinyclaw code'."
---

# TinyClaw Admin

Operate and manage the TinyClaw multi-agent system. This skill covers both runtime administration (via the REST API) and source code modification.

## Important paths

- **TinyClaw home (runtime data):** `~/.tinyclaw/`
  - `settings.json` — all configuration (agents, teams, channels, models, workspace)
  - `tinyclaw.db` — SQLite queue database
  - `tasks.json` — Kanban tasks
  - `pairing.json` — sender allowlist
  - `logs/` — queue, daemon, and channel logs
  - `chats/` — team chain chat history
  - `events/` — real-time event files
  - `plugins/` — plugin directory
- **TinyClaw source code:** the repo where this skill is installed (check `git rev-parse --show-toplevel` or look for `tinyclaw.sh` in parent dirs)
- **Agent workspaces:** configured in `settings.json` under `workspace.path` (default: `~/tinyclaw-workspace/{agent_id}/`)

## Interactivity warning

Many `tinyclaw` CLI commands are **interactive** (prompt for user input). Do NOT run these directly:
- `tinyclaw setup` — fully interactive wizard
- `tinyclaw agent add` — prompts for all fields
- `tinyclaw team add` — prompts for all fields
- `tinyclaw agent remove <id>` — prompts `[y/N]`
- `tinyclaw team remove <id>` — prompts `[y/N]`
- `tinyclaw team remove-agent <t> <a>` — may prompt for new leader + `[y/N]`

**Instead, use the REST API or direct `settings.json` edits** (see below).

### Non-interactive CLI commands (safe to run)

These CLI commands accept all parameters as arguments and do not prompt:

```bash
tinyclaw start                              # Start daemon
tinyclaw stop                               # Stop all processes
tinyclaw restart                            # Restart daemon
tinyclaw status                             # Show status
tinyclaw logs [queue|discord|telegram|whatsapp|heartbeat|daemon|all]
tinyclaw send "<message>"                   # Send message to default agent
tinyclaw send "@agent_id <message>"         # Send to specific agent
tinyclaw reset <agent_id> [agent_id...]     # Reset agent conversations
tinyclaw provider anthropic                 # Switch global provider
tinyclaw provider openai --model gpt-5.3-codex
tinyclaw model sonnet                       # Switch global model
tinyclaw agent list                         # List agents
tinyclaw agent show <id>                    # Show agent config
tinyclaw agent provider <id> <provider>     # Set agent provider
tinyclaw agent provider <id> <provider> --model <model>
tinyclaw team list                          # List teams
tinyclaw team show <id>                     # Show team config
tinyclaw team add-agent <team_id> <agent_id>  # Add agent to team (no prompts)
tinyclaw channels reset <channel>           # Reset channel auth
tinyclaw pairing list                       # Show all pairings
tinyclaw pairing pending                    # Show pending
tinyclaw pairing approved                   # Show approved
tinyclaw pairing approve <code>             # Approve a sender
tinyclaw pairing unpair <channel> <sender_id>
```

## REST API (preferred for programmatic operations)

The API server runs on `http://localhost:3777` (configurable via `TINYCLAW_API_PORT`). The API server is available when TinyClaw is running.

### Agents

```bash
# List agents
curl -s http://localhost:3777/api/agents | jq

# Create or update agent (non-interactive, auto-provisions workspace)
curl -s -X PUT http://localhost:3777/api/agents/coder \
  -H 'Content-Type: application/json' \
  -d '{"name":"Coder","provider":"anthropic","model":"sonnet"}'

# Create agent with a system prompt (written to AGENTS.md in workspace on provisioning)
curl -s -X PUT http://localhost:3777/api/agents/coder \
  -H 'Content-Type: application/json' \
  -d '{"name":"Coder","provider":"anthropic","model":"sonnet","system_prompt":"You are a senior engineer. Always write tests."}'

# Optional fields: working_directory, system_prompt, prompt_file

# Delete agent
curl -s -X DELETE http://localhost:3777/api/agents/coder
```

### Teams

```bash
# List teams
curl -s http://localhost:3777/api/teams | jq

# Create or update team
curl -s -X PUT http://localhost:3777/api/teams/dev \
  -H 'Content-Type: application/json' \
  -d '{"name":"Dev Team","agents":["coder","reviewer"],"leader_agent":"coder"}'

# Delete team
curl -s -X DELETE http://localhost:3777/api/teams/dev
```

### Settings

```bash
# Get full settings
curl -s http://localhost:3777/api/settings | jq

# Update settings (shallow merge)
curl -s -X PUT http://localhost:3777/api/settings \
  -H 'Content-Type: application/json' \
  -d '{"monitoring":{"heartbeat_interval":1800}}'
```

### Messages

```bash
# Send message to queue (processed by agent)
curl -s -X POST http://localhost:3777/api/message \
  -H 'Content-Type: application/json' \
  -d '{"message":"@coder fix the login bug","sender":"Admin","channel":"api"}'
```

### Queue

```bash
# Queue status
curl -s http://localhost:3777/api/queue/status | jq

# Recent responses
curl -s http://localhost:3777/api/responses?limit=10 | jq

# Dead-letter messages
curl -s http://localhost:3777/api/queue/dead | jq

# Retry a dead message
curl -s -X POST http://localhost:3777/api/queue/dead/123/retry

# Delete a dead message
curl -s -X DELETE http://localhost:3777/api/queue/dead/123
```

### Tasks

```bash
# List tasks
curl -s http://localhost:3777/api/tasks | jq

# Create task
curl -s -X POST http://localhost:3777/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Fix auth bug","description":"Login fails on mobile","status":"backlog","assignee":"coder","assigneeType":"agent"}'

# Update task
curl -s -X PUT http://localhost:3777/api/tasks/TASK_ID \
  -H 'Content-Type: application/json' \
  -d '{"status":"in-progress"}'

# Delete task
curl -s -X DELETE http://localhost:3777/api/tasks/TASK_ID
```

### Logs

```bash
# Recent queue logs
curl -s http://localhost:3777/api/logs?limit=50 | jq
```

## Direct settings.json editing

> **WARNING — agents should not edit settings.json directly.** Direct edits bypass all validation and can corrupt or destroy the running configuration. Agents running with `--dangerously-skip-permissions` have unrestricted file access, which makes an accidental overwrite unrecoverable. Always prefer the REST API (`PUT /api/agents`, `PUT /api/teams`, `PUT /api/settings`) which validates input, merges safely, and keeps the system consistent.
>
> Direct editing is a last resort for **human operators only** when the API server is not running and there is no other option.

If a human operator must edit `~/.tinyclaw/settings.json` while the daemon is stopped, back up the file first and use `jq` for atomic edits:

```bash
SETTINGS="$HOME/.tinyclaw/settings.json"

# Always back up first
cp "$SETTINGS" "$SETTINGS.bak"

# Add an agent
jq --arg id "analyst" --argjson agent '{"name":"Analyst","provider":"anthropic","model":"sonnet","working_directory":"'$HOME'/tinyclaw-workspace/analyst"}' \
  '.agents[$id] = $agent' "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"

# Remove an agent
jq 'del(.agents["analyst"])' "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"

# Add a team
jq --arg id "research" --argjson team '{"name":"Research Team","agents":["analyst","writer"],"leader_agent":"analyst"}' \
  '.teams //= {} | .teams[$id] = $team' "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"
```

After editing `settings.json`, run `tinyclaw restart` to pick up changes.

## POST /api/setup is for initial setup only

`POST /api/setup` **fully replaces** settings.json — it does not merge. It will be rejected with HTTP 409 if agents are already configured. There is no override. To modify a running system, use `PUT /api/agents/:id`, `PUT /api/teams/:id`, or `PUT /api/settings`.

## Modifying TinyClaw source code

When modifying TinyClaw's own code (features, bug fixes, new routes, etc.):

- **Source code:** `src/` directory (TypeScript)
  - `src/server/` — API server (Hono framework)
  - `src/server/routes/` — route handlers (agents, teams, settings, queue, tasks, messages, logs, chats)
  - `src/lib/` — shared utilities (config, db, logging, types, plugins)
- **Shell scripts:** `lib/` — bash libraries (agents.sh, teams.sh, daemon.sh, messaging.sh, etc.)
- **Main CLI:** `tinyclaw.sh` — command dispatcher
- **Compiled output:** `dist/` — run `npm run build` after TypeScript changes
- **Skills:** `.agents/skills/` — skill definitions (copied to agent workspaces on provision)
- **Web portal:** `tinyoffice/` — Next.js app

After modifying TypeScript source, rebuild:

```bash
cd <tinyclaw-repo> && npm run build
```

Then restart the daemon to load changes:

```bash
tinyclaw restart
```

## Workflow examples

### Add a new agent and assign to a team

```bash
# 1. Create agent via API
curl -s -X PUT http://localhost:3777/api/agents/reviewer \
  -H 'Content-Type: application/json' \
  -d '{"name":"Code Reviewer","provider":"anthropic","model":"sonnet"}'

# 2. Add to existing team (non-interactive CLI)
tinyclaw team add-agent dev reviewer
```

### Check system health

```bash
tinyclaw status
curl -s http://localhost:3777/api/queue/status | jq
curl -s http://localhost:3777/api/queue/dead | jq
tinyclaw logs queue
```

### Create a task and assign to agent

```bash
curl -s -X POST http://localhost:3777/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Review PR #42","status":"backlog","assignee":"reviewer","assigneeType":"agent"}'
```
