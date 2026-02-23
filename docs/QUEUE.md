# Queue System

TinyClaw uses a SQLite-backed queue (`tinyclaw.db`) to coordinate message processing across multiple channels and agents. Messages are stored in a `messages` table (incoming) and `responses` table (outgoing), with atomic transactions replacing the previous file-based approach.

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
                     │ enqueueMessage()
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                   ~/.tinyclaw/tinyclaw.db                     │
│                                                              │
│  messages table                    responses table           │
│  status: pending → processing →   status: pending → acked   │
│          completed / dead                                    │
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

## Database Schema

The queue lives in `~/.tinyclaw/tinyclaw.db` (SQLite, WAL mode):

### Messages Table (incoming queue)

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-incrementing primary key |
| `message_id` | TEXT | Unique message identifier |
| `channel` | TEXT | Source channel (discord, telegram, web, etc.) |
| `sender` | TEXT | Sender display name |
| `sender_id` | TEXT | Sender platform ID |
| `message` | TEXT | Message content |
| `agent` | TEXT | Target agent (null = default) |
| `files` | TEXT | JSON array of file paths |
| `conversation_id` | TEXT | Team conversation ID (internal messages) |
| `from_agent` | TEXT | Source agent (internal messages) |
| `status` | TEXT | `pending` → `processing` → `completed` / `dead` |
| `retry_count` | INTEGER | Number of failed attempts |
| `last_error` | TEXT | Last error message |
| `claimed_by` | TEXT | Agent that claimed this message |
| `created_at` | INTEGER | Timestamp (ms) |
| `updated_at` | INTEGER | Timestamp (ms) |

### Responses Table (outgoing queue)

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-incrementing primary key |
| `message_id` | TEXT | Original message ID |
| `channel` | TEXT | Target channel for delivery |
| `sender` | TEXT | Original sender |
| `message` | TEXT | Response content |
| `original_message` | TEXT | Original user message |
| `agent` | TEXT | Agent that generated the response |
| `files` | TEXT | JSON array of file paths |
| `status` | TEXT | `pending` → `acked` |
| `created_at` | INTEGER | Timestamp (ms) |
| `acked_at` | INTEGER | Timestamp when channel client acknowledged |

## Message Flow

### 1. Incoming Message

A channel client receives a message and enqueues it:

```typescript
enqueueMessage({
    channel: 'discord',
    sender: 'Alice',
    senderId: 'user_12345',
    message: '@coder fix the authentication bug',
    messageId: 'discord_msg_123',
    files: ['/path/to/screenshot.png'],
});
```

This inserts a row into `messages` with `status = 'pending'` and emits a
`message:enqueued` event for instant pickup.

### 2. Processing

The queue processor picks up messages via two mechanisms:

- **Event-driven**: `queueEvents.on('message:enqueued')` — instant for in-process messages
- **Polling fallback**: Every 500ms — catches cross-process messages from channel clients

For each pending agent, the processor calls `claimNextMessage(agentId)`:

```typescript
// Atomic claim using BEGIN IMMEDIATE transaction
const msg = claimNextMessage('coder');
// Sets status = 'processing', claimed_by = 'coder'
```

This prevents race conditions — only one processor can claim a message.

### 3. Agent Processing

Each agent has its own promise chain for sequential processing:

```typescript
// Messages to same agent = sequential (preserve conversation order)
agentChain: msg1 → msg2 → msg3

// Different agents = parallel (don't block each other)
@coder:     msg1 ──┐
@writer:    msg1 ──┼─→ All run concurrently
@assistant: msg1 ──┘
```

### 4. Response

After the AI responds, the processor writes to the responses table:

```typescript
enqueueResponse({
    channel: 'discord',
    sender: 'Alice',
    message: "I've identified the issue in auth.ts:42...",
    originalMessage: '@coder fix the authentication bug',
    messageId: 'discord_msg_123',
    agent: 'coder',
    files: ['/path/to/fix.patch'],
});
```

The original message is marked `status = 'completed'`.

### 5. Channel Delivery

Channel clients poll for responses:

