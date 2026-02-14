# Queue System

TinyClaw uses a file-based queue system to coordinate message processing across multiple channels and agents. This document explains how it works.

## Overview

The queue system acts as a central coordinator between:
- **Channel clients** (Discord, Telegram, WhatsApp) - produce messages
- **Queue processor** - routes and processes messages
- **AI providers** (Claude, Codex) - generate responses
- **Agents** - isolated AI agents with different configs

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
│  └─ msg3.json         │                                      │
│                        └────────→ dead-letter/ (on failure) │
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

## Directory Structure

```
~/.tinyclaw/
├── queue/
│   ├── incoming/          # New messages from channels
│   │   ├── msg_123456.json
│   │   └── msg_789012.json
│   ├── processing/        # Currently being processed
│   │   └── msg_123456.json
│   ├── outgoing/          # Responses ready to send
│   │   └── msg_123456.json
│   └── dead-letter/       # Terminal or exhausted failures
│       └── msg_123456.json
├── logs/
│   ├── queue.log         # Queue processor logs
│   ├── discord.log       # Channel-specific logs
│   └── telegram.log
└── files/                # Uploaded files from channels
    └── image_123.png
```

## Message Flow

### 1. Incoming Message

A channel client receives a message and writes it to `incoming/`:

```json
{
  "channel": "discord",
  "sender": "Alice",
  "senderId": "user_12345",
  "message": "@coder fix the authentication bug",
  "timestamp": 1707739200000,
  "messageId": "discord_msg_123",
  "files": ["/path/to/screenshot.png"]
}
```

**Optional fields:**
- `agent` - Pre-route to specific agent (bypasses @agent_id parsing)
- `files` - Array of file paths uploaded with message
- `attempt` - Retry counter for transient processing failures
- `firstSeenAt` - Timestamp of first queue observation

### 2. Processing

The queue processor (runs every 1 second):

1. **Scans `incoming/`** for new messages
2. **Sorts by timestamp** (oldest first)
3. **Determines target agent**:
   - Checks `agent` field (if pre-routed)
   - Parses `@agent_id` prefix from message
   - Falls back to `default` agent
4. **Moves to `processing/`** (atomic operation)
5. **Routes to agent's promise chain** (parallel processing)

### 3. Agent Processing

Each agent has its own promise chain:

```typescript
// Messages to same agent = sequential (preserve conversation order)
agentChain: msg1 → msg2 → msg3

// Different agents = parallel (don't block each other)
@coder:     msg1 ──┐
@writer:    msg1 ──┼─→ All run concurrently
@assistant: msg1 ──┘
```

**Per-agent isolation:**
- Each agent runs in its own `working_directory`
- Separate conversation history (managed by CLI)
- Independent reset flags
- Own configuration files (.claude/, AGENTS.md)

### 4. AI Provider Execution

**Claude (Anthropic):**
```bash
cd ~/workspace/coder/
claude --dangerously-skip-permissions \
  --model claude-sonnet-4-5 \
  -c \  # Continue conversation
  -p "fix the authentication bug"
```

**Codex (OpenAI):**
```bash
cd ~/workspace/coder/
codex exec resume --last \
  --model gpt-5.3-codex \
  --skip-git-repo-check \
  --dangerously-bypass-approvals-and-sandbox \
  --json "fix the authentication bug"
```

### 5. Response

After AI responds, queue processor writes to `outgoing/`:

```json
{
  "channel": "discord",
  "sender": "Alice",
  "message": "I've identified the issue in auth.ts:42...",
  "originalMessage": "@coder fix the authentication bug",
  "timestamp": 1707739205000,
  "messageId": "discord_msg_123",
  "agent": "coder",
  "files": ["/path/to/fix.patch"]
}
```

### 6. Channel Delivery

Channel clients poll `outgoing/` and:
1. Read response for their channel
2. Send message to user
3. Delete the JSON file
4. Handle any file attachments

### 7. Retry and Dead-Letter

Queue processor classifies failures:

- **Transient**: retried up to `sandbox.max_attempts`.
- **Terminal**: no retry (fail-closed), immediately dead-lettered.

