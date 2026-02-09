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
cd /Users/jliao/workspace/tinyclaw

# Install dependencies
npm install

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
- **Security:** Command blacklist blocks dangerous patterns

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

### Command Blacklist

`queue-processor.js` includes a blacklist of dangerous command patterns that are blocked before reaching Claude:

```javascript
const BLACKLIST = [
    'rm -rf', 'rm -r', 'rm /',     // File destruction
    'sudo',                          // Privilege escalation
    'dd if=', 'mkfs',                // Disk operations
    '>:', '> /',                     // Output redirection
    'chmod -R 000', 'chown -R',      // Permission changes
    'kill -9', 'pkill', 'killall',   // Process killing
    'iptables', 'ufw disable',       // Firewall manipulation
    'systemctl stop',                // Service management
    'reboot', 'shutdown'             // System changes
];
```

Blocked requests return: "⚠️ This request has been blocked for security reasons."

**Blocked attempts are logged to:** `.tinyclaw/logs/queue.log`

### Future Security Enhancements

#### 1. Restricted Shell (rbash)

Restrict Claude to a limited shell environment:

```javascript
execSync(
  `rbash -c 'PATH=/usr/bin:/bin claude --dangerously-skip-permissions -c -p "${message}"'`,
  ...
);
```

#### 2. Bubblewrap Sandboxing

Run Claude in an isolated container with no access to sensitive paths:

```bash
# Install
sudo apt install bwrap

# Wrap execution
bwrap --bind / / --tmpfs /home --ro-bind ~/.config/claude ~/.config/claude claude -c -p "message"
```

#### 3. Command Wrapper Script

Create `/usr/local/bin/safe-claude` to sanitize inputs:

```bash
#!/bin/bash
# Strip dangerous patterns
INPUT=$(echo "$1" | sed -e 's/rm\s*-rf.*//g' -e 's/sudo\s*//g')

if [ "$INPUT" != "$1" ]; then
    echo "Blocked dangerous command"
    exit 1
fi

claude --dangerously-skip-permissions -c -p "$1"
```

### Security Considerations

| Risk | Mitigation |
|------|------------|
| Remote compromise via WhatsApp | Command blacklist + user training |
| Privilege escalation | Don't run as root; use standard user |
| Data destruction | Regular backups; restricted permissions |
| Unauthorized access | WhatsApp is already authenticated |

### Current Security Measures

- WhatsApp session stored locally in `.tinyclaw/whatsapp-session/`
- Queue files are local (no network exposure)
- Each channel handles its own authentication
- Claude runs with your user permissions

**Note:** Since `queue-processor.js` uses `--dangerously-skip-permissions`, Claude can execute any command your user account can. Only run trusted commands through it and be cautious about messages received.

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

### Command Blacklist

If legitimate requests are being blocked:

```bash
# View blocked attempts
grep "Blocked" .tinyclaw/logs/queue.log

# Edit whitelist in queue-processor.js (add new patterns to BLACKLIST)
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
