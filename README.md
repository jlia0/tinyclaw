<div align="center">
  <img src="./docs/images/tinyclaw.png" alt="TinyClaw" width="600" />
  <h1>TinyClaw 🦞</h1>
  <p><strong>Multi-agent, Multi-team, Multi-channel, 24/7 AI assistant</strong></p>
  <p>Run multiple teams of AI agents that collaborate with each other simultaneously with isolated workspaces.</p>
  <p>
    <img src="https://img.shields.io/badge/stability-experimental-orange.svg" alt="Experimental" />
    <a href="https://opensource.org/licenses/MIT">
      <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" />
    </a>
    <a href="https://discord.gg/jH6AcEChuD">
      <img src="https://img.shields.io/discord/1353722981163208785?logo=discord&logoColor=white&label=Discord&color=7289DA" alt="Discord" />
    </a>
    <a href="https://github.com/TinyAGI/tinyclaw/releases/latest">
      <img src="https://img.shields.io/github/v/release/TinyAGI/tinyclaw?label=Latest&color=green" alt="Latest Release" />
    </a>
  </p>
</div>

<div align="center">
  <video src="https://github.com/user-attachments/assets/c5ef5d3c-d9cf-4a00-b619-c31e4380df2e" width="600" controls></video>
</div>

## ✨ Features

- ✅ **Multi-agent** - Run multiple isolated AI agents with specialized roles
- ✅ **Multi-team collaboration** - Agents hand off work to teammates via chain execution and fan-out
- ✅ **Multi-channel** - Discord, WhatsApp, and Telegram
- ✅ **Web portal (TinyOffice)** - Browser-based dashboard for chat, agents, teams, tasks, logs, and settings
- ✅ **Team Observation** - You can observe agent teams conversations via `tinyclaw team visualize`
- ✅ **Multiple AI providers** - Anthropic Claude and OpenAI Codex using existing subscriptions without breaking ToS
- ✅ **Parallel processing** - Agents process messages concurrently
- ✅ **Live TUI dashboard** - Real-time team visualizer for monitoring agent chains
- ✅ **Persistent sessions** - Conversation context maintained across restarts
- ✅ **SQLite queue** - Atomic transactions, retry logic, dead-letter management
- ✅ **24/7 operation** - Runs in tmux for always-on availability

## Community

