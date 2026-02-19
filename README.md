# TinyClaw 🦞

**Multi-agent, multi-channel, 24/7 AI assistant**

Run multiple AI agents simultaneously with isolated workspaces and conversation contexts. Route messages to specialized agents using simple `@agent_id` syntax.

## ✨ Features

- ✅ **Multi-agent** - Run multiple isolated AI agents with specialized roles
- ✅ **Team collaboration** - Agents hand off work to teammates via chain execution and fan-out
- ✅ **Multiple AI providers** - Anthropic Claude (Sonnet/Opus) and OpenAI (GPT/Codex)
- ✅ **Multi-channel** - Discord, WhatsApp, and Telegram
- ✅ **Parallel processing** - Agents process messages concurrently
- ✅ **Live TUI dashboard** - Real-time team visualizer for monitoring agent chains
- ✅ **Persistent sessions** - Conversation context maintained across restarts
- ✅ **File-based queue** - No race conditions, reliable message handling
- ✅ **24/7 operation** - Runs in tmux for always-on availability

## 🚀 Quick Start

### Prerequisites

- macOS or Linux
- Node.js v14+
- tmux
- Bash 4.0+ (macOS: `brew install bash`)
- [Claude Code CLI](https://claude.com/claude-code) (for Anthropic provider)
- [Codex CLI](https://docs.openai.com/codex) (for OpenAI provider)

### Installation

**Option 1: One-line Install (Recommended)**

```bash
curl -fsSL https://raw.githubusercontent.com/jlia0/tinyclaw/main/scripts/remote-install.sh | bash
```

**Option 2: From Release**

```bash
wget https://github.com/jlia0/tinyclaw/releases/latest/download/tinyclaw-bundle.tar.gz
tar -xzf tinyclaw-bundle.tar.gz
cd tinyclaw && ./scripts/install.sh
```

**Option 3: From Source**

```bash
git clone https://github.com/jlia0/tinyclaw.git
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
8. **Memory retrieval (optional)** - Enable/disable QMD-based memory at setup time

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

| Command             | Description                 | Example                       |
| ------------------- | --------------------------- | ----------------------------- |
| `agent list`        | List all configured agents  | `tinyclaw agent list`         |
| `agent add`         | Add new agent (interactive) | `tinyclaw agent add`          |
| `agent show <id>`   | Show agent configuration    | `tinyclaw agent show coder`   |
| `agent remove <id>` | Remove an agent             | `tinyclaw agent remove coder` |
| `agent reset <id>`  | Reset agent conversation    | `tinyclaw agent reset coder`  |

### Team Commands

| Command                  | Description                              | Example                       |
| ------------------------ | ---------------------------------------- | ----------------------------- |
| `team list`              | List all configured teams                | `tinyclaw team list`          |
| `team add`               | Add new team (interactive)               | `tinyclaw team add`           |
| `team show <id>`         | Show team configuration                  | `tinyclaw team show dev`      |
| `team remove <id>`       | Remove a team                            | `tinyclaw team remove dev`    |
| `team visualize [id]`    | Live TUI dashboard for team chains       | `tinyclaw team visualize dev` |

### Configuration Commands

| Command                           | Description                  | Example                                          |
| --------------------------------- | ---------------------------- | ------------------------------------------------ |
| `provider [name]`                 | Show or switch AI provider   | `tinyclaw provider anthropic`                    |
| `provider <name> --model <model>` | Switch provider and model    | `tinyclaw provider openai --model gpt-5.3-codex` |
| `model [name]`                    | Show or switch AI model      | `tinyclaw model opus`                            |
| `reset`                           | Reset all conversations      | `tinyclaw reset`                                 |
| `channels reset <channel>`        | Reset channel authentication | `tinyclaw channels reset whatsapp`               |

### Update Commands

| Command  | Description                       | Example           |
| -------- | --------------------------------- | ----------------- |
| `update` | Update TinyClaw to latest version | `tinyclaw update` |

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

### In-Chat Commands

These commands work in Discord, Telegram, and WhatsApp:

| Command             | Description                                  | Example                              |
| ------------------- | -------------------------------------------- | ------------------------------------ |
| `@agent_id message` | Route message to specific agent              | `@coder fix the bug`                 |
| `@team_id message`  | Route message to team leader                 | `@dev fix the auth bug`              |
| `/agent`            | List all available agents                    | `/agent`                             |
| `/team`             | List all available teams                     | `/team`                              |
| `@agent_id /reset`  | Reset specific agent conversation            | `@coder /reset`                      |
| `/reset`            | Reset conversation (WhatsApp/global)         | `/reset` or `!reset`                 |
| `message`           | Send to default agent (no prefix)            | `help me with this`                  |

**Note:** The `@agent_id` routing prefix requires a space after it (e.g., `@coder fix` not `@coderfix`).

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
│         (Discord, Telegram, WhatsApp, Heartbeat)            │
└────────────────────┬────────────────────────────────────────┘
                     │ Write message.json
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                   ~/.tinyclaw/queue/                         │
│                                                              │
│  incoming/          processing/         outgoing/           │
│  ├─ msg1.json  →   ├─ msg1.json   →   ├─ msg1.json        │
│  ├─ msg2.json       └─ msg2.json       └─ msg2.json        │
│  └─ msg3.json                                                │
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

- **File-based queue** - Atomic operations, no race conditions
- **Parallel agents** - Different agents process messages concurrently
- **Sequential per agent** - Preserves conversation order within each agent
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
  },
  "memory": {
    "enabled": true,
    "rerank": {
      "enabled": true
    },
    "retention": {
      "enabled": true,
      "retain_days": 30,
      "max_turn_files_per_agent": 2000,
      "cleanup_interval_seconds": 300
    },
    "qmd": {
      "enabled": true,
      "command": "/home/me/.bun/bin/qmd",
      "top_k": 4,
      "min_score": 0.05,
      "max_chars": 2500,
      "update_interval_seconds": 120,
      "embed_interval_seconds": 600,
      "use_semantic_search": false,
      "disable_query_expansion": true,
      "allow_unsafe_vsearch": false,
      "debug_logging": false
    }
  }
}
```

### Optional Memory Retrieval (QMD)

TinyClaw can use external memory retrieval with `qmd` (BM25 by default).

- Memory retrieval is **disabled by default**. Set `"memory.enabled": true` to enable.
- Retrieval runs only for user chat channels (`telegram`, `discord`, `whatsapp`).
- Heartbeat/system messages are excluded from retrieval and memory persistence.
- Turns are stored in `~/.tinyclaw/memory/turns/<agent_id>/`.
- Turn files are cleaned automatically (default: keep 30 days and max 2000 files per agent).
- Retrieval reranking heuristics are configurable via `memory.rerank` (can be disabled).

Quick setup:

```bash
# Install qmd (recommended by qmd project)
bun install -g github:tobi/qmd

# Linux/WSL: install sqlite-vec extension package if qmd reports missing extension
bun add -g sqlite-vec-linux-x64

# Verify qmd works
qmd status

# Optional: if qmd is not in PATH, set memory.qmd.command in settings.json
tinyclaw restart
```

Safety note:
- `use_semantic_search` (`qmd-vsearch`) is currently **experimental**.
- If semantic search is enabled, TinyClaw defaults to safe mode and will fall back to BM25 unless disable-expansion support is detected.
- Set `memory.qmd.allow_unsafe_vsearch: true` only if you explicitly want to allow unguarded `vsearch`.
- Set `memory.qmd.debug_logging: true` to print QMD memory debug logs (command/mode/timeout) in `queue.log`.
- When semantic search is enabled, TinyClaw periodically runs `qmd embed` in background (non-blocking). Default `embed_interval_seconds` is `600`.

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
- WhatsApp startup fails with `Could not find Chrome` → Install browser: `npx puppeteer browsers install chrome`
- Messages stuck → Clear queue: `rm -rf .tinyclaw/queue/processing/*`
- Agent not found → Check: `tinyclaw agent list`

**Need help?**

- [GitHub Issues](https://github.com/jlia0/tinyclaw/issues)
- Check logs: `tinyclaw logs all`

## 🙏 Credits

- Inspired by [OpenClaw](https://openclaw.ai/) by Peter Steinberger
- Built on [Claude Code](https://claude.com/claude-code) and [Codex CLI](https://docs.openai.com/codex)
- Uses [discord.js](https://discord.js.org/), [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js), [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)

## 📄 License

MIT

---

**TinyClaw - Tiny but mighty!** 🦞✨

[![Star History Chart](https://api.star-history.com/svg?repos=jlia0/tinyclaw&type=date&legend=top-left)](https://www.star-history.com/#jlia0/tinyclaw&type=date&legend=top-left)
