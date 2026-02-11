# TinyClaw 🦞

Minimal multi-channel AI assistant with Discord, WhatsApp, and Telegram integration.

## 🎯 What is TinyClaw?

TinyClaw is a lightweight multi-provider AI assistant that:

- ✅ Supports **Anthropic Claude** and **OpenAI GPT** models
- ✅ Connects Discord, WhatsApp, and Telegram
- ✅ Processes messages sequentially (no race conditions)
- ✅ Maintains conversation context
- ✅ Runs 24/7 in tmux
- ✅ Extensible multi-channel architecture

**Key innovation:** File-based queue system prevents race conditions and enables seamless multi-channel support.

## 📐 Architecture

```
┌─────────────────┐
│  Discord        │──┐
│  Client         │  │
└─────────────────┘  │
                     │
┌─────────────────┐  │
│  WhatsApp       │──┤
│  Client         │  │
└─────────────────┘  ├──→ Queue (incoming/)
                     │        ↓
┌─────────────────┐  │   ┌──────────────┐
│  Telegram       │──┤   │   Queue      │
│  Client         │  │   │  Processor   │
└─────────────────┘  │   └──────────────┘
                     │        ↓
                     │   AI Provider
                     │   (Claude or OpenAI)
                     │        ↓
                     │   Queue (outgoing/)
                     │        ↓
                     └──> Channels send
                          responses
```

## 🚀 Quick Start

### Prerequisites

- macOS or Linux
- [Claude Code](https://claude.com/claude-code) installed (for Anthropic provider)
- **[Codex CLI](https://docs.openai.com/codex)** installed and authenticated (for OpenAI provider)
- Node.js v14+
- tmux
- Bash 4.0+ (macOS users: `brew install bash` - system bash 3.2 won't work)

### Installation

#### Option 1: Quick Install (Recommended)

One-line install with all dependencies bundled:

```bash
curl -fsSL https://raw.githubusercontent.com/jlia0/tinyclaw/main/scripts/remote-install.sh | bash
```

This automatically:
- Downloads pre-built bundle (no npm install needed)
- Installs to `~/.tinyclaw`
- Creates global `tinyclaw` command
- Falls back to source install if bundle unavailable

#### Option 2: Manual from Release

Download the latest release bundle:

```bash
# Download from GitHub releases
wget https://github.com/jlia0/tinyclaw/releases/latest/download/tinyclaw-bundle.tar.gz

# Extract
tar -xzf tinyclaw-bundle.tar.gz
cd tinyclaw

# Install CLI globally
./scripts/install.sh
```

#### Option 3: From Source

Clone and build from source:

```bash
# Clone repository
git clone https://github.com/jlia0/tinyclaw.git
cd tinyclaw

# Install dependencies
npm install

# Install CLI globally
./scripts/install.sh
```

#### Option 4: Direct Script (No CLI Install)

Run TinyClaw from its directory without global CLI:

```bash
cd /path/to/tinyclaw

# Install dependencies
npm install

# Start TinyClaw (first run triggers setup wizard)
./tinyclaw.sh start
```

### First Run - Setup Wizard

On first start, you'll see an interactive setup wizard:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  TinyClaw - Setup Wizard
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Which messaging channels do you want to enable?

  Enable Discord? [y/N]: y
    ✓ Discord enabled
  Enable WhatsApp? [y/N]: y
    ✓ WhatsApp enabled
  Enable Telegram? [y/N]: y
    ✓ Telegram enabled

Enter your Discord bot token:
(Get one at: https://discord.com/developers/applications)

Token: YOUR_DISCORD_BOT_TOKEN_HERE

✓ Discord token saved

Enter your Telegram bot token:
(Create a bot via @BotFather on Telegram to get a token)

Token: YOUR_TELEGRAM_BOT_TOKEN_HERE

✓ Telegram token saved

Which AI provider?

  1) Anthropic (Claude)  (recommended)
  2) OpenAI (Codex/GPT)

Choose [1-2]: 1

✓ Provider: anthropic

Which Claude model?

  1) Sonnet  (fast, recommended)
  2) Opus    (smartest)

Choose [1-2]: 1

✓ Model: sonnet

Heartbeat interval (seconds)?
(How often Claude checks in proactively)

Interval [default: 3600]: 3600

✓ Heartbeat interval: 3600s

✓ Configuration saved to .tinyclaw/settings.json
```

### Discord Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" section and create a bot
4. Copy the bot token
5. Enable "Message Content Intent" in Bot settings
6. Invite the bot to your server using OAuth2 URL Generator

### Telegram Setup

1. Open Telegram and search for @BotFather
2. Send `/newbot` and follow the prompts
3. Choose a name and username for your bot
4. Copy the bot token provided by BotFather
5. Start a chat with your bot or add it to a group

### WhatsApp Setup

After starting, a QR code will appear if WhatsApp is enabled:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        WhatsApp QR Code
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[QR CODE HERE]

📱 Scan with WhatsApp:
   Settings → Linked Devices → Link a Device
```

