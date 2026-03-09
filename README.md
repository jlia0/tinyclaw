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
- ✅ **Team chat rooms** - Persistent async chat rooms per team with real-time CLI viewer
- ✅ **Multiple AI providers** - Anthropic Claude, OpenAI Codex, and custom providers (any OpenAI/Anthropic-compatible endpoint)
- ✅ **Auth token management** - Store API keys per provider, no separate CLI auth needed
- ✅ **Parallel processing** - Agents process messages concurrently
- ✅ **Live TUI dashboard** - Real-time team visualizer and chatroom viewer
- ✅ **Persistent sessions** - Conversation context maintained across restarts
- ✅ **SQLite queue** - Atomic transactions, retry logic, dead-letter management
- ✅ **Plugin system** - Extend TinyClaw with custom plugins for message hooks and event listeners
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

### Installation

**Option 1: One-line Install (Recommended)**

```bash
curl -fsSL https://raw.githubusercontent.com/TinyAGI/tinyclaw/main/scripts/remote-install.sh | bash
```

<details>
<summary><b>Other installation methods</b></summary>

**From Release:**

```bash
wget https://github.com/TinyAGI/tinyclaw/releases/latest/download/tinyclaw-bundle.tar.gz
tar -xzf tinyclaw-bundle.tar.gz
cd tinyclaw && ./scripts/install.sh
```

**From Source:**

```bash
git clone https://github.com/TinyAGI/tinyclaw.git
cd tinyclaw && npm install && ./scripts/install.sh
```

</details>

### First Run

```bash
tinyclaw start  # Runs interactive setup wizard
```

The setup wizard will guide you through channel selection, bot tokens, workspace setup, default agent, AI provider, model selection, and heartbeat interval.

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

TinyClaw includes `tinyoffice/`, a Next.js web portal for operating TinyClaw from the browser.

<div align="center">
  <img src="./docs/images/tinyoffice.png" alt="TinyOffice Office View" width="700" />
</div>

<details>
<summary><b>TinyOffice Features & Setup</b></summary>

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

</details>

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

| Command                               | Description                     | Example                                                      |
| ------------------------------------- | ------------------------------- | ------------------------------------------------------------ |
| `agent list`                          | List all configured agents      | `tinyclaw agent list`                                        |
| `agent add`                           | Add new agent (interactive)     | `tinyclaw agent add`                                         |
| `agent show <id>`                     | Show agent configuration        | `tinyclaw agent show coder`                                  |
| `agent remove <id>`                   | Remove an agent                 | `tinyclaw agent remove coder`                                |
| `agent reset <id>`                    | Reset agent conversation        | `tinyclaw agent reset coder`                                 |
| `agent provider <id> [provider]`      | Show or set agent's AI provider | `tinyclaw agent provider coder anthropic`                    |
| `agent provider <id> <p> --model <m>` | Set agent's provider and model  | `tinyclaw agent provider coder openai --model gpt-5.3-codex` |

### Team Commands

| Command                     | Description                        | Example                                   |
| --------------------------- | ---------------------------------- | ----------------------------------------- |
| `team list`                 | List all configured teams          | `tinyclaw team list`                      |
| `team add`                  | Add new team (interactive)         | `tinyclaw team add`                       |
| `team show <id>`            | Show team configuration            | `tinyclaw team show dev`                  |
| `team remove <id>`          | Remove a team                      | `tinyclaw team remove dev`                |
| `team add-agent <t> <a>`    | Add an existing agent to a team    | `tinyclaw team add-agent dev reviewer`    |
| `team remove-agent <t> <a>` | Remove an agent from a team        | `tinyclaw team remove-agent dev reviewer` |
| `team visualize [id]`       | Live TUI dashboard for team chains | `tinyclaw team visualize dev`             |

### Chatroom Commands

| Command             | Description                                   | Example                    |
| ------------------- | --------------------------------------------- | -------------------------- |
| `chatroom <team>`   | Real-time TUI viewer with type-to-send        | `tinyclaw chatroom dev`    |

