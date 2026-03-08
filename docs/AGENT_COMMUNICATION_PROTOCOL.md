# Agent Communication Protocol Documentation

> TinyClaw SQL-Experiment Branch
> Date: 2026-03-06
> Status: Production Ready

---

## Overview

This document describes the **primitive request-reply protocol** implemented in the sql-experiment branch to solve the "ping pong" message drop problem in multi-agent conversations.

### The Problem

Previously, TinyClaw used fire-and-forget agent handoffs:
```
Agent A responds with "[@coder: do this]"
  → Message queued for coder
  → No guarantee coder receives it
  → No guarantee coder responds
  → No timeout tracking
  → "Ping pong" drops happen silently
```

### The Solution

We implemented a **request-reply pattern with timeouts** - the same primitive approach used in distributed systems since the 1970s:

```
Agent A wants Agent B to do something:
  1. CREATE outstanding request with deadlines
  2. SEND message to B with request_id
  3. WAIT for ACK (B confirms receipt)
     - If no ACK by deadline → retry or escalate
  4. WAIT for RESPONSE (B completes task)
     - If no response by deadline → escalate
  5. MARK request complete
```

---

## Architecture

### Database Schema

#### outstanding_requests Table

```sql
CREATE TABLE outstanding_requests (
    request_id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    from_agent TEXT NOT NULL,
    to_agent TEXT NOT NULL,
    task TEXT NOT NULL,
    status TEXT NOT NULL,        -- pending | acked | responded | failed | escalated
    ack_deadline INTEGER,        -- Unix timestamp (ms)
    response_deadline INTEGER,   -- Unix timestamp (ms)
    retry_count INTEGER,         -- Current retry attempt
    max_retries INTEGER,         -- Default: 5
    created_at INTEGER,          -- Unix timestamp (ms)
    acked_at INTEGER,            -- Unix timestamp (ms) or NULL
    responded_at INTEGER,        -- Unix timestamp (ms) or NULL
    response TEXT,               -- Response content or NULL
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
```

**Indexes:**
- `idx_requests_status` - For timeout checker queries
- `idx_requests_conversation` - For per-conversation lookups
- `idx_requests_to_agent` - For agent-specific queries
- `idx_requests_deadlines` - For deadline-based queries

### State Machine

```
                    +-----------+
                    |  pending  |
                    +-----+-----+
                          |
            +-------------+-------------+
            |                           |
            v                           v
    +-------+--------+          +-------+--------+
    |     acked      |          |     failed     |
    +-------+--------+          +----------------+
            |
    +-------+-------+
    |               |
    v               v
+---+----+    +-----+-----+
|responded|   | escalated |
+---------+   +-----------+
```

**Transitions:**
- `pending` → `acked`: Agent B receives message, calls `acknowledgeRequest()`
- `pending` → `failed`: Permanent error (e.g., agent not found)
- `acked` → `responded`: Agent B completes task, calls `respondToRequest()`
- `acked` → `escalated`: Response deadline expired, human intervention needed

---

## API Reference

### Creating Requests

#### `createOutstandingRequest()`

Creates a new request when agent A asks agent B to do something.

```typescript
function createOutstandingRequest(
    conversationId: string,
    fromAgent: string,
    toAgent: string,
    task: string,
    ackTimeoutMs?: number,      // Default: 5000 (5 seconds)
    responseTimeoutMs?: number  // Default: 300000 (5 minutes)
): string  // Returns request_id
```

**Usage:**
```typescript
const requestId = createOutstandingRequest(
    conv.id,
    'leader',
    'coder',
    'Implement the login feature'
);
```

### Acknowledging Requests

#### `acknowledgeRequest()`

Called when agent B receives the message. Confirms receipt.

```typescript
function acknowledgeRequest(requestId: string): boolean
```

**Returns:** `true` if acknowledged, `false` if request not found or already acked.

**Usage:**
```typescript
// In message processing
const requestMatch = message.match(/^\[REQUEST:([^\]]+)\]\n?/);
if (requestMatch) {
    const requestId = requestMatch[1];
    if (acknowledgeRequest(requestId)) {
        log('INFO', `Request ${requestId} acknowledged`);
    }
}
```

### Responding to Requests

#### `respondToRequest()`

