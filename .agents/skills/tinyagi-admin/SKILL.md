---
name: tinyagi-admin
description: "Manage and operate the TinyAGI system itself — agents, teams, settings, queue, tasks, daemon lifecycle, and source code. Use when the agent needs to: list/add/remove/update agents or teams, check queue status, view logs, start/stop/restart TinyAGI, change settings (provider, model, channels), send messages to the queue, manage tasks, retry dead-letter messages, view recent responses, modify TinyAGI source code or configuration, or perform any administrative operation on the TinyAGI platform. Triggers: 'manage tinyagi', 'add an agent', 'remove a team', 'check queue', 'view logs', 'restart tinyagi', 'change provider', 'update settings', 'create a task', 'modify tinyagi code'."
---

# TinyAGI Admin

Operate and manage the TinyAGI multi-agent system. This skill covers both runtime administration (via the REST API) and source code modification.

## Important paths

- **TinyAGI home (runtime data):** `~/.tinyagi/`
  - `settings.json` — all configuration (agents, teams, channels, models, workspace)
  - `tinyagi.db` — SQLite queue database
  - `tasks.json` — Kanban tasks
  - `pairing.json` — sender allowlist
  - `logs/` — queue, daemon, and channel logs
  - `chats/` — team chain chat history
  - `events/` — real-time event files
  - `plugins/` — plugin directory
- **TinyAGI source code:** the repo where this skill is installed (check `git rev-parse --show-toplevel` or look for `tinyagi.sh` in parent dirs)
- **Agent workspaces:** configured in `settings.json` under `workspace.path` (default: `~/tinyagi-workspace/{agent_id}/`)

## Interactivity warning

Many `tinyagi` CLI commands are **interactive** (prompt for user input). Do NOT run these directly:
- `tinyagi setup` — fully interactive wizard
- `tinyagi agent add` — prompts for all fields
- `tinyagi team add` — prompts for all fields
- `tinyagi agent remove <id>` — prompts `[y/N]`
- `tinyagi team remove <id>` — prompts `[y/N]`
- `tinyagi team remove-agent <t> <a>` — may prompt for new leader + `[y/N]`

**Instead, use the REST API or direct `settings.json` edits** (see below).

### Non-interactive CLI commands (safe to run)

These CLI commands accept all parameters as arguments and do not prompt:

```bash
tinyagi start                              # Start daemon
tinyagi stop                               # Stop all processes
tinyagi restart                            # Restart daemon
tinyagi status                             # Show status
tinyagi logs [queue|discord|telegram|whatsapp|heartbeat|daemon|all]
tinyagi send "<message>"                   # Send message to default agent
tinyagi send "@agent_id <message>"         # Send to specific agent
tinyagi reset <agent_id> [agent_id...]     # Reset agent conversations
tinyagi provider anthropic                 # Switch global provider
tinyagi provider openai --model gpt-5.3-codex
tinyagi model sonnet                       # Switch global model
tinyagi agent list                         # List agents
tinyagi agent show <id>                    # Show agent config
tinyagi agent provider <id> <provider>     # Set agent provider
tinyagi agent provider <id> <provider> --model <model>
tinyagi team list                          # List teams
tinyagi team show <id>                     # Show team config
tinyagi team add-agent <team_id> <agent_id>  # Add agent to team (no prompts)
tinyagi channel start <channel>            # Start a channel
tinyagi channel stop <channel>             # Stop a channel
tinyagi channel restart <channel>          # Restart a channel
tinyagi channel reset <channel>            # Reset channel auth
tinyagi pairing list                       # Show all pairings
tinyagi pairing pending                    # Show pending
tinyagi pairing approved                   # Show approved
tinyagi pairing approve <code>             # Approve a sender
tinyagi pairing unpair <channel> <sender_id>
```

## REST API (preferred for programmatic operations)

The API server runs on `http://localhost:3777` (configurable via `TINYAGI_API_PORT`). The API server is available when TinyAGI is running.

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

### Services (channels & daemon)

```bash
# Start a channel
curl -s -X POST http://localhost:3777/api/services/channel/telegram/start

# Stop a channel
curl -s -X POST http://localhost:3777/api/services/channel/telegram/stop

# Restart a channel
curl -s -X POST http://localhost:3777/api/services/channel/telegram/restart

# Start all enabled channels
curl -s -X POST http://localhost:3777/api/services/apply

# Restart the entire process (exit code 75 triggers restart loop in Docker)
curl -s -X POST http://localhost:3777/api/services/restart
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

When the API server is not running, edit `~/.tinyagi/settings.json` directly. Use `jq` for safe atomic edits:

```bash
SETTINGS="$HOME/.tinyagi/settings.json"

# Add an agent
jq --arg id "analyst" --argjson agent '{"name":"Analyst","provider":"anthropic","model":"sonnet","working_directory":"'$HOME'/tinyagi-workspace/analyst"}' \
  '.agents[$id] = $agent' "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"

# Remove an agent
jq 'del(.agents["analyst"])' "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"

# Add a team
jq --arg id "research" --argjson team '{"name":"Research Team","agents":["analyst","writer"],"leader_agent":"analyst"}' \
  '.teams //= {} | .teams[$id] = $team' "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"
```

After editing `settings.json`, run `tinyagi restart` to pick up changes.

## Modifying TinyAGI source code

When modifying TinyAGI's own code (features, bug fixes, new routes, etc.):

- **Monorepo packages:**
  - `packages/core/src/` — shared utilities (config, db, logging, types, plugins, agent invocation)
  - `packages/server/src/` — API server (Hono framework)
  - `packages/server/src/routes/` — route handlers (agents, teams, settings, queue, tasks, messages, logs, services)
  - `packages/main/src/` — entry point, queue processor, channel/heartbeat lifecycle
  - `packages/cli/src/` — CLI modules (daemon, channel, install, logs, agent, team, provider, etc.)
  - `packages/cli/bin/tinyagi.mjs` — thin CLI dispatcher (delegates to compiled modules in `dist/`)
  - `packages/teams/src/` — team orchestration
  - `packages/visualizer/src/` — TUI dashboards (team visualizer, chatroom viewer)
- **Skills:** `.agents/skills/` — skill definitions (copied to agent workspaces on provision)
- **Web portal:** `tinyoffice/` — Next.js app
- **Docker:** `Dockerfile`, `docker-entrypoint.sh`, `docker-compose.yml`

After modifying TypeScript source, rebuild:

```bash
cd <tinyagi-repo> && npm run build
```

Then restart the daemon to load changes:

```bash
tinyagi restart
```

## Workflow examples

### Add a new agent and assign to a team

```bash
# 1. Create agent via API
curl -s -X PUT http://localhost:3777/api/agents/reviewer \
  -H 'Content-Type: application/json' \
  -d '{"name":"Code Reviewer","provider":"anthropic","model":"sonnet"}'

# 2. Add to existing team (non-interactive CLI)
tinyagi team add-agent dev reviewer
```

### Check system health

```bash
tinyagi status
curl -s http://localhost:3777/api/queue/status | jq
curl -s http://localhost:3777/api/queue/dead | jq
tinyagi logs queue
```

### Create a task and assign to agent

```bash
curl -s -X POST http://localhost:3777/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Review PR #42","status":"backlog","assignee":"reviewer","assigneeType":"agent"}'
```