Scan it with your phone. **Done!** 🎉

### Test It

**Discord:** Send a DM to your bot or mention it in a channel

**WhatsApp:** Send a message to the connected number

**Telegram:** Send a message to your bot

You'll get a response! 🤖

## 📋 Commands

If installed as CLI tool, use `tinyclaw` command. Otherwise use `./tinyclaw.sh`.

```bash
# Start TinyClaw
tinyclaw start

# Run setup wizard (change channels/model/heartbeat)
tinyclaw setup

# Check status
tinyclaw status

# Send manual message
tinyclaw send "What's the weather?"

# Reset conversation
tinyclaw reset

# Reset channel authentication
tinyclaw channels reset whatsapp  # Clear WhatsApp session
tinyclaw channels reset discord   # Shows Discord reset instructions
tinyclaw channels reset telegram  # Shows Telegram reset instructions

# Switch AI provider (one-step command)
tinyclaw provider                                   # Show current provider and model
tinyclaw provider anthropic --model sonnet          # Switch to Anthropic with Sonnet
tinyclaw provider openai --model gpt-5.3-codex      # Switch to OpenAI with GPT-5.3 Codex
tinyclaw provider openai --model gpt-4o             # Switch to OpenAI with custom model

# Or switch provider/model separately
tinyclaw provider anthropic    # Switch to Anthropic only
tinyclaw model sonnet          # Then switch model
tinyclaw model opus            # Switch to Claude Opus
tinyclaw model gpt-5.2         # Switch to OpenAI GPT-5.2

# View logs
tinyclaw logs whatsapp   # WhatsApp activity
tinyclaw logs discord    # Discord activity
tinyclaw logs telegram   # Telegram activity
tinyclaw logs queue      # Queue processing
tinyclaw logs heartbeat  # Heartbeat checks

# Attach to tmux
tinyclaw attach

# Restart
tinyclaw restart

# Stop
tinyclaw stop
```

### Uninstall CLI

To remove the global CLI installation:

```bash
cd /path/to/tinyclaw
./scripts/uninstall.sh
```

This only removes the CLI symlink. The TinyClaw installation directory remains intact.

## 🔧 Components

### 1. lib/setup-wizard.sh

- Interactive setup on first run
- Configures channels (Discord/WhatsApp/Telegram)
- Collects bot tokens for enabled channels
- Selects Claude model
- Writes to `.tinyclaw/settings.json`

### 2. discord-client.ts

- Connects to Discord via bot token
- Listens for DMs and mentions
- Writes incoming messages to queue
- Reads responses from queue
- Sends replies back

### 3. whatsapp-client.ts

- Connects to WhatsApp via QR code
- Writes incoming messages to queue
- Reads responses from queue
- Sends replies back

### 4. telegram-client.ts

- Connects to Telegram via bot token
- Listens for messages
- Writes incoming messages to queue
- Reads responses from queue
- Sends replies back

### 5. queue-processor.ts

- Polls incoming queue
- Processes **ONE message at a time**
- Routes to configured AI provider:
  - **Anthropic:** Calls `claude -c -p` (supports long-running agent tasks)
  - **OpenAI:** Calls `codex exec resume --last --json` with configured model
  - Parses JSONL output and extracts final agent message
- Waits indefinitely for response
- Writes responses to outgoing queue

### 6. lib/heartbeat-cron.sh

- Runs every 5 minutes
- Sends heartbeat via queue
- Keeps conversation active

### 7. tinyclaw.sh

- Main orchestrator
- Manages tmux session
- CLI interface

## 💬 Message Flow

```
Message arrives (Discord/WhatsApp/Telegram)
       ↓
Client writes to:
  .tinyclaw/queue/incoming/{channel}_<id>.json
       ↓
queue-processor.ts picks it up
       ↓
Routes to AI provider:
  - Claude: claude -c -p "message"
  - Codex: codex exec resume --last --json "message"
       ↓
Writes to:
  .tinyclaw/queue/outgoing/{channel}_<id>.json
       ↓
Client reads and sends response
       ↓
User receives reply
```

## 📁 Directory Structure