[Discord](https://discord.com/invite/jH6AcEChuD)

We are actively looking for contributors. Please reach out.

## 🚀 Quick Start

### Prerequisites

- macOS, Linux and Windows (WSL2)
- Node.js v18+
- tmux, jq
- Bash 4.0+ (macOS: `brew install bash`)
- [Claude Code CLI](https://claude.com/claude-code) (for Anthropic provider)
- [Codex CLI](https://docs.openai.com/codex) (for OpenAI provider)

### Installation

**Option 1: One-line Install (Recommended)**

```bash
curl -fsSL https://raw.githubusercontent.com/TinyAGI/tinyclaw/main/scripts/remote-install.sh | bash
```

**Option 2: From Release**

```bash
wget https://github.com/TinyAGI/tinyclaw/releases/latest/download/tinyclaw-bundle.tar.gz
tar -xzf tinyclaw-bundle.tar.gz
cd tinyclaw && ./scripts/install.sh
```

**Option 3: From Source**

```bash
git clone https://github.com/TinyAGI/tinyclaw.git
cd tinyclaw && npm install && ./scripts/install.sh
```

### First Run

```bash
tinyclaw start  # Runs interactive setup wizard
```

The setup wizard will guide you through:

1. **Channel selection** - Choose Discord, WhatsApp, and/or Telegram
2. **Bot tokens** - Enter tokens for enabled channels
3. **Workspace setup** - Name your workspace directory
4. **Default agent** - Configure your main AI assistant
5. **AI provider** - Select Anthropic (Claude) or OpenAI
6. **Model selection** - Choose model (e.g., Sonnet, Opus, GPT-5.3)
7. **Heartbeat interval** - Set proactive check-in frequency

<details>
<summary><b>📱 Channel Setup Guides</b></summary>

### Discord Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create application → Bot section → Create bot
3. Copy bot token
4. Enable "Message Content Intent"
5. Invite bot using OAuth2 URL Generator

### Telegram Setup

1. Open Telegram → Search `@BotFather`
2. Send `/newbot` → Follow prompts
3. Copy bot token
4. Start chat with your bot

### WhatsApp Setup

After starting TinyClaw, scan the QR code:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     WhatsApp QR Code
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[QR CODE HERE]

📱 Settings → Linked Devices → Link a Device
```

</details>

---

## 🌐 TinyOffice Web Portal

TinyClaw includes `tinyoffice/`, a Next.js web portal for operating TinyClaw from the browser.

<div align="center">
  <img src="./docs/images/tinyoffice.png" alt="TinyOffice Office View" width="700" />
</div>

### TinyOffice Features

- **Dashboard** - Real-time queue/system overview and live event feed
- **Chat Console** - Send messages to default agent, `@agent`, or `@team`
- **Agents & Teams** - Create, edit, and remove agents/teams
- **Tasks (Kanban)** - Create tasks, drag across stages, assign to agent/team
- **Logs & Events** - Inspect queue logs and streaming events
- **Settings** - Edit TinyClaw configuration (`settings.json`) via UI
- **Office View** - Visual simulation of agent interactions

### Run TinyOffice

Start TinyClaw first (API default: `http://localhost:3777`), then:

```bash
cd tinyoffice
npm install
npm run dev
```

Open `http://localhost:3000`.

If TinyClaw API is on a different host/port, set:

```bash
cd tinyoffice
echo 'NEXT_PUBLIC_API_URL=http://localhost:3777' > .env.local
```

## 📋 Commands

Commands work with `tinyclaw` (if CLI installed) or `./tinyclaw.sh` (direct script).

### Core Commands

| Command       | Description                                               | Example               |
| ------------- | --------------------------------------------------------- | --------------------- |
| `start`       | Start TinyClaw daemon                                     | `tinyclaw start`      |
| `stop`        | Stop all processes                                        | `tinyclaw stop`       |
| `restart`     | Restart TinyClaw                                          | `tinyclaw restart`    |
| `status`      | Show current status and activity                          | `tinyclaw status`     |
| `setup`       | Run setup wizard (reconfigure)                            | `tinyclaw setup`      |
| `logs [type]` | View logs (discord/telegram/whatsapp/queue/heartbeat/all) | `tinyclaw logs queue` |
| `attach`      | Attach to tmux session                                    | `tinyclaw attach`     |

### Agent Commands

| Command                              | Description                      | Example                                          |
| ------------------------------------ | -------------------------------- | ------------------------------------------------ |
| `agent list`                         | List all configured agents       | `tinyclaw agent list`                            |
| `agent add`                          | Add new agent (interactive)      | `tinyclaw agent add`                             |
| `agent show <id>`                    | Show agent configuration         | `tinyclaw agent show coder`                      |
| `agent remove <id>`                  | Remove an agent                  | `tinyclaw agent remove coder`                    |
| `agent reset <id>`                   | Reset agent conversation         | `tinyclaw agent reset coder`                     |
| `agent provider <id> [provider]`     | Show or set agent's AI provider  | `tinyclaw agent provider coder anthropic`        |
| `agent provider <id> <p> --model <m>`| Set agent's provider and model   | `tinyclaw agent provider coder openai --model gpt-5.3-codex` |

### Team Commands

| Command               | Description                        | Example                       |
| --------------------- | ---------------------------------- | ----------------------------- |
| `team list`           | List all configured teams          | `tinyclaw team list`          |
| `team add`            | Add new team (interactive)         | `tinyclaw team add`           |
| `team show <id>`      | Show team configuration            | `tinyclaw team show dev`      |
| `team remove <id>`    | Remove a team                      | `tinyclaw team remove dev`    |
| `team visualize [id]` | Live TUI dashboard for team chains | `tinyclaw team visualize dev` |

### Tool Commands

| Command                  | Description                                      | Example                    |
| ------------------------ | ------------------------------------------------ | -------------------------- |
| `tools sync [agent_id]`  | Sync OpenViking CLI tools into agent workspace(s) | `tinyclaw tools sync coder` |

### Configuration Commands

| Command                           | Description                  | Example                                          |
| --------------------------------- | ---------------------------- | ------------------------------------------------ |
| `provider [name]`                 | Show or switch AI provider   | `tinyclaw provider anthropic`                    |
| `provider <name> --model <model>` | Switch provider and model    | `tinyclaw provider openai --model gpt-5.3-codex` |
| `model [name]`                    | Show or switch AI model      | `tinyclaw model opus`                            |
| `reset`                           | Reset all conversations      | `tinyclaw reset`                                 |
| `channels reset <channel>`        | Reset channel authentication | `tinyclaw channels reset whatsapp`               |

### Pairing Commands

Use sender pairing to control who can message your agents.

| Command                                | Description                                        | Example                                    |
| -------------------------------------- | -------------------------------------------------- | ------------------------------------------ |
| `pairing pending`                      | Show pending sender approvals (with pairing codes) | `tinyclaw pairing pending`                 |
| `pairing approved`                     | Show approved senders                              | `tinyclaw pairing approved`                |
| `pairing list`                         | Show both pending and approved senders             | `tinyclaw pairing list`                    |
| `pairing approve <code>`               | Move a sender from pending to approved by code     | `tinyclaw pairing approve ABCD1234`        |
| `pairing unpair <channel> <sender_id>` | Remove an approved sender from the allowlist       | `tinyclaw pairing unpair telegram 1234567` |

Pairing behavior:

- First message from unknown sender: TinyClaw generates a code and sends approval instructions.
- Additional messages while still pending: TinyClaw blocks silently (no repeated pairing message).
- After approval: messages from that sender are processed normally.

### Update Commands

| Command  | Description                       | Example           |
| -------- | --------------------------------- | ----------------- |
| `update` | Update TinyClaw to latest version | `tinyclaw update` |

> **Note:** If you are on v0.0.1 or v0.0.2, the update script was broken. Please re-install instead:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/TinyAGI/tinyclaw/main/scripts/remote-install.sh | bash
> ```
>
> Your settings and user data will be preserved.

<details>
<summary><b>Update Details</b></summary>

**Auto-detection:** TinyClaw checks for updates on startup (once per hour).

**Manual update:**

```bash
tinyclaw update
```

This will:

1. Check for latest release
2. Show changelog URL
3. Download bundle
4. Create backup of current installation
5. Install new version

**Disable update checks:**

```bash
export TINYCLAW_SKIP_UPDATE_CHECK=1
```

</details>

### Messaging Commands

| Command          | Description                 | Example                          |
| ---------------- | --------------------------- | -------------------------------- |
| `send <message>` | Send message to AI manually | `tinyclaw send "Hello!"`         |
| `send <message>` | Route to specific agent     | `tinyclaw send "@coder fix bug"` |

## 🧰 OpenViking Workspace Tools

TinyClaw can provision lightweight OpenViking tools into each agent workspace:

```bash
tinyclaw tools sync
```

Tools are installed at:

```bash
<workspace>/<agent_id>/.tinyclaw/tools/openviking/
```

Common usage from an agent directory:

```bash
cd .tinyclaw/tools/openviking
./ovk-ls.sh /
./ovk-read.sh /context/spec.md
./ovk-write.sh /context/spec.md "updated content"
./ovk.sh res-get viking://workspace/resource
```

Environment variables:

- `OPENVIKING_BASE_URL` (default: `http://127.0.0.1:8320`)
- `OPENVIKING_API_KEY` (optional)
- `OPENVIKING_PROJECT` (optional)

### OpenViking Native Session Write Path

TinyClaw supports OpenViking native session lifecycle as the primary write path:

- `POST /api/v1/sessions` to create/reuse session IDs per `(channel, senderId, agentId)` mapping
- `POST /api/v1/sessions/{id}/messages` for `user` and `assistant` turns
- `POST /api/v1/sessions/{id}/commit` when reset/session-end is consumed

Setup integration:

- `tinyclaw setup` now prompts whether to enable OpenViking memory
- if enabled, setup can install OpenViking CLI and generate `~/.openviking/ov.conf` (includes LLM API key for OpenViking internals)
- `tinyclaw start` auto-starts OpenViking server (when enabled + auto_start) and exports OpenViking env vars for channel/queue processes
- OpenViking runtime data is stored under TinyClaw workspace `./data` (relative to the TinyClaw repo root)
- on startup, TinyClaw checks vectordb dimension compatibility and auto-backs up/rebuilds `./data` when mismatch is detected

Feature flags:

- `TINYCLAW_OPENVIKING_SESSION_NATIVE=1` enable native session write path
- `TINYCLAW_OPENVIKING_AUTOSYNC=0` disable legacy markdown sync fallback (`active.md`/`closed/*.md`)
- `TINYCLAW_OPENVIKING_CONTEXT_PLUGIN=0` disable the built-in OpenViking context plugin entirely

Legacy markdown sync remains as a compatibility fallback.

### Pre-Prompt Retrieval (OpenViking)

Before invoking the model for an external user turn, TinyClaw can prefetch related context via:

- `POST /api/v1/search/search` (native, typed `memories/resources/skills`, optionally scoped with `session_id`)
- legacy fallback (`find-uris` + `read` on `active.md` and archived sessions) when native search is disabled or misses

Environment flags:

- `TINYCLAW_OPENVIKING_PREFETCH=0` disable pre-prompt retrieval
- `TINYCLAW_OPENVIKING_SEARCH_NATIVE=1` enable native search as primary prefetch path
- `TINYCLAW_OPENVIKING_PREFETCH_GATE_MODE` prefetch gate mode: `always | never | rule | rule_then_llm` (default: `rule`)
- `TINYCLAW_OPENVIKING_PREFETCH_FORCE_PATTERNS` comma-separated force patterns (match => force prefetch)
- `TINYCLAW_OPENVIKING_PREFETCH_SKIP_PATTERNS` comma-separated skip patterns (match => skip prefetch)
- `TINYCLAW_OPENVIKING_PREFETCH_RULE_THRESHOLD` score threshold for rule gate (default: `3`)
- `TINYCLAW_OPENVIKING_PREFETCH_LLM_AMBIGUITY_LOW` lower score bound that is considered ambiguous for `rule_then_llm` (default: `1`)
- `TINYCLAW_OPENVIKING_PREFETCH_LLM_AMBIGUITY_HIGH` upper score bound that is considered ambiguous for `rule_then_llm` (default: `2`)
- `TINYCLAW_OPENVIKING_PREFETCH_LLM_TIMEOUT_MS` LLM gate timeout in milliseconds (default: `1500`, timeout => no prefetch)
- `TINYCLAW_OPENVIKING_PREFETCH_TIMEOUT_MS` prefetch/search timeout (default: `5000`)
- `TINYCLAW_OPENVIKING_COMMIT_TIMEOUT_MS` native session commit timeout (default: `30000`)
- `TINYCLAW_OPENVIKING_PREFETCH_MAX_CHARS` max injected chars (default: `1200`)
- `TINYCLAW_OPENVIKING_PREFETCH_MAX_TURNS` max selected turns (default: `4`)
- `TINYCLAW_OPENVIKING_PREFETCH_MAX_HITS` max typed native hits injected (default: `8`)
- `TINYCLAW_OPENVIKING_PREFETCH_RESOURCE_SUPPLEMENT_MAX` max resource supplements when memory-first selection is enabled (default: `2`)
- `TINYCLAW_OPENVIKING_CLOSED_SESSION_RETENTION_DAYS` closed session retention days (`0` means keep forever; default: `0`)
- `TINYCLAW_OPENVIKING_SEARCH_SCORE_THRESHOLD` optional native score threshold passed to OpenViking search API

`settings.openviking` also supports the same gate keys:
`prefetch_gate_mode`, `prefetch_force_patterns`, `prefetch_skip_patterns`,
`prefetch_rule_threshold`, `prefetch_llm_ambiguity_low`,
`prefetch_llm_ambiguity_high`, `prefetch_llm_timeout_ms`.

### In-Chat Commands

These commands work in Discord, Telegram, and WhatsApp:

| Command             | Description                          | Example                 |
| ------------------- | ------------------------------------ | ----------------------- |
| `@agent_id message` | Route message to specific agent      | `@coder fix the bug`    |
| `@team_id message`  | Route message to team leader         | `@dev fix the auth bug` |
| `/agent`            | List all available agents            | `/agent`                |
| `/team`             | List all available teams             | `/team`                 |
| `@agent_id /reset`  | Reset specific agent conversation    | `@coder /reset`         |
| `/reset`            | Reset conversation (WhatsApp/global) | `/reset` or `!reset`    |
| `message`           | Send to default agent (no prefix)    | `help me with this`     |

**Note:** The `@agent_id` routing prefix requires a space after it (e.g., `@coder fix` not `@coderfix`).

**Access control note:** before routing, channel clients apply sender pairing allowlist checks.

## 🤖 Using Agents

### Routing Messages

Use `@agent_id` prefix to route messages to specific agents (see [In-Chat Commands](#in-chat-commands) table above):

```
@coder fix the authentication bug
@writer document the API endpoints
@researcher find papers on transformers
help me with this  ← goes to default agent (no prefix needed)
```

### Agent Configuration

Agents are configured in `.tinyclaw/settings.json`:

```json
{
  "workspace": {
    "path": "/Users/me/tinyclaw-workspace",
    "name": "tinyclaw-workspace"
  },
  "agents": {
    "coder": {
      "name": "Code Assistant",
      "provider": "anthropic",
      "model": "sonnet",
      "working_directory": "/Users/me/tinyclaw-workspace/coder"
    },
    "writer": {
      "name": "Technical Writer",
      "provider": "openai",
      "model": "gpt-5.3-codex",
      "working_directory": "/Users/me/tinyclaw-workspace/writer"
    }
  }
}
```

Each agent operates in isolation:

- **Separate workspace directory** - `~/tinyclaw-workspace/{agent_id}/`
- **Own conversation history** - Maintained by CLI
- **Custom configuration** - `.claude/`, `heartbeat.md` (root), `AGENTS.md`
- **Independent resets** - Reset individual agent conversations

<details>
<summary><b>📖 Learn more about agents</b></summary>

See [docs/AGENTS.md](docs/AGENTS.md) for:

- Architecture details
- Agent configuration
- Use cases and examples
- Advanced features
- Troubleshooting

</details>

## 📐 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Message Channels                         │
│         (Discord, Telegram, WhatsApp, Web, API)             │
└────────────────────┬────────────────────────────────────────┘
                     │ enqueueMessage()
                     ↓
┌─────────────────────────────────────────────────────────────┐
│               ~/.tinyclaw/tinyclaw.db (SQLite)               │
│                                                              │
│  messages: pending → processing → completed / dead          │
│  responses: pending → acked                                  │
│                                                              │
└────────────────────┬────────────────────────────────────────┘
                     │ Queue Processor
                     ↓
┌─────────────────────────────────────────────────────────────┐
│              Parallel Processing by Agent                    │
│                                                              │
│  Agent: coder        Agent: writer       Agent: assistant   │
│  ┌──────────┐       ┌──────────┐        ┌──────────┐       │
│  │ Message 1│       │ Message 1│        │ Message 1│       │
│  │ Message 2│ ...   │ Message 2│  ...   │ Message 2│ ...   │
│  │ Message 3│       │          │        │          │       │
│  └────┬─────┘       └────┬─────┘        └────┬─────┘       │
│       │                  │                     │            │
└───────┼──────────────────┼─────────────────────┼────────────┘
        ↓                  ↓                     ↓
   claude CLI         claude CLI             claude CLI
  (workspace/coder)  (workspace/writer)  (workspace/assistant)
```

**Key features:**

- **SQLite queue** - Atomic transactions via WAL mode, no race conditions
- **Parallel agents** - Different agents process messages concurrently
- **Sequential per agent** - Preserves conversation order within each agent
- **Retry & dead-letter** - Failed messages retry up to 5 times, then enter dead-letter queue
- **Isolated workspaces** - Each agent has its own directory and context

<details>
<summary><b>📖 Learn more about the queue system</b></summary>

See [docs/QUEUE.md](docs/QUEUE.md) for:

- Detailed message flow
- Parallel processing explanation
- Performance characteristics
- Debugging tips

</details>

## 📁 Directory Structure

```
tinyclaw/
├── .tinyclaw/            # TinyClaw data
│   ├── settings.json     # Configuration
│   ├── queue/            # Message queue
│   │   ├── incoming/
│   │   ├── processing/
│   │   └── outgoing/
│   ├── logs/             # All logs
│   ├── channels/         # Channel state
│   ├── files/            # Uploaded files
│   ├── pairing.json      # Sender allowlist state (pending + approved)
│   ├── chats/            # Team chain chat history
│   │   └── {team_id}/    # Per-team chat logs
│   ├── events/           # Real-time event files
│   ├── .claude/          # Template for agents
│   ├── heartbeat.md      # Template for agents
│   └── AGENTS.md         # Template for agents
├── ~/tinyclaw-workspace/ # Agent workspaces
│   ├── coder/
│   │   ├── .claude/
│   │   ├── heartbeat.md
│   │   └── AGENTS.md
│   ├── writer/
│   └── assistant/
├── src/                  # TypeScript sources
├── dist/                 # Compiled output
├── lib/                  # Runtime scripts
├── scripts/              # Installation scripts
├── tinyoffice/           # TinyOffice web portal (Next.js)
└── tinyclaw.sh           # Main script
```

## ⚙️ Configuration

### Settings File

Located at `.tinyclaw/settings.json`:

```json
{
  "channels": {
    "enabled": ["discord", "telegram", "whatsapp"],
    "discord": { "bot_token": "..." },
    "telegram": { "bot_token": "..." },
    "whatsapp": {}
  },
  "workspace": {
    "path": "/Users/me/tinyclaw-workspace",
    "name": "tinyclaw-workspace"
  },
  "agents": {
    "assistant": {
      "name": "Assistant",
      "provider": "anthropic",
      "model": "sonnet",
      "working_directory": "/Users/me/tinyclaw-workspace/assistant"
    }
  },
  "teams": {
    "dev": {
      "name": "Development Team",
      "agents": ["coder", "reviewer"],
      "leader_agent": "coder"
    }
  },
  "monitoring": {
    "heartbeat_interval": 3600
  }
}
```

### Heartbeat Configuration

Edit agent-specific heartbeat prompts:

```bash
# Edit heartbeat for specific agent
nano ~/tinyclaw-workspace/coder/heartbeat.md
```

Default heartbeat prompt:

```markdown
Check for:

1. Pending tasks
2. Errors
3. Unread messages

Take action if needed.
```

## 🎯 Use Cases

### Personal AI Assistant

```
You: "Remind me to call mom"
Claude: "I'll remind you!"
[1 hour later via heartbeat]
Claude: "Don't forget to call mom!"
```

### Multi-Agent Workflow

```
@coder Review and fix bugs in auth.ts
@writer Document the changes
@reviewer Check the documentation quality
```

### Team Collaboration

```
@dev fix the auth bug
# → Routes to team leader (@coder)
# → Coder fixes bug, mentions @reviewer in response
# → Reviewer automatically invoked, reviews changes
# → Combined response sent back to user
```

Teams support sequential chains (single handoff) and parallel fan-out (multiple teammate mentions). See [docs/TEAMS.md](docs/TEAMS.md) for details.

### Cross-Device Access

- WhatsApp on phone
- Discord on desktop
- Telegram anywhere
- CLI for automation

All channels share agent conversations!

## 📚 Documentation

- [AGENTS.md](docs/AGENTS.md) - Agent management and routing
- [TEAMS.md](docs/TEAMS.md) - Team collaboration, chain execution, and visualizer
- [QUEUE.md](docs/QUEUE.md) - Queue system and message flow
- [tinyoffice/README.md](tinyoffice/README.md) - TinyOffice web portal
- [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) - Common issues and solutions

## 🐛 Troubleshooting

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for detailed solutions.

**Quick fixes:**

```bash
# Reset everything (preserves settings)
tinyclaw stop && rm -rf .tinyclaw/queue/* && tinyclaw start

# Reset WhatsApp
tinyclaw channels reset whatsapp

# Check status
tinyclaw status

# View logs
tinyclaw logs all
```

**Common issues:**

- Bash version error → Install bash 4.0+: `brew install bash`
- WhatsApp not connecting → Reset auth: `tinyclaw channels reset whatsapp`
- Messages stuck → Clear queue: `rm -rf .tinyclaw/queue/processing/*`
- Agent not found → Check: `tinyclaw agent list`
- Corrupted settings.json → TinyClaw auto-repairs invalid JSON (trailing commas, comments, BOM) and creates a `.bak` backup

**Need help?**

- [GitHub Issues](https://github.com/TinyAGI/tinyclaw/issues)
- Check logs: `tinyclaw logs all`

## 🙏 Credits

- Inspired by [OpenClaw](https://openclaw.ai/) by Peter Steinberger
- Built on [Claude Code](https://claude.com/claude-code) and [Codex CLI](https://docs.openai.com/codex)
- Uses [discord.js](https://discord.js.org/), [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js), [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)

## 📄 License

MIT

---

**TinyClaw - Tiny but mighty!** 🦞✨

[![Star History Chart](https://api.star-history.com/svg?repos=TinyAGI/tinyclaw&type=date&legend=top-left)](https://www.star-history.com/#TinyAGI/tinyclaw&type=date&legend=top-left)