When retries are exhausted, the payload is moved to:

```text
~/.tinyclaw/queue/dead-letter/
```

Dead-letter files include:

- original message payload,
- error class (`transient` / `terminal`),
- attempt counters,
- failure timestamp.

## Parallel Processing

### How It Works

Each agent has its own **promise chain** that processes messages sequentially:

```typescript
const agentProcessingChains = new Map<string, Promise<void>>();

// When message arrives for @coder:
const chain = agentProcessingChains.get('coder') || Promise.resolve();
const newChain = chain.then(() => processMessage(msg));
agentProcessingChains.set('coder', newChain);
```

### Benefits

**Example: 3 messages sent simultaneously**

Sequential (old):
```
@coder fix bug 1     [████████████████] 30s
@writer docs         [██████████] 20s
@assistant help      [████████] 15s
Total: 65 seconds
```

Parallel (new):
```
@coder fix bug 1     [████████████████] 30s
@writer docs         [██████████] 20s ← concurrent!
@assistant help      [████████] 15s   ← concurrent!
Total: 30 seconds (2.2x faster!)
```

### Conversation Order Preserved

Messages to the **same agent** remain sequential:

```
@coder fix bug 1     [████] 10s
@coder fix bug 2             [████] 10s  ← waits for bug 1
@writer docs         [██████] 15s        ← parallel with both
```

This ensures:
- ✅ Conversation context is maintained
- ✅ `-c` (continue) flag works correctly
- ✅ No race conditions within an agent
- ✅ Agents don't block each other

## Agent Routing

### Explicit Routing

Use `@agent_id` prefix:

```
User: @coder fix the login bug
→ Routes to agent "coder"
→ Message becomes: "fix the login bug"
```

### Pre-routing

Channel clients can pre-route:

```typescript
const queueData = {
  channel: 'discord',
  message: 'help me',
  agent: 'assistant'  // Pre-routed, no @prefix needed
};
```

### Fallback Logic

```
1. Check message.agent field (if pre-routed)
2. Parse @agent_id from message text
3. Look up agent in settings.agents
4. Fall back to 'default' agent
5. If no default, use first available agent
```

### Routing Examples

```
"@coder fix bug"           → agent: coder
"help me"                  → agent: default
"@unknown test"            → agent: default (unknown agent)
"@assistant help"          → agent: assistant
pre-routed with agent=X    → agent: X
```

### Easter Egg: Multiple Agents 🥚

If you mention multiple agents in one message:

```
User: "@coder @writer fix this bug and document it"

Result:
  → Returns friendly message about upcoming agent-to-agent collaboration
  → No AI processing (saves tokens!)
  → Suggests sending separate messages to each agent
```

**The easter egg message:**
> 🚀 **Agent-to-Agent Collaboration - Coming Soon!**
>
> You mentioned multiple agents: @coder, @writer
>
> Right now, I can only route to one agent at a time. But we're working on something cool:
>
> ✨ **Multi-Agent Coordination** - Agents will be able to collaborate on complex tasks!
> ✨ **Smart Routing** - Send instructions to multiple agents at once!
> ✨ **Agent Handoffs** - One agent can delegate to another!
>
> For now, please send separate messages to each agent:
> • `@coder [your message]`
> • `@writer [your message]`
>
> _Stay tuned for updates! 🎉_

This prevents confusion and teases the upcoming feature!

## Reset System

### Global Reset

Creates `~/.tinyclaw/reset_flag`:

```bash
tinyclaw reset
```

Next message to **any agent** starts fresh (no `-c` flag).

### Per-Agent Reset

Creates `~/workspace/{agent_id}/reset_flag`:

```bash
tinyclaw agent reset coder
# Or in chat:
@coder /reset
```

Next message to **that agent** starts fresh.

### How Resets Work

Queue processor checks before each message:

```typescript
const globalReset = fs.existsSync(RESET_FLAG);
const agentReset = fs.existsSync(`${agentDir}/reset_flag`);

if (globalReset || agentReset) {
  // Don't pass -c flag to CLI
  // Delete flag files
}
```

## File Handling

### Uploading Files