Every team has a persistent chat room. Agents post to it using `[#team_id: message]` tags, and messages are broadcast to all teammates. The chatroom viewer polls for new messages in real time — type a message and press Enter to post, or press `q`/Esc to quit.

**API endpoints:**

```
GET  /api/chatroom/:teamId          # Get messages (?limit=100&since=0)
POST /api/chatroom/:teamId          # Post a message (body: { "message": "..." })
```

### Provider & Custom Provider Commands

| Command                                       | Description                                              | Example                                          |
| --------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------ |
| `provider [name]`                             | Show or switch global AI provider                        | `tinyclaw provider anthropic`                    |
| `provider <name> --model <model>`             | Switch provider and model; propagates to matching agents | `tinyclaw provider openai --model gpt-5.3-codex` |
| `provider <name> --auth-token <key>`          | Store API key for a built-in provider                    | `tinyclaw provider anthropic --auth-token sk-...` |
| `provider list`                               | List all custom providers                                | `tinyclaw provider list`                         |
| `provider add`                                | Add a new custom provider (interactive)                  | `tinyclaw provider add`                          |
| `provider remove <id>`                        | Remove a custom provider                                 | `tinyclaw provider remove proxy`                 |
| `model [name]`                                | Show or switch AI model                                  | `tinyclaw model opus`                            |

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
      "model": "claude-sonnet-4-5"
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
tinyclaw agent provider coder custom:my-proxy
tinyclaw agent provider coder custom:my-proxy --model gpt-4o
```

**Auth token storage** — store API keys for built-in providers so you don't need separate CLI auth:

```bash
tinyclaw provider anthropic --auth-token sk-ant-...
tinyclaw provider openai --auth-token sk-...
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
| `pairing pending`                      | Show pending sender approvals (with pairing codes) | `tinyclaw pairing pending`                 |
| `pairing approved`                     | Show approved senders                              | `tinyclaw pairing approved`                |
| `pairing list`                         | Show both pending and approved senders             | `tinyclaw pairing list`                    |
| `pairing approve <code>`               | Move a sender from pending to approved by code     | `tinyclaw pairing approve ABCD1234`        |
| `pairing unpair <channel> <sender_id>` | Remove an approved sender from the allowlist       | `tinyclaw pairing unpair telegram 1234567` |

Pairing behavior:

- First message from unknown sender: TinyClaw generates a code and sends approval instructions.
- Additional messages while still pending: TinyClaw blocks silently (no repeated pairing message).
- After approval: messages from that sender are processed normally.

</details>

<details>
<summary><b>Messaging & in-chat commands</b></summary>

| Command          | Description                 | Example                          |
| ---------------- | --------------------------- | -------------------------------- |
| `send <message>` | Send message to AI manually | `tinyclaw send "Hello!"`         |
| `send <message>` | Route to specific agent     | `tinyclaw send "@coder fix bug"` |

These commands work in Discord, Telegram, and WhatsApp:

| Command             | Description                          | Example                 |
| ------------------- | ------------------------------------ | ----------------------- |
| `@agent_id message` | Route message to specific agent      | `@coder fix the bug`    |
| `@team_id message`  | Route message to team leader         | `@dev fix the auth bug` |
| `/agent`            | List all available agents            | `/agent`                |
| `/team`             | List all available teams             | `/team`                 |
| `@agent_id /reset`  | Reset specific agent conversation    | `@coder /reset`         |
| `/reset`            | Reset conversation (WhatsApp/global) | `/reset` or `!reset`    |
| `/restart`          | Restart TinyClaw process             | `/restart`              |
| `message`           | Send to default agent (no prefix)    | `help me with this`     |

**Note:** The `@agent_id` routing prefix requires a space after it (e.g., `@coder fix` not `@coderfix`).

**Access control note:** before routing, channel clients apply sender pairing allowlist checks.

</details>

