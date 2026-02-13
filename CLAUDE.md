# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
npm run build              # Compile main (CommonJS) + visualizer (ESM)
npm run build:main         # Compile main only
npm run build:visualizer   # Compile visualizer only

npm run queue              # Start queue processor (polls incoming/ every 1s)
npm run visualize          # Start TUI dashboard (real-time event viewer)
npm run telegram           # Start Telegram channel client
npm run discord            # Start Discord channel client
npm run whatsapp           # Start WhatsApp channel client

npm run db:migrate         # Apply dbmate migrations
npm run db:rollback        # Revert last migration
```

There are no tests or linter configured in this project.

## Architecture

TinyClaw is a multi-agent AI assistant framework. Messages flow through a file-based queue:

```
Channel clients (telegram/discord/whatsapp)
  → ~/.tinyclaw/queue/incoming/*.json
    → queue-processor.ts (routes by @agent_id or @team_id prefix)
      → invokeAgent() (spawns `claude` or `codex` CLI)
        → ~/.tinyclaw/queue/outgoing/*.json
          → Channel client sends response back
```

### Key Design Decisions

- **File-based queue** (no Redis/RabbitMQ): Messages are JSON files moved atomically between `incoming/` → `processing/` → `outgoing/`.
- **Per-agent sequential, global parallel**: A `Map<string, Promise>` chains promises by agent ID so messages to the same agent are sequential, but different agents process concurrently.
- **Two TypeScript builds**: Main code is CommonJS (`tsconfig.json`), the Ink/React TUI is ES modules (`tsconfig.visualizer.json`). The build writes `{"type":"module"}` into `dist/visualizer/package.json`.
- **Event-driven TUI**: The queue processor emits JSON event files to `~/.tinyclaw/events/`. The visualizer watches that directory with `fs.watch()` — it never queries the database.
- **Database is optional**: Uses dbmate for migrations if installed, otherwise falls back to `CREATE TABLE IF NOT EXISTS` via better-sqlite3.
- **Agent invocation is CLI-based**: Spawns `claude` (Anthropic) or `codex` (OpenAI) as child processes. Not using the API SDK directly for agent work — only for rate limit checks.
- **dotenv**: Loaded by channel clients and queue-processor. The `.env` file at project root holds `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, etc.

### Source Layout

- `src/queue-processor.ts` — Main loop: polls queue, routes messages, executes team chains (sequential handoff or parallel fan-out), writes responses.
- `src/lib/invoke.ts` — `invokeAgent()` spawns CLI processes. `checkAnthropicRateLimits()` makes a lightweight API call post-invocation to record rate limit headers.
- `src/lib/config.ts` — Reads `~/.tinyclaw/settings.json`. Exports all path constants (`TINYCLAW_HOME`, `QUEUE_INCOMING`, `DB_PATH`, etc.). `getAgents()` falls back to a single "default" agent from the legacy `models` section.
- `src/lib/routing.ts` — Parses `@agent` / `@team` prefixes. `extractTeammateMentions()` detects `[@agent: message]` tags (fan-out) or bare `@agent` mentions (single handoff) in agent responses.
- `src/lib/db.ts` — SQLite with WAL mode. Two tables: `token_usage` (per-invocation estimates) and `api_rate_limits` (Anthropic rate limit headers per agent).
- `src/lib/agent-setup.ts` — Creates agent working directories with template files (`.claude/`, `SOUL.md`, `AGENTS.md`, `heartbeat.md`). Updates `AGENTS.md` between `<!-- TEAMMATES_START/END -->` markers.
- `src/lib/logging.ts` — `log()` writes to file + stdout. `emitEvent()` writes JSON files to events dir for the TUI.
- `src/channels/*.ts` — Bridge between messaging platforms and the file queue. Handle file uploads/downloads. No AI logic.
- `src/visualizer/team-visualizer.tsx` — React/Ink TUI. Displays agent status cards, chain flow arrows, rate limit bars, activity log. Consumes events via `fs.watch()`.
- `lib/*.sh` — Bash CLI: daemon management (tmux), agent/team CRUD, setup wizard, heartbeat cron.

### Team Collaboration

When a message is routed to a team's leader agent:
1. Leader responds. If the response mentions a teammate (`@agent_id`), the chain continues.
2. **Single mention** → sequential handoff (previous response becomes next agent's input).
3. **Multiple mentions** via `[@agent: message]` tags → parallel fan-out with `Promise.all()`.
4. Chain ends when an agent responds without mentioning a teammate.
5. All step responses are aggregated with `---` separators.

### Providers

- **Anthropic**: `claude --dangerously-skip-permissions --model {id} -c -p "{message}"`. Model aliases: `sonnet` → `claude-sonnet-4-5`, `opus` → `claude-opus-4-6`.
- **OpenAI**: `codex exec [resume --last] --model {id} --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --json {message}`. Parses JSONL output for `item.completed` events.

### Configuration

Central config: `~/.tinyclaw/settings.json` (or `.tinyclaw/settings.json` in project root if it exists there). Defines agents, teams, channels, workspace path. Types in `src/lib/types.ts`.
