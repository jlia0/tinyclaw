# TinyClaw 🦞

Minimal multi-channel AI assistant with WhatsApp integration and queue-based architecture.

## 🎯 What is TinyClaw?

TinyClaw is a lightweight wrapper around [Claude Code](https://claude.com/claude-code) that:

- ✅ Connects WhatsApp (via QR code)
- ✅ Processes messages sequentially (no race conditions)
- ✅ Maintains conversation context
- ✅ Runs 24/7 in tmux
- ✅ Ready for multi-channel (Telegram, etc.)

**Key innovation:** File-based queue system prevents race conditions and enables multi-channel support.

## 📐 Architecture

```
┌─────────────────┐
│  WhatsApp       │──┐
│  Client         │  │
└─────────────────┘  │
                     ├──→ Queue (incoming/)
┌─────────────────┐  │        ↓
│  Telegram       │──┤   ┌──────────────┐
│  (future)       │  │   │   Queue      │
└─────────────────┘  │   │  Processor   │
                     │   └──────────────┘
Other Channels ──────┘        ↓
                         claude --dangerously-skip-permissions -c -p
                              ↓
                         Queue (outgoing/)
                              ↓
                    ┌─────────────────┐
                    │ Channels send   │
                    │ responses       │
                    └─────────────────┘
```

### Tmux Layout

```
┌──────────────┬──────────────┐
│  WhatsApp    │    Queue     │
│  Client      │  Processor   │
├──────────────┼──────────────┤
│  Heartbeat   │    Logs      │
└──────────────┴──────────────┘
```

## 🚀 Quick Start

### Prerequisites

- macOS or Linux
- [Claude Code](https://claude.com/claude-code) installed
- Node.js v14+
- tmux

### Installation

```bash
git clone https://github.com/jlia0/tinyclaw.git
cd tinyclaw

# Install dependencies
npm install

# Configure allowed senders (REQUIRED for security)
cp .env.example .env
# Edit .env and add your phone number(s)

# Make scripts executable
chmod +x *.sh *.js

# Start TinyClaw
./tinyclaw.sh start
```

### First Run

A QR code will appear in your terminal:

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

Send a WhatsApp message to yourself from a different WhatsApp account:

```
"Hello Claude!"
```

You'll get a response! 🤖

## 📋 Commands

```bash
# Start TinyClaw
./tinyclaw.sh start

# Check status
./tinyclaw.sh status

# Send manual message
./tinyclaw.sh send "What's the weather?"

# Reset conversation
./tinyclaw.sh reset

# View logs
./tinyclaw.sh logs whatsapp
./tinyclaw.sh logs queue

# Attach to tmux
./tinyclaw.sh attach

# Stop
./tinyclaw.sh stop
```

## 🔧 Components

### 1. whatsapp-client.js

- Connects to WhatsApp via QR code
- Writes incoming messages to queue
- Reads responses from queue
- Sends replies back

### 2. queue-processor.js

- Polls incoming queue
- Processes **ONE message at a time**
- Calls `claude -c -p`
- Writes responses to outgoing queue

### 3. heartbeat-cron.sh

- Runs every 5 minutes
- Sends heartbeat via queue
- Keeps conversation active

### 4. tinyclaw.sh

- Main orchestrator
- Manages tmux session
- CLI interface

## 💬 Message Flow

```
WhatsApp message arrives
       ↓
whatsapp-client.js writes to:
  .tinyclaw/queue/incoming/whatsapp_<id>.json
       ↓
queue-processor.js picks it up
       ↓
Runs: claude -c -p "message"
       ↓
Writes to:
  .tinyclaw/queue/outgoing/whatsapp_<id>.json
       ↓
whatsapp-client.js sends response
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
│   ├── queue/
│   │   ├── incoming/     # New messages
│   │   ├── processing/   # Being processed
│   │   └── outgoing/     # Responses
│   ├── logs/
│   ├── whatsapp-session/
│   └── heartbeat.md
├── tinyclaw.sh           # Main script
├── whatsapp-client.js    # WhatsApp I/O
├── queue-processor.js    # Message processing
└── heartbeat-cron.sh     # Health checks
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

### Heartbeat Interval

Edit `heartbeat-cron.sh`:

```bash
INTERVAL=300  # seconds (5 minutes)
```

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

### ✅ Multi-Channel Ready

Add Telegram by creating `telegram-client.js`:

```javascript
// Write to queue
fs.writeFileSync(
  '.tinyclaw/queue/incoming/telegram_<id>.json',
  JSON.stringify({ channel: 'telegram', message, ... })
);

// Read responses
// Same format as WhatsApp
```

Queue processor handles it automatically!

### ✅ Clean Responses

Uses `claude -c -p`:

- `-c` = continue conversation
- `-p` = print mode (clean output)
- No tmux capture needed

### ✅ Persistent Sessions

WhatsApp session persists across restarts:

```bash
# First time: Scan QR code
./tinyclaw.sh start

# Subsequent starts: Auto-connects
./tinyclaw.sh restart
```

## 🔐 Security

### Sender Allowlist

Only specified phone numbers can trigger Claude. Set via environment variable:

```bash
# .env (gitignored)
TINYCLAW_ALLOWED_SENDERS=14155551234,14155555678
```

Copy `.env.example` to `.env` and add your phone number(s).

### Dangerous Pattern Filter (Optional)

Defense-in-depth layer that blocks messages containing dangerous patterns before reaching Claude:
- `rm -rf`, `sudo`, shell pipes (`| bash`)
- SSH keys, `.env`, passwords, API keys, credentials
- Destructive commands (`mkfs`, `dd if=`, `chmod 777`)

**Enabled by default.** Disable if too aggressive for your use case:
```json
{ "patternFilterEnabled": false }
```

### Rate Limiting

Prevents message flooding. Defaults: 10 messages per 60 seconds per sender.
Includes helpful "wait X seconds" feedback when triggered.

Configure in `.tinyclaw/config.json`:
```json
{
  "rateLimitEnabled": true,
  "rateLimit": { "maxMessages": 10, "windowMs": 60000 }
}
```

### Full Configuration Example

`.tinyclaw/config.json`:
```json
{
  "allowlistEnabled": true,
  "rateLimitEnabled": true,
  "rateLimit": { "maxMessages": 10, "windowMs": 60000 },
  "patternFilterEnabled": true
}
```

### Other Protections

- WhatsApp session stored locally in `.tinyclaw/whatsapp-session/`
- Queue files are local (no network exposure)
- Each channel handles its own authentication
- Claude runs with your user permissions

### ⚠️ Important Note

This project uses `--dangerously-skip-permissions` which bypasses Claude's permission system. The security measures above reduce risk but cannot fully prevent a determined attacker with allowlist access from crafting malicious prompts.

## 🐛 Troubleshooting

### WhatsApp not connecting

```bash
# Check logs
./tinyclaw.sh logs whatsapp

# Re-authenticate
rm -rf .tinyclaw/whatsapp-session/
./tinyclaw.sh restart
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
# Use helper script
./show-qr.sh

# Or attach to tmux
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
- Telegram on desktop
- CLI for scripts
  All share the same Claude conversation!

## 🙏 Credits

- Inspired by [OpenClaw](https://openclaw.ai/) by Peter Steinberger
- Built on [Claude Code](https://claude.com/claude-code)
- Uses [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js)

## 📄 License

MIT

---

**TinyClaw - Small but mighty!** 🦞✨