Called when agent B completes the task and responds.

```typescript
function respondToRequest(requestId: string, response: string): boolean
```

**Returns:** `true` if response recorded, `false` if request not found.

**Usage:**
```typescript
// When agent responds
const matchingRequests = pendingRequests.filter(r => 
    r.to_agent === agentId && r.status === 'acked'
);
for (const req of matchingRequests) {
    respondToRequest(req.request_id, response);
}
```

### Timeout Management

#### `getRequestsNeedingRetry()`

Returns requests that haven't been ACKed within deadline.

```typescript
function getRequestsNeedingRetry(): OutstandingRequest[]
```

#### `getRequestsNeedingEscalation()`

Returns requests that were ACKed but haven't been responded within deadline.

```typescript
function getRequestsNeedingEscalation(): OutstandingRequest[]
```

#### `incrementRequestRetry()`

Extends deadline for a retry attempt.

```typescript
function incrementRequestRetry(requestId: string, newDeadline: number): void
```

### Escalation

#### `escalateRequest()`

Marks request as escalated to human.

```typescript
function escalateRequest(requestId: string, reason: string): void
```

Emits `request_escalated` event for monitoring.

### Error Handling

#### `failRequest()`

Marks request as failed when agent errors.

```typescript
function failRequest(requestId: string, reason: string): void
```

Called proactively from `handleTeamError()` to mark requests failed instead of letting them escalate via timeout.

---

## Integration Points

### 1. Message Enqueueing (`conversation.ts`)

When agent A mentions agent B, we:
1. Create outstanding request
2. Add `[REQUEST:xxx]` prefix to message
3. Enqueue message for agent B

```typescript
export function enqueueInternalMessage(
    conversationId: string,
    fromAgent: string,
    targetAgent: string,
    message: string,
    originalData: { ... }
): void {
    // Create tracking request
    const requestId = createOutstandingRequest(
        conversationId,
        fromAgent,
        targetAgent,
        message,
        5000,   // 5s ACK timeout
        300000  // 5min response timeout
    );

    // Include request_id in message
    const messageWithRequestId = `[REQUEST:${requestId}]\n${message}`;

    // Enqueue for target agent
    enqueueMessage({
        ...,
        message: messageWithRequestId,
        ...
    });
}
```

### 2. Message Processing (`queue-processor.ts`)

When agent B receives message:
1. Extract request_id from `[REQUEST:xxx]` prefix
2. Call `acknowledgeRequest()`
3. Remove prefix before sending to agent

```typescript
// In processMessage()
const requestMatch = message.match(/^\[REQUEST:([^\]]+)\]\n?/);
if (requestMatch) {
    const requestId = requestMatch[1];
    if (acknowledgeRequest(requestId)) {
        log('INFO', `Request ${requestId} acknowledged by @${agentId}`);
    }
    message = message.replace(requestMatch[0], '');
}
```

### 3. Response Handling (`queue-processor.ts`)

When agent B responds:
1. Find all matching requests for this agent
2. Mark all as responded

```typescript
// In handleTeamResponse()
const pendingRequests = getPendingRequestsForConversation(conv.id);
const matchingRequests = pendingRequests.filter(
    r => r.to_agent === agentId && r.status === 'acked'
);
for (const req of matchingRequests) {
    respondToRequest(req.request_id, response);
}
```

### 4. Error Handling (`queue-processor.ts`)

When agent B errors:
1. Find all matching requests for this agent
2. Mark all as failed (proactive cleanup)

```typescript
// In handleTeamError()
const pendingRequests = getPendingRequestsForConversation(conv.id);
const matchingRequests = pendingRequests.filter(
    r => r.to_agent === agentId && r.status === 'acked'
);
for (const req of matchingRequests) {
    failRequest(req.request_id, error.message);
}
```

### 5. Timeout Checking (`queue-processor.ts`)

Runs every 30 seconds:

```typescript
async function checkRequestTimeouts(): Promise<void> {
    // Retry: No ACK within deadline
    const needsRetry = getRequestsNeedingRetry();
    for (const req of needsRetry) {
        if (req.retry_count < req.max_retries) {
            incrementRequestRetry(req.request_id, Date.now() + 5000);
        } else {
            escalateRequest(req.request_id, 'Max retries exceeded');
        }
    }
    
    // Escalate: No response after ACK
    const needsEscalation = getRequestsNeedingEscalation();
    for (const req of needsEscalation) {
        escalateRequest(req.request_id, 'Response timeout');
        emitEvent('request_escalated', { ... });
    }
}
```