<details>
<summary><b>Update commands</b></summary>

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

**Auto-detection:** TinyClaw checks for updates on startup (once per hour).

**Disable update checks:**

```bash
export TINYCLAW_SKIP_UPDATE_CHECK=1
```

</details>

<details>
<summary><b>Configuration commands</b></summary>

| Command                  | Description                  | Example                          |
| ------------------------ | ---------------------------- | -------------------------------- |
| `reset`                  | Reset all conversations      | `tinyclaw reset`                 |
| `channels reset <chan>`  | Reset channel authentication | `tinyclaw channels reset whatsapp` |

</details>

## 🤖 Using Agents

Use `@agent_id` prefix to route messages to specific agents:

```text
@coder fix the authentication bug
@writer document the API endpoints
help me with this  ← goes to default agent (no prefix needed)
```

<details>
<summary><b>Agent configuration</b></summary>

Agents are configured in `.tinyclaw/settings.json`:

```json
{
  "agents": {
    "coder": {
      "name": "Code Assistant",
      "provider": "anthropic",
      "model": "sonnet",
      "working_directory": "/Users/me/tinyclaw-workspace/coder"
    },
    "writer": {
      "name": "Technical Writer",
      "provider": "custom:my-proxy",
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
  "custom_providers": {
    "my-proxy": {
      "name": "My Proxy",
      "harness": "claude",
      "base_url": "https://proxy.example.com/v1",
      "api_key": "sk-...",
      "model": "claude-sonnet-4-5"
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

</details>

<details>
<summary><b>Directory structure</b></summary>

```text
tinyclaw/
├── .tinyclaw/            # TinyClaw data
│   ├── settings.json     # Configuration
│   ├── queue/            # Message queue
│   ├── logs/             # All logs
│   ├── channels/         # Channel state
│   ├── files/            # Uploaded files
│   ├── pairing.json      # Sender allowlist state
│   ├── chats/            # Team chat room history
│   │   └── {team_id}/    # Per-team chat logs
│   ├── events/           # Real-time event files
│   ├── .claude/          # Template for agents
│   ├── heartbeat.md      # Template for agents
│   └── AGENTS.md         # Template for agents
├── ~/tinyclaw-workspace/ # Agent workspaces
│   ├── coder/
│   ├── writer/
│   └── assistant/
├── src/                  # TypeScript sources
├── dist/                 # Compiled output
├── lib/                  # Runtime scripts
├── scripts/              # Installation scripts
├── tinyoffice/           # TinyOffice web portal (Next.js)
└── tinyclaw.sh           # Main script
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
tinyclaw stop && rm -rf .tinyclaw/queue/* && tinyclaw start

# Reset WhatsApp
tinyclaw channels reset whatsapp

# Check status
tinyclaw status

# View logs
tinyclaw logs all
```

**Common issues:**

- WhatsApp not connecting → Reset auth: `tinyclaw channels reset whatsapp`
- Messages stuck → Clear queue: `rm -rf .tinyclaw/queue/processing/*`
- Agent not found → Check: `tinyclaw agent list`
- Corrupted settings.json → TinyClaw auto-repairs invalid JSON (trailing commas, comments, BOM) and creates a `.bak` backup

</details>

**Need help?** [GitHub Issues](https://github.com/TinyAGI/tinyclaw/issues) · `tinyclaw logs all`

## 🙏 Credits

- Inspired by [OpenClaw](https://openclaw.ai/) by Peter Steinberger
- Built on [Claude Code](https://claude.com/claude-code) and [Codex CLI](https://docs.openai.com/codex)
- Uses [discord.js](https://discord.js.org/), [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js), [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)

## 📄 License

MIT

---

**TinyClaw - Tiny but mighty!** 🦞✨

[![Star History Chart](https://api.star-history.com/svg?repos=TinyAGI/tinyclaw&type=date&legend=top-left)](https://www.star-history.com/#TinyAGI/tinyclaw&type=date&legend=top-left)
