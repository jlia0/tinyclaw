<div align="center">
  <img src="./docs/images/tinyagi.png" alt="TinyAGI" width="600" />
  <h1>TinyAGI 🦞</h1>
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
    <a href="https://github.com/TinyAGI/tinyagi/releases/latest">
      <img src="https://img.shields.io/github/v/release/TinyAGI/tinyagi?label=Latest&color=green" alt="Latest Release" />
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
- ✅ **Team chat rooms** - Persistent async chat rooms per team with real-time CLI viewer
- ✅ **Multiple AI providers** - Anthropic Claude, OpenAI Codex, and custom providers (any OpenAI/Anthropic-compatible endpoint)
- ✅ **Auth token management** - Store API keys per provider, no separate CLI auth needed
- ✅ **Parallel processing** - Agents process messages concurrently
- ✅ **Live TUI dashboard** - Real-time team visualizer and chatroom viewer
- ✅ **Persistent sessions** - Conversation context maintained across restarts
- ✅ **SQLite queue** - Atomic transactions, retry logic, dead-letter management
- ✅ **Plugin system** - Extend TinyAGI with custom plugins for message hooks and event listeners
- ✅ **24/7 operation** - Runs in tmux for always-on availability

## Community

[Discord](https://discord.com/invite/jH6AcEChuD)

We are actively looking for contributors. Please reach out.

## 🚀 Quick Start

### Prerequisites

- macOS, Linux and Windows (WSL2)
- Node.js v18+
- tmux, jq
- Bash 3.2+
- [Claude Code CLI](https://claude.com/claude-code) (for Anthropic provider)
- [Codex CLI](https://docs.openai.com/codex) (for OpenAI provider)

### Installation & First Run

```bash
curl -fsSL https://raw.githubusercontent.com/TinyAGI/tinyagi/main/scripts/install.sh | bash
```

This downloads and installs the `tinyagi` command globally. Then just run:

```bash
tinyagi
```

That's it. TinyAGI auto-creates default settings, starts the daemon, and opens TinyOffice in your browser. No wizard, no configuration needed.

- **Default workspace:** `~/tinyagi-workspace`
- **Default agent:** `tinyagi` (Anthropic/Opus)
- **Channels:** none initially — add later with `tinyagi channel setup`

<details>
<summary><b>Other installation methods</b></summary>

**From Source:**

```bash
git clone https://github.com/TinyAGI/tinyagi.git
cd tinyagi && npm install && ./scripts/install.sh
```

</details>

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

After starting TinyAGI, scan the QR code:

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     WhatsApp QR Code
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[QR CODE HERE]

📱 Settings → Linked Devices → Link a Device
```

</details>

---

## 🌐 TinyOffice Web Portal

TinyAGI includes a web portal for managing your agents, teams, tasks, and chat — all from the browser.

<div align="center">
  <img src="./docs/images/tinyoffice.png" alt="TinyOffice Office View" width="700" />
</div>

Once you start running TinyAGI locally, you can control it by visiting **[office.tinyagicompany.com](https://office.tinyagicompany.com/)**. It connects to your local TinyAGI API at `localhost:3777` — no account or sign-up needed.

Alternatively, you can run TinyOffice locally:

```bash
tinyagi office  # Builds and starts on http://localhost:3000
```

<details>
<summary><b>TinyOffice Features & Setup</b></summary>

- **Dashboard** - Real-time queue/system overview and live event feed
- **Chat Console** - Send messages to default agent, `@agent`, or `@team`
- **Agents & Teams** - Create, edit, and remove agents/teams
- **Tasks (Kanban)** - Create tasks, drag across stages, assign to agent/team
- **Logs & Events** - Inspect queue logs and streaming events
- **Settings** - Edit TinyAGI configuration (`settings.json`) via UI
- **Office View** - Visual simulation of agent interactions
- **Org Chart** - Hierarchical visualization of teams and agents
- **Chat Rooms** - Slack-style persistent chat rooms per team
- **Projects** - Project-level task management with filtered kanban boards

### Running Locally

Start TinyAGI first (API default: `http://localhost:3777`), then:

```bash
tinyagi office
```

This auto-detects when dependencies or builds are needed (e.g. after `tinyagi update`) and starts the production server on `http://localhost:3000`.

For development with hot-reload:

```bash
cd tinyoffice
npm install
npm run dev
```

If TinyAGI API is on a different host/port, set:

```bash
cd tinyoffice
echo 'NEXT_PUBLIC_API_URL=http://localhost:3777' > .env.local
```

</details>

## 📋 Commands

Commands work with the `tinyagi` CLI.

### Core Commands

| Command       | Description                                               | Example               |
| ------------- | --------------------------------------------------------- | --------------------- |
| *(no command)* | Install, configure defaults, start, and open TinyOffice  | `tinyagi`            |
| `start`       | Start TinyAGI daemon                                     | `tinyagi start`      |
| `stop`        | Stop all processes                                        | `tinyagi stop`       |
| `restart`     | Restart TinyAGI                                          | `tinyagi restart`    |
| `status`      | Show current status and activity                          | `tinyagi status`     |
| `channel setup` | Configure channels interactively                        | `tinyagi channel setup` |
| `logs [type]` | View logs (discord/telegram/whatsapp/queue/heartbeat/all) | `tinyagi logs queue` |
| `attach`      | Attach to tmux session                                    | `tinyagi attach`     |

### Agent Commands

| Command                               | Description                     | Example                                                      |
| ------------------------------------- | ------------------------------- | ------------------------------------------------------------ |
| `agent list`                          | List all configured agents      | `tinyagi agent list`                                        |
| `agent add`                           | Add new agent (interactive)     | `tinyagi agent add`                                         |
| `agent show <id>`                     | Show agent configuration        | `tinyagi agent show coder`                                  |
| `agent remove <id>`                   | Remove an agent                 | `tinyagi agent remove coder`                                |
| `agent reset <id>`                    | Reset agent conversation        | `tinyagi agent reset coder`                                 |
| `agent provider <id> [provider]`      | Show or set agent's AI provider | `tinyagi agent provider coder anthropic`                    |
| `agent provider <id> <p> --model <m>` | Set agent's provider and model  | `tinyagi agent provider coder openai --model gpt-5.3-codex` |

### Team Commands

| Command                     | Description                        | Example                                   |
| --------------------------- | ---------------------------------- | ----------------------------------------- |
| `team list`                 | List all configured teams          | `tinyagi team list`                      |
| `team add`                  | Add new team (interactive)         | `tinyagi team add`                       |
| `team show <id>`            | Show team configuration            | `tinyagi team show dev`                  |
| `team remove <id>`          | Remove a team                      | `tinyagi team remove dev`                |
| `team add-agent <t> <a>`    | Add an existing agent to a team    | `tinyagi team add-agent dev reviewer`    |
| `team remove-agent <t> <a>` | Remove an agent from a team        | `tinyagi team remove-agent dev reviewer` |
| `team visualize [id]`       | Live TUI dashboard for team chains | `tinyagi team visualize dev`             |

### Chatroom Commands

| Command             | Description                                   | Example                    |
| ------------------- | --------------------------------------------- | -------------------------- |
| `chatroom <team>`   | Real-time TUI viewer with type-to-send        | `tinyagi chatroom dev`    |
| `office`            | Start TinyOffice web portal on port 3000      | `tinyagi office`          |

Every team has a persistent chat room. Agents post to it using `[#team_id: message]` tags, and messages are broadcast to all teammates. The chatroom viewer polls for new messages in real time — type a message and press Enter to post, or press `q`/Esc to quit.

**API endpoints:**

```
GET  /api/chatroom/:teamId          # Get messages (?limit=100&since=0)
POST /api/chatroom/:teamId          # Post a message (body: { "message": "..." })
```

### Provider & Custom Provider Commands

| Command                                       | Description                                              | Example                                          |
| --------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------ |
| `provider [name]`                             | Show or switch global AI provider                        | `tinyagi provider anthropic`                    |
| `provider <name> --model <model>`             | Switch provider and model; propagates to matching agents | `tinyagi provider openai --model gpt-5.3-codex` |
| `provider <name> --auth-token <key>`          | Store API key for a built-in provider                    | `tinyagi provider anthropic --auth-token sk-...` |
| `provider list`                               | List all custom providers                                | `tinyagi provider list`                         |
| `provider add`                                | Add a new custom provider (interactive)                  | `tinyagi provider add`                          |
| `provider remove <id>`                        | Remove a custom provider                                 | `tinyagi provider remove proxy`                 |
| `model [name]`                                | Show or switch AI model                                  | `tinyagi model opus`                            |

<details>
<summary><b>Custom provider details</b></summary>

Custom providers let you use any OpenAI or Anthropic-compatible API endpoint (e.g., OpenRouter, proxy servers, self-hosted models).

**Define a custom provider in `settings.json`:**

```json
{
  "custom_providers": {
    "my-proxy": {
      "name": "My Proxy",
      "harness": "claude",
      "base_url": "https://proxy.example.com/v1",
      "api_key": "sk-...",
      "model": "claude-sonnet-4-6"
    }
  }
}
```

| Field      | Required | Description                          |
| ---------- | -------- | ------------------------------------ |
| `name`     | Yes      | Human-readable display name          |
| `harness`  | Yes      | CLI to use: `claude` or `codex`      |
| `base_url` | Yes      | API endpoint URL                     |
| `api_key`  | Yes      | API key for authentication           |
| `model`    | No       | Default model name for CLI           |

**Assign a custom provider to an agent:**

```bash
tinyagi agent provider coder custom:my-proxy
tinyagi agent provider coder custom:my-proxy --model gpt-4o
```

**Auth token storage** — store API keys for built-in providers so you don't need separate CLI auth:

```bash
tinyagi provider anthropic --auth-token sk-ant-...
tinyagi provider openai --auth-token sk-...
```

Tokens are saved in `settings.json` under `models.<provider>.auth_token` and automatically exported as `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` when invoking CLIs.

**API endpoints:**

```
GET    /api/custom-providers              # List custom providers
PUT    /api/custom-providers/:id          # Create or update
DELETE /api/custom-providers/:id          # Delete
```

See [docs/AGENTS.md](docs/AGENTS.md#custom-providers) for more details.

</details>

<details>
<summary><b>Pairing commands</b></summary>

Use sender pairing to control who can message your agents.

| Command                                | Description                                        | Example                                    |
| -------------------------------------- | -------------------------------------------------- | ------------------------------------------ |
| `pairing pending`                      | Show pending sender approvals (with pairing codes) | `tinyagi pairing pending`                 |
| `pairing approved`                     | Show approved senders                              | `tinyagi pairing approved`                |
| `pairing list`                         | Show both pending and approved senders             | `tinyagi pairing list`                    |
| `pairing approve <code>`               | Move a sender from pending to approved by code     | `tinyagi pairing approve ABCD1234`        |
| `pairing unpair <channel> <sender_id>` | Remove an approved sender from the allowlist       | `tinyagi pairing unpair telegram 1234567` |

Pairing behavior:

- First message from unknown sender: TinyAGI generates a code and sends approval instructions.
- Additional messages while still pending: TinyAGI blocks silently (no repeated pairing message).
- After approval: messages from that sender are processed normally.

</details>

<details>
<summary><b>Messaging & in-chat commands</b></summary>

| Command          | Description                 | Example                          |
| ---------------- | --------------------------- | -------------------------------- |
| `send <message>` | Send message to AI manually | `tinyagi send "Hello!"`         |
| `send <message>` | Route to specific agent     | `tinyagi send "@coder fix bug"` |

These commands work in Discord, Telegram, and WhatsApp:

| Command             | Description                          | Example                 |
| ------------------- | ------------------------------------ | ----------------------- |
| `@agent_id message` | Route message to specific agent      | `@coder fix the bug`    |
| `@team_id message`  | Route message to team leader         | `@dev fix the auth bug` |
| `/agent`            | List all available agents            | `/agent`                |
| `/team`             | List all available teams             | `/team`                 |
| `@agent_id /reset`  | Reset specific agent conversation    | `@coder /reset`         |
| `/reset`            | Reset conversation (WhatsApp/global) | `/reset` or `!reset`    |
| `/restart`          | Restart TinyAGI process             | `/restart`              |
| `message`           | Send to default agent (no prefix)    | `help me with this`     |

**Note:** The `@agent_id` routing prefix requires a space after it (e.g., `@coder fix` not `@coderfix`).

**Access control note:** before routing, channel clients apply sender pairing allowlist checks.

</details>

<details>
<summary><b>Update commands</b></summary>

| Command  | Description                       | Example           |
| -------- | --------------------------------- | ----------------- |
| `update` | Update TinyAGI to latest version | `tinyagi update` |

> **Note:** If you are on v0.0.1 or v0.0.2, the update script was broken. Please re-install instead:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/TinyAGI/tinyagi/main/scripts/install.sh | bash
> ```
>
> Your settings and user data will be preserved.

**Auto-detection:** TinyAGI checks for updates on startup (once per hour).

**Disable update checks:**

```bash
export TINYAGI_SKIP_UPDATE_CHECK=1
```

</details>

<details>
<summary><b>Configuration commands</b></summary>

| Command                  | Description                  | Example                          |
| ------------------------ | ---------------------------- | -------------------------------- |
| `reset`                  | Reset all conversations      | `tinyagi reset`                 |
| `channels reset <chan>`  | Reset channel authentication | `tinyagi channels reset whatsapp` |

</details>

## 🤖 Using Agents

Use `@agent_id` prefix to route messages to specific agents:

```text
@coder fix the authentication bug
@writer document the API endpoints
help me with this  ← goes to tinyagi agent (no prefix needed)
```

<details>
<summary><b>Agent configuration</b></summary>

Agents are configured in `.tinyagi/settings.json`:

```json
{
  "agents": {
    "coder": {
      "name": "Code Assistant",
      "provider": "anthropic",
      "model": "sonnet",
      "working_directory": "/Users/me/tinyagi-workspace/coder"
    },
    "writer": {
      "name": "Technical Writer",
      "provider": "custom:my-proxy",
      "model": "gpt-5.3-codex",
      "working_directory": "/Users/me/tinyagi-workspace/writer"
    }
  }
}
```

Each agent operates in isolation:

- **Separate workspace directory** - `~/tinyagi-workspace/{agent_id}/`
- **Own conversation history** - Maintained by CLI
- **Custom configuration** - `.claude/`, `heartbeat.md` (root), `AGENTS.md`
- **Independent resets** - Reset individual agent conversations

See [docs/AGENTS.md](docs/AGENTS.md) for full details on architecture, use cases, and advanced features.

</details>

## 📐 Architecture

<details>
<summary><b>Message flow diagram</b></summary>

```text
┌─────────────────────────────────────────────────────────────┐
│                     Message Channels                         │
│         (Discord, Telegram, WhatsApp, Web, API)             │
└────────────────────┬────────────────────────────────────────┘
                     │ enqueueMessage()
                     ↓
┌─────────────────────────────────────────────────────────────┐
│               ~/.tinyagi/tinyagi.db (SQLite)               │
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

</details>

**Key features:**

- **SQLite queue** - Atomic transactions via WAL mode, no race conditions
- **Parallel agents** - Different agents process messages concurrently
- **Sequential per agent** - Preserves conversation order within each agent
- **Retry & dead-letter** - Failed messages retry up to 5 times, then enter dead-letter queue
- **Isolated workspaces** - Each agent has its own directory and context

See [docs/QUEUE.md](docs/QUEUE.md) for detailed queue system documentation.

## ⚙️ Configuration

<details>
<summary><b>Settings file reference</b></summary>

Located at `.tinyagi/settings.json`:

```json
{
  "channels": {
    "enabled": ["discord", "telegram", "whatsapp"],
    "discord": { "bot_token": "..." },
    "telegram": { "bot_token": "..." },
    "whatsapp": {}
  },
  "workspace": {
    "path": "/Users/me/tinyagi-workspace",
    "name": "tinyagi-workspace"
  },
  "agents": {
    "tinyagi": {
      "name": "TinyAGI Agent",
      "provider": "anthropic",
      "model": "opus",
      "working_directory": "/Users/me/tinyagi-workspace/tinyagi"
    }
  },
  "teams": {
    "dev": {
      "name": "Development Team",
      "agents": ["coder", "reviewer"],
      "leader_agent": "coder"
    }
  },
  "custom_providers": {
    "my-proxy": {
      "name": "My Proxy",
      "harness": "claude",
      "base_url": "https://proxy.example.com/v1",
      "api_key": "sk-...",
      "model": "claude-sonnet-4-6"
    }
  },
  "models": {
    "anthropic": { "auth_token": "sk-ant-..." },
    "openai": { "auth_token": "sk-..." }
  },
  "monitoring": {
    "heartbeat_interval": 3600
  }
}
```

</details>

<details>
<summary><b>Heartbeat configuration</b></summary>

Edit agent-specific heartbeat prompts:

```bash
nano ~/tinyagi-workspace/coder/heartbeat.md
```

Default heartbeat prompt:

```markdown
Check for:

1. Pending tasks
2. Errors
3. Unread messages

Take action if needed.
```

</details>

<details>
<summary><b>Directory structure</b></summary>

```text
tinyagi/
├── packages/                # Monorepo packages
│   ├── core/                #   Shared types, config, queue, agent invocation
│   ├── main/                #   Queue processor entry point
│   ├── teams/               #   Team conversation orchestration
│   ├── server/              #   API server (REST + SSE)
│   ├── channels/            #   Channel clients (Discord, Telegram, WhatsApp)
│   ├── cli/                 #   CLI commands (tinyagi.sh helpers)
│   └── visualizer/          #   TUI dashboard and chatroom viewer
├── tinyoffice/              # TinyOffice web portal (Next.js)
├── .tinyagi/               # TinyAGI data (created at runtime)
│   ├── settings.json        #   Configuration
│   ├── tinyagi.db          #   SQLite queue database
│   ├── logs/                #   All logs
│   ├── channels/            #   Channel state
│   ├── files/               #   Uploaded files
│   ├── pairing.json         #   Sender allowlist state
│   ├── chats/               #   Team conversation history
│   │   └── {team_id}/       #     Per-team chat logs
│   ├── .claude/             #   Template for agents
│   ├── heartbeat.md         #   Template for agents
│   └── AGENTS.md            #   Template for agents
├── ~/tinyagi-workspace/    # Agent workspaces
│   ├── tinyagi/            #   Default agent
│   ├── coder/
│   └── writer/
├── lib/                     # Runtime scripts
├── scripts/                 # Installation scripts
└── tinyagi.sh              # Main script
```

</details>

## 🎯 Use Cases

<details>
<summary><b>Examples</b></summary>

### Personal AI Assistant

```text
You: "Remind me to call mom"
Claude: "I'll remind you!"
[1 hour later via heartbeat]
Claude: "Don't forget to call mom!"
```

### Multi-Agent Workflow

```text
@coder Review and fix bugs in auth.ts
@writer Document the changes
@reviewer Check the documentation quality
```

### Team Collaboration

```text
@dev fix the auth bug
# → Routes to team leader (@coder)
# → Coder fixes bug, mentions @reviewer in response
# → Reviewer automatically invoked, reviews changes
# → Combined response sent back to user
```

Teams support sequential chains (single handoff) and parallel fan-out (multiple teammate mentions). See [docs/TEAMS.md](docs/TEAMS.md) for details.

### Cross-Device Access

- WhatsApp on phone, Discord on desktop, Telegram anywhere, CLI for automation
- All channels share agent conversations!

</details>

## 📚 Documentation

- [AGENTS.md](docs/AGENTS.md) - Agent management, routing, and custom providers
- [TEAMS.md](docs/TEAMS.md) - Team collaboration, chain execution, chat rooms, and visualizer
- [QUEUE.md](docs/QUEUE.md) - Queue system and message flow
- [tinyoffice/README.md](tinyoffice/README.md) - TinyOffice web portal
- [PLUGINS.md](docs/PLUGINS.md) - Plugin development guide
- [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) - Common issues and solutions

## 🐛 Troubleshooting

<details>
<summary><b>Quick fixes & common issues</b></summary>

```bash
# Reset everything (preserves settings)
tinyagi stop && rm -rf .tinyagi/queue/* && tinyagi start

# Reset WhatsApp
tinyagi channels reset whatsapp

# Check status
tinyagi status

# View logs
tinyagi logs all
```

**Common issues:**

- WhatsApp not connecting → Reset auth: `tinyagi channels reset whatsapp`
- Messages stuck → Clear queue: `rm -rf .tinyagi/queue/processing/*`
- Agent not found → Check: `tinyagi agent list`
- Corrupted settings.json → TinyAGI auto-repairs invalid JSON (trailing commas, comments, BOM) and creates a `.bak` backup

</details>

**Need help?** [GitHub Issues](https://github.com/TinyAGI/tinyagi/issues) · `tinyagi logs all`

## 🙏 Credits

- Inspired by [OpenClaw](https://openclaw.ai/) by Peter Steinberger
- Built on [Claude Code](https://claude.com/claude-code) and [Codex CLI](https://docs.openai.com/codex)
- Uses [discord.js](https://discord.js.org/), [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js), [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)

## 📄 License

MIT

---

**TinyAGI - Tiny but mighty!** 🦞✨

[![Star History Chart](https://api.star-history.com/svg?repos=TinyAGI/tinyagi&type=date&legend=top-left)](https://www.star-history.com/#TinyAGI/tinyagi&type=date&legend=top-left)