```
tinyclaw/
├── .claude/              # Claude Code config
│   ├── settings.json     # Hooks config
│   └── hooks/            # Hook scripts
├── .tinyclaw/            # TinyClaw data
│   ├── settings.json     # Configuration (channel, model, tokens)
│   ├── queue/
│   │   ├── incoming/     # New messages
│   │   ├── processing/   # Being processed
│   │   └── outgoing/     # Responses
│   ├── logs/
│   │   ├── discord.log
│   │   ├── whatsapp.log
│   │   ├── queue.log
│   │   └── heartbeat.log
│   ├── channels/         # Runtime channel data
│   ├── whatsapp-session/
│   └── heartbeat.md
├── src/
│   ├── discord-client.ts    # Discord I/O
│   ├── whatsapp-client.ts   # WhatsApp I/O
│   ├── telegram-client.ts   # Telegram I/O
│   └── queue-processor.ts   # Message processing
├── dist/                 # TypeScript build output
├── lib/                  # Runtime helper scripts
│   ├── setup-wizard.sh   # Interactive setup (first run)
│   └── heartbeat-cron.sh # Health checks
├── scripts/              # Installation & build scripts
│   ├── install.sh        # CLI installation
│   ├── uninstall.sh      # CLI uninstallation
│   ├── bundle.sh         # Create release bundle
│   └── remote-install.sh # Remote installation
└── tinyclaw.sh           # Main script
```

## 🔄 Reset Conversation

### Via CLI

```bash
./tinyclaw.sh reset
```

### Via WhatsApp

Send: `!reset` or `/reset`

Next message starts fresh (no conversation history).

## ⚙️ Configuration

### Settings File

All configuration is stored in `.tinyclaw/settings.json`:

**Anthropic (Claude) example:**
```json
{
  "channels": {
    "enabled": ["telegram", "discord"],
    "discord": {
      "bot_token": "YOUR_DISCORD_TOKEN_HERE"
    },
    "telegram": {
      "bot_token": "YOUR_TELEGRAM_TOKEN_HERE"
    },
    "whatsapp": {}
  },
  "models": {
    "provider": "anthropic",
    "anthropic": {
      "model": "sonnet"
    }
  },
  "monitoring": {
    "heartbeat_interval": 3600
  }
}
```

**OpenAI (Codex CLI) example:**
```json
{
  "channels": {
    "enabled": ["telegram", "discord"],
    "discord": {
      "bot_token": "YOUR_DISCORD_TOKEN_HERE"
    },
    "telegram": {
      "bot_token": "YOUR_TELEGRAM_TOKEN_HERE"
    },
    "whatsapp": {}
  },
  "models": {
    "provider": "openai",
    "openai": {
      "model": "gpt-5.3-codex"
    }
  },
  "monitoring": {
    "heartbeat_interval": 3600
  }
}
```

**Note:** Authentication is handled by the `codex` CLI. Make sure to run `codex` and authenticate before using the OpenAI provider.

To reconfigure, run:

```bash
./tinyclaw.sh setup
```

The heartbeat interval is in seconds (default: 3600s = 60 minutes).
This controls how often Claude proactively checks in.

### Heartbeat Prompt

Edit `.tinyclaw/heartbeat.md`:

```markdown
Check for:

1. Pending tasks
2. Errors
3. Unread messages

Take action if needed.
```

## 📊 Monitoring

### View Logs

```bash
# WhatsApp activity
tail -f .tinyclaw/logs/whatsapp.log

# Discord activity
tail -f .tinyclaw/logs/discord.log

# Telegram activity
tail -f .tinyclaw/logs/telegram.log

# Queue processing
tail -f .tinyclaw/logs/queue.log

# Heartbeat checks
tail -f .tinyclaw/logs/heartbeat.log

# All logs
./tinyclaw.sh logs daemon
```

### Watch Queue

```bash
# Incoming messages
watch -n 1 'ls -lh .tinyclaw/queue/incoming/'

# Outgoing responses
watch -n 1 'ls -lh .tinyclaw/queue/outgoing/'
```

## 🎨 Features

### ✅ No Race Conditions

Messages processed **sequentially**, one at a time:

```
Message 1 → Process → Done
Message 2 → Wait → Process → Done
Message 3 → Wait → Process → Done
```

### ✅ Multi-Channel Support

Discord, WhatsApp, and Telegram work seamlessly together. All channels share the same conversation context!

**Adding more channels is easy:**

```typescript
// new-channel-client.ts
// Write to queue
fs.writeFileSync(
  ".tinyclaw/queue/incoming/channel_<id>.json",
  JSON.stringify({
    channel: "channel-name",
    message,
    sender,
    timestamp,
  }),
);

// Read responses from outgoing queue
// Same format as other channels
```

Queue processor handles all channels automatically!

### ✅ Multiple AI Providers

**Anthropic Claude:**
- Sonnet (fast, recommended)
- Opus (smartest)
- Uses `claude -c -p` CLI for conversation continuity

**OpenAI Codex:**
- GPT-5.3 Codex (recommended)
- GPT-5.2
- Uses `codex exec resume --last` for conversation continuity
- Parses JSONL output to extract agent messages
- Requires Codex CLI to be installed and authenticated

