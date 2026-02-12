# TinyClaw 🦞

**Multi-team, multi-channel, 24/7 AI assistant**

Run multiple AI teams simultaneously with isolated workspaces and conversation contexts. Route messages to specialized teams using simple `@team_id` syntax.

## ✨ Features

- ✅ **Team of agents** - Run multiple isolated AI teams with specialized roles
- ✅ **Multiple AI providers** - Anthropic Claude (Sonnet/Opus) and OpenAI (GPT/Codex)
- ✅ **Multi-channel** - Discord, WhatsApp, and Telegram
- ✅ **Parallel processing** - Teams process messages concurrently
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
4. **Default team** - Configure your main AI assistant
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

### Team Commands

| Command            | Description                | Example                      |
| ------------------ | -------------------------- | ---------------------------- |
| `team list`        | List all configured teams  | `tinyclaw team list`         |
| `team add`         | Add new team (interactive) | `tinyclaw team add`          |
| `team show <id>`   | Show team configuration    | `tinyclaw team show coder`   |
| `team remove <id>` | Remove a team              | `tinyclaw team remove coder` |
| `team reset <id>`  | Reset team conversation    | `tinyclaw team reset coder`  |

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
| `send <message>` | Route to specific team      | `tinyclaw send "@coder fix bug"` |

### In-Chat Commands

These commands work in Discord, Telegram, and WhatsApp:

| Command            | Description                           | Example                              |
| ------------------ | ------------------------------------- | ------------------------------------ |
| `@team_id message` | Route message to specific team        | `@coder fix the bug`                 |
| `/team`            | List all available teams              | `/team`                              |
| `@team_id /reset`  | Reset specific team conversation      | `@coder /reset`                      |
| `/reset`           | Reset conversation (WhatsApp/global)  | `/reset` or `!reset`                 |
| `message`          | Send to default team (no prefix)      | `help me with this`                  |

**Note:** The `@team_id` routing prefix requires a space after it (e.g., `@coder fix` not `@coderfix`).

## 🤖 Using Teams

### Routing Messages

Use `@team_id` prefix to route messages to specific teams (see [In-Chat Commands](#in-chat-commands) table above):

```
@coder fix the authentication bug
@writer document the API endpoints
@researcher find papers on transformers
help me with this  ← goes to default team (no prefix needed)
```

### Team Configuration

Teams are configured in `.tinyclaw/settings.json`:

```json
{
  "workspace": {
    "path": "/Users/me/tinyclaw-workspace",
    "name": "tinyclaw-workspace"
  },
  "teams": {
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

Each team operates in isolation:

- **Separate workspace directory** - `~/tinyclaw-workspace/{team_id}/`
- **Own conversation history** - Maintained by CLI
- **Custom configuration** - `.claude/`, `heartbeat.md` (root), `AGENTS.md`
- **Independent resets** - Reset individual team conversations

<details>
<summary><b>📖 Learn more about teams</b></summary>

See [docs/TEAM_OF_AGENTS.md](docs/TEAM_OF_AGENTS.md) for:

- Architecture details
- Team configuration
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
│              Parallel Processing by Team                     │
│                                                              │
│  Team: coder         Team: writer        Team: assistant    │
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
- **Parallel teams** - Different teams process messages concurrently
- **Sequential per team** - Preserves conversation order within each team
- **Isolated workspaces** - Each team has its own directory and context

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
│   ├── .claude/          # Template for teams
│   ├── heartbeat.md      # Template for teams
│   └── AGENTS.md         # Template for teams
├── ~/tinyclaw-workspace/ # Team workspaces
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
  "teams": {
    "assistant": {
      "name": "Assistant",
      "provider": "anthropic",
      "model": "sonnet",
      "working_directory": "/Users/me/tinyclaw-workspace/assistant"
    }
  },
  "monitoring": {
    "heartbeat_interval": 3600
  }
}
```

### Heartbeat Configuration

Edit team-specific heartbeat prompts:

```bash
# Edit heartbeat for specific team
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

### Multi-Team Workflow

```
@coder Review and fix bugs in auth.ts
@writer Document the changes
@reviewer Check the documentation quality
```

### Cross-Device Access

- WhatsApp on phone
- Discord on desktop
- Telegram anywhere
- CLI for automation

All channels share team conversations!

## 📚 Documentation

- [TEAM_OF_AGENTS.md](docs/TEAM_OF_AGENTS.md) - Team management and routing
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
- Messages stuck → Clear queue: `rm -rf .tinyclaw/queue/processing/*`
- Team not found → Check: `tinyclaw team list`

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