Channels download files to `~/.tinyclaw/files/`:

```
User uploads: image.png
→ Saved as: ~/.tinyclaw/files/telegram_123_image.png
→ Message includes: [file: /absolute/path/to/image.png]
```

### Sending Files

AI can send files back:

```
AI response: "Here's the diagram [send_file: /path/to/diagram.png]"
→ Queue processor extracts file path
→ Adds to response.files array
→ Channel client sends as attachment
→ Tag is stripped from message text
```

## Error Handling

### Missing Agents

If agent not found:
```
User: @unknown help
→ Routes to: default agent
→ Logs: WARNING - Agent 'unknown' not found, using 'default'
```

### Processing Errors

Errors are classified and handled with retry/dead-letter flow:

```typescript
newChain.catch(error => {
  log('ERROR', `Error processing message for agent ${agentId}: ${error.message}`);
});
```

Failed messages:
- Don't block other agents.
- Are logged to `queue.log`.
- Retry if transient (up to configured cap).
- Move to dead-letter on terminal or exhausted retries.
- Return explicit failure message to channel user when processing aborts.

### Stale Messages

Old messages in `processing/` (crashed mid-process):
- Automatically picked up on restart
- Re-processed from scratch
- Original in `incoming/` is moved again

## Performance

### Throughput

- **Sequential**: 1 message per AI response time (~10-30s)
- **Parallel**: N agents × 1 message per response time
- **3 agents**: ~3x throughput improvement

### Latency

- Queue check: Every 1 second
- Agent routing: <1ms (file peek)
- Max latency: 1s + AI response time

### Scaling

**Good for:**
- ✅ Multiple independent agents
- ✅ High message volume
- ✅ Long AI response times

**Limitations:**
- ⚠️ File-based (not database)
- ⚠️ Single queue processor instance
- ⚠️ All agents on same machine

## Debugging

### Check Queue Status

```bash
# See pending messages
ls ~/.tinyclaw/queue/incoming/

# See processing
ls ~/.tinyclaw/queue/processing/

# See responses waiting
ls ~/.tinyclaw/queue/outgoing/

# See dead-letter failures
ls ~/.tinyclaw/queue/dead-letter/

# Watch queue logs
tail -f ~/.tinyclaw/logs/queue.log
```

### Common Issues

**Messages stuck in incoming:**
- Queue processor not running
- Check: `tinyclaw status`

**Messages stuck in processing:**
- AI CLI crashed or hung
- Manual cleanup: `rm ~/.tinyclaw/queue/processing/*`
- Restart: `tinyclaw restart`

**No responses generated:**
- Check agent routing (wrong @agent_id?)
- Check AI CLI is installed (claude/codex)
- Check logs: `tail -f ~/.tinyclaw/logs/queue.log`

**Agents not processing in parallel:**
- Check TypeScript build: `npm run build`
- Check queue processor version in logs

## Advanced Topics

### Custom Queue Implementations

Replace file-based queue with:
- Redis (for multi-instance)
- Database (for persistence)
- Message broker (RabbitMQ, Kafka)

Key interface to maintain:
```typescript
interface QueueMessage {
  channel: string;
  sender: string;
  message: string;
  timestamp: number;
  messageId: string;
  agent?: string;
  files?: string[];
}
```

### Load Balancing

Currently: All agents run on same machine

Future: Route agents to different machines:
```json
{
  "agents": {
    "coder": {
      "host": "worker1.local",
      "working_directory": "/agents/coder"
    },
    "writer": {
      "host": "worker2.local",
      "working_directory": "/agents/writer"
    }
  }
}
```

### Monitoring

Add metrics:
```typescript
- messages_processed_total (by agent)
- processing_duration_seconds (by agent)
- queue_depth (incoming/processing/outgoing)
- agent_active_processing (concurrent count)
```

## See Also

- [AGENTS.md](AGENTS.md) - Agent configuration and management
- [SANDBOX.md](SANDBOX.md) - Container runtime sandbox behavior
- [README.md](../README.md) - Main project documentation
- [src/queue-processor.ts](../src/queue-processor.ts) - Implementation
