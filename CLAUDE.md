# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
npm install              # Install dependencies
npm run build            # Full build (main TypeScript + visualizer)
npm run build:main       # Build queue processor & channels only (tsc)
npm run build:visualizer # Build team visualizer only (separate tsconfig)

./tinyclaw.sh start      # Launch tmux session with all components
./tinyclaw.sh stop       # Kill tmux session and cleanup
./tinyclaw.sh restart    # Stop and start
./tinyclaw.sh status     # Show running processes

./tinyclaw.sh logs all   # Tail all logs (also: queue, discord, telegram, whatsapp)
```

Run individual components directly:
```bash
npm run queue            # Queue processor only
npm run discord          # Discord client only
npm run telegram         # Telegram client only
npm run whatsapp         # WhatsApp client only
npm run visualize        # Team visualizer TUI
```

No test suite exists yet. Verify changes by building (`npm run build`) and running locally (`./tinyclaw.sh start`).

## Architecture

TinyClaw is a multi-agent, multi-channel AI assistant platform that runs 24/7 via tmux. Messages flow through a **file-based queue system** (no database):

```
Channel Clients (Discord/Telegram/WhatsApp)
  → ~/.tinyclaw/queue/incoming/     (JSON message files)
  → Queue Processor (routing + invocation)
  → ~/.tinyclaw/queue/outgoing/     (response files)
  → Channel Clients deliver response
```

### Two Language Layers

- **TypeScript (`src/`)**: Core runtime — queue processor, channel clients, routing, agent invocation, team visualizer
- **Bash (`lib/`)**: CLI and daemon management — startup/shutdown, setup wizard, agent/team CRUD commands, heartbeat cron

The main CLI entry point is `tinyclaw.sh` which loads bash libraries from `lib/` and dispatches commands. The TypeScript runtime compiles to `dist/` (ES2020, CommonJS).

### Key TypeScript Files

| File | Role |
|------|------|
| `src/queue-processor.ts` | Main loop — polls incoming queue, routes messages, tracks conversations, aggregates team responses |
| `src/lib/routing.ts` | Parses `@agent_id` prefixes and `[@teammate: message]` mention tags |
| `src/lib/invoke.ts` | Spawns Claude/Codex/OpenCode CLI processes per agent |
| `src/lib/config.ts` | Loads `~/.tinyclaw/settings.json`, resolves model names |
| `src/lib/types.ts` | All TypeScript interfaces (AgentConfig, TeamConfig, MessageData, Conversation) |
| `src/channels/*-client.ts` | Channel integrations — read outgoing queue, write to incoming queue |
| `src/visualizer/team-visualizer.ts` | React + Ink TUI dashboard for team collaboration |

### Key Bash Files

| File | Role |
|------|------|
| `lib/daemon.sh` | tmux session management, pane layout, process lifecycle |
| `lib/agents.sh` | Agent CRUD (add, remove, reset, list, provider switch) |
| `lib/teams.sh` | Team CRUD and visualization |
| `lib/messaging.sh` | CLI `send` command, log viewing |
| `lib/setup-wizard.sh` | First-run interactive configuration |
| `lib/common.sh` | Shared utilities, channel registry, settings loading |

### Core Design Patterns

- **Agent isolation**: Each agent has its own workspace directory (`~/tinyclaw-workspace/{agent_id}/`) with independent `.claude/` config and conversation history
- **Parallel-per-agent, sequential-per-conversation**: Different agents process concurrently; messages to the same agent are serialized
- **Actor model for teams**: Agents communicate via `[@agent_id: message]` tags parsed from responses, spawning new queue messages. No central orchestrator
- **Atomic file operations**: Queue uses filesystem move operations to prevent race conditions and message loss
- **Three-state queue**: `incoming/` → `processing/` → `outgoing/`, with recovery for orphaned files

### Runtime Data

All runtime state lives under `~/.tinyclaw/` (overridable via `TINYCLAW_HOME`):
- `settings.json` — agents, teams, channels, models config
- `pairing.json` — sender allowlist state
- `queue/{incoming,processing,outgoing}/` — message pipeline
- `logs/` — per-component log files
- `chats/` — team conversation history
- `events/` — real-time event files for visualizer

### AI Provider Support

Three providers with CLI-based invocation: Anthropic Claude (`claude`), OpenAI Codex (`codex`), and OpenCode (`opencode`). Model aliases are resolved in `src/lib/config.ts` (e.g., `sonnet` → `claude-sonnet-4-5`, `opus` → `claude-opus-4-6`). Each agent can use a different provider/model.

### Visualizer

The team visualizer (`src/visualizer/`) is a separate TypeScript build target (`tsconfig.visualizer.json`) that outputs ESM. It uses React + Ink for a terminal UI showing real-time team collaboration.