---

## Configuration

### Timeouts

| Parameter | Default | Description |
|-----------|---------|-------------|
| `ackTimeoutMs` | 5000ms (5s) | Time for agent to acknowledge receipt |
| `responseTimeoutMs` | 300000ms (5min) | Time for agent to respond after ACK |
| `max_retries` | 5 | Max retry attempts before escalation |

### Intervals

| Check | Interval | Description |
|-------|----------|-------------|
| `checkRequestTimeouts()` | 30s | Check for expired ACK/response deadlines |
| `pruneOldRequests()` | 1 hour | Clean up completed requests older than 24h |

---

## Monitoring

### Events Emitted

| Event | Data | When |
|-------|------|------|
| `request_escalated` | `{requestId, conversationId, fromAgent, toAgent, reason}` | Request times out or fails |
| `crash_recovery` | `{conversationId, teamId, stuckForMs, source}` | Stale conversation recovered |

### Log Messages

| Level | Message | When |
|-------|---------|------|
| `INFO` | `Request ${id} acknowledged by @${agent}` | ACK received |
| `INFO` | `Request ${id} completed by @${agent}` | Response received |
| `WARN` | `Request ${id} to @${agent} not acknowledged, retry N/5` | Retry triggered |
| `ERROR` | `Request ${id} to @${agent} timed out after ACK` | Escalation triggered |
| `WARN` | `🔴 CRASH RECOVERY: N conversation(s) stuck...` | Stale recovery |

---

## Design Decisions

### Why Not Use A2A/ACP/ANP?

We evaluated existing protocols (A2A from Google, ACP from IBM, ANP from community) but chose a primitive approach because:

1. **Simplicity**: No external dependencies, no SDK required
2. **Control**: Full control over timeouts, retries, escalation
3. **Integration**: Fits naturally with existing SQLite-based architecture
4. **Debugging**: Simple to trace, log, and understand

### Why 5 Second ACK Timeout?

- Must be > network latency + processing time
- Must be < human patience for "did it work?"
- 5s balances these for local deployments

### Why 5 Minute Response Timeout?

- Must allow for complex agent tasks
- Must not let conversations stall indefinitely
- 5min is 2x typical agent response time

### Why Filter() Not Find() for Multiple Requests?

If agent A asks agent B multiple things, and B responds once, that response addresses all pending requests. Marking all as complete is safer than guessing which one.

---

## Troubleshooting

### Issue: Requests Escalating Immediately

**Cause**: `acknowledgeRequest()` not being called
**Check**: Verify `[REQUEST:xxx]` prefix is being parsed in `processMessage()`

### Issue: Requests Never Complete

**Cause**: `respondToRequest()` not being called
**Check**: Verify `handleTeamResponse()` is finding matching requests

### Issue: Too Many Escalations

**Cause**: Agents genuinely not responding
**Solutions**:
- Increase `responseTimeoutMs` for slow agents
- Check agent logs for errors
- Consider human-in-the-loop for critical tasks

---

## Future Enhancements

### Potential Improvements

1. **Resend on Retry**: Actually resend message, not just extend deadline
2. **Per-Agent Timeouts**: Different timeouts for different agent types
3. **Partial Responses**: Allow agents to send progress updates
4. **Request Cancellation**: Allow canceling pending requests
5. **Metrics**: Track average response times per agent

### Migration Path

If adopting A2A/ACP in future:
- `outstanding_requests` table maps to A2A Task Store
- `request_id` maps to A2A task ID
- Timeout/escalation logic remains similar
- Main change: transport layer (HTTP vs SQLite queue)

---

## References

- Original implementation: commits `dca9f7a` through `91da93d`
- Pattern based on: 1970s-1990s distributed systems RPC
- Similar to: TCP reliable delivery + application timeouts
- Differs from: Fire-and-forget messaging (NATS, simple queues)

---

*Documentation version: 1.0*
*Last updated: 2026-03-06*