```typescript
const responses = getResponsesForChannel('discord');
for (const response of responses) {
    await sendToUser(response);
    ackResponse(response.id);  // marks status = 'acked'
}
```

## Error Handling & Retry

### Retry Logic

When processing fails, `failMessage()` increments `retry_count`:

```
Attempt 1: fails → retry_count = 1, status = 'pending'
Attempt 2: fails → retry_count = 2, status = 'pending'
...
Attempt 5: fails → retry_count = 5, status = 'dead'
```

Messages that exhaust retries (default: 5) are marked `status = 'dead'`.

### Dead-Letter Management

Dead messages can be inspected and managed via the API:

```
GET    /api/queue/dead           → list dead messages
POST   /api/queue/dead/:id/retry → reset retry count, re-queue
DELETE /api/queue/dead/:id       → permanently delete
```

### Stale Message Recovery

Messages stuck in `processing` (e.g., from a crash) are automatically
recovered every 5 minutes:

```typescript
recoverStaleMessages(10 * 60 * 1000);  // anything processing > 10 min
```

## Parallel Processing

### How It Works

Each agent has its own **promise chain** that processes messages sequentially:

```typescript
const agentProcessingChains = new Map<string, Promise<void>>();
```

**Example: 3 messages sent simultaneously**

```
@coder fix bug 1     [████████████████] 30s
@writer docs         [██████████] 20s ← concurrent!
@assistant help      [████████] 15s   ← concurrent!
Total: 30 seconds (2.2x faster vs 65s sequential)
```

Messages to the **same agent** remain sequential:

```
@coder fix bug 1     [████] 10s
@coder fix bug 2             [████] 10s  ← waits for bug 1
@writer docs         [██████] 15s        ← parallel with both
```

## Real-Time Events

The queue processor emits events via an in-memory listener system. The API
server broadcasts these over SSE at `GET /api/events/stream`.

| Event | Description |
|-------|-------------|
| `message_received` | New message picked up |
| `agent_routed` | Message routed to agent |
| `chain_step_start` | Agent begins processing |
| `chain_step_done` | Agent finished (includes response) |
| `response_ready` | Response enqueued for delivery |
| `processor_start` | Queue processor started |

The TUI visualizer and web dashboard both consume SSE for live updates.

## API Endpoints

The API server runs on port 3777 (configurable via `TINYCLAW_API_PORT`):

| Endpoint | Description |
|----------|-------------|
| `POST /api/message` | Enqueue a message |
| `GET /api/queue/status` | Queue depth (pending, processing, dead) |
| `GET /api/responses` | Recent responses |
| `GET /api/queue/dead` | Dead messages |
| `POST /api/queue/dead/:id/retry` | Retry a dead message |
| `DELETE /api/queue/dead/:id` | Delete a dead message |
| `GET /api/events/stream` | SSE event stream |

## Maintenance

Periodic cleanup tasks run automatically:

- **Stale message recovery**: Every 5 minutes (messages stuck in `processing` > 10 min)
- **Acked response pruning**: Every hour (responses acked > 24h ago)
- **Conversation TTL**: Every 30 minutes (team conversations older than 30 min)

## Debugging

### Check Queue Status

```bash
# Via API
curl http://localhost:3777/api/queue/status | jq

# View queue logs
tinyclaw logs queue
```

### Common Issues

**Messages not processing:**
- Queue processor not running → `tinyclaw status`
- Check logs → `tinyclaw logs queue`

**Messages stuck in processing:**
- Will auto-recover after 10 minutes
- Or restart: `tinyclaw restart`

**Dead messages accumulating:**
- Check via API: `curl http://localhost:3777/api/queue/dead | jq`
- Retry: `curl -X POST http://localhost:3777/api/queue/dead/123/retry`

## See Also

- [AGENTS.md](AGENTS.md) - Agent configuration and management
- [TEAMS.md](TEAMS.md) - Team collaboration and message passing
- [README.md](../README.md) - Main project documentation
- [src/lib/queue-db.ts](../src/lib/queue-db.ts) - Queue implementation
- [src/queue-processor.ts](../src/queue-processor.ts) - Processing logic