Switch providers and models in one command:
```bash
# One-step command (recommended)
./tinyclaw.sh provider openai --model gpt-5.3-codex

# Or two-step
./tinyclaw.sh provider openai
./tinyclaw.sh model gpt-5.3-codex

# Custom OpenAI model
./tinyclaw.sh provider openai --model gpt-4o
```

### ✅ Persistent Sessions

WhatsApp session persists across restarts:

```bash
# First time: Scan QR code
./tinyclaw.sh start

# Subsequent starts: Auto-connects
./tinyclaw.sh restart
```

## 🔐 Security

- WhatsApp session stored locally in `.tinyclaw/whatsapp-session/`
- Queue files are local (no network exposure)
- Each channel handles its own authentication
- Claude runs with your user permissions

## 🐛 Troubleshooting

### Bash version error on macOS

If you see:

```
Error: This script requires bash 4.0 or higher (you have 3.2.57)
```

macOS ships with bash 3.2 by default. Install a newer version:

```bash
# Install bash 5.x via Homebrew
brew install bash

# Add to your PATH (add this to ~/.zshrc or ~/.bash_profile)
export PATH="/opt/homebrew/bin:$PATH"

# Or run directly with the new bash
/opt/homebrew/bin/bash ./tinyclaw.sh start
```

### WhatsApp not connecting

```bash
# Check logs
./tinyclaw.sh logs whatsapp

# Reset WhatsApp authentication
./tinyclaw.sh channels reset whatsapp
./tinyclaw.sh restart
```

### Discord not connecting

```bash
# Check logs
./tinyclaw.sh logs discord

# Update Discord bot token
./tinyclaw.sh setup
```

### Telegram not connecting

```bash
# Check logs
./tinyclaw.sh logs telegram

# Update Telegram bot token
./tinyclaw.sh setup
```

### Messages not processing

```bash
# Check queue processor
./tinyclaw.sh status

# Check queue
ls -la .tinyclaw/queue/incoming/

# View queue logs
./tinyclaw.sh logs queue
```

### QR code not showing

```bash
# Attach to tmux to see the QR code
tmux attach -t tinyclaw
```

## 🚀 Production Deployment

### Using systemd

```bash
sudo systemctl enable tinyclaw
sudo systemctl start tinyclaw
```

### Using PM2

```bash
pm2 start tinyclaw.sh --name tinyclaw
pm2 save
```

### Using supervisor

```ini
[program:tinyclaw]
command=/path/to/tinyclaw/tinyclaw.sh start
autostart=true
autorestart=true
```

## 🛠️ Development & Releases

### Creating a Release Bundle

For maintainers creating releases:

```bash
# Build a distributable bundle with all dependencies
./scripts/bundle.sh
```

This creates `tinyclaw-bundle-{version}.tar.gz` with:
- All source code
- Pre-installed `node_modules/` (production only)
- Compiled TypeScript (dist/)
- All scripts and configurations

Upload this bundle to GitHub Releases, and the remote installer will automatically use it!

### Automated Releases

The project includes a GitHub Actions workflow that automatically:
1. Builds the bundle when you push a version tag
2. Creates a GitHub Release
3. Uploads the bundle as a release asset

To create a new release:

```bash
# Tag a new version
git tag v1.0.0
git push origin v1.0.0

# GitHub Actions will automatically:
# - Build the bundle
# - Create the release
# - Upload the bundle
```

### Manual Bundle Testing

Test a bundle locally before releasing:

```bash
# Create bundle
./scripts/bundle.sh

# Test installation
mkdir test-install
tar -xzf tinyclaw-bundle-*.tar.gz -C test-install --strip-components=1
cd test-install
./install.sh

# Test the CLI
tinyclaw status
```

The bundle structure maintains the organized directory layout with `scripts/` and `lib/` directories.

## 🎯 Use Cases

### Personal AI Assistant

```
You: "Remind me to call mom"
Claude: "I'll remind you!"
[5 minutes later via heartbeat]
Claude: "Don't forget to call mom!"
```

### Code Helper

```
You: "Review my code"
Claude: [reads files, provides feedback]
You: "Fix the bug"
Claude: [fixes and commits]
```

### Multi-Device

- WhatsApp on phone
- Discord on desktop/mobile
- Telegram on any device
- CLI for scripts

All channels share the same Claude conversation!

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=jlia0/tinyclaw&type=date&legend=top-left)](https://www.star-history.com/#jlia0/tinyclaw&type=date&legend=top-left)

## 🙏 Credits

- Inspired by [OpenClaw](https://openclaw.ai/) by Peter Steinberger
- Built on [Claude Code](https://claude.com/claude-code)
- Uses [discord.js](https://discord.js.org/)
- Uses [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js)

## 📄 License

MIT

---

**TinyClaw - Small but mighty!** 🦞✨
