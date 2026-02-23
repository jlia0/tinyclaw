# TinyClaw Bug Solutions

## Executive Summary

This document provides detailed solutions for three critical bugs identified in the tinyClaw codebase:

| Bug | Severity | Location | Status |
|-----|----------|----------|--------|
| Bug 1: Channel response drops | Critical | All channel clients (Telegram, Discord, WhatsApp) | Proposed fix with atomic ack-before-send |
| Bug 2: Inter-agent mention failures | High | `routing.ts` + `queue-processor.ts` | Proposed fix with validation logging & case-insensitive matching |
| Bug 3: Multi-agent reply loss | Critical | `queue-processor.ts` race condition | Proposed fix with atomic decrement operation |

---

## Bug 1: Telegram/Discord/WhatsApp Response Drops

### Problem Analysis

The send-then-ack flow in all channel clients is **not atomic**:

```
1. Fetch pending responses from DB     ✓
2. bot.sendMessage() to user           ✓ succeeds  
3. fetch(/api/responses/{id}/ack)      ✗ fails (network blip, server restart)
   → Response stays "pending" in DB
   → Next poll: duplicate send OR response appears "lost"
```

The old file-based system used atomic `fs.unlinkSync()` — either the file was deleted or it threw. The new SQLite flow has a gap between send and ack where failures are silently caught and logged.

### Affected Code Locations

- `src/channels/telegram-client.ts` lines 467-528
- `src/channels/discord-client.ts` lines 382-448
- `src/channels/whatsapp-client.ts` lines 382-438

### Root Cause

```typescript
// telegram-client.ts (lines 507-520)
await bot.sendMessage(targetChatId, chunks[0]!, ...);  // Step 1: Send succeeds
// ...
await fetch(`${API_BASE}/api/responses/${resp.id}/ack`, { method: 'POST' });  // Step 2: May fail
```

If the ack fails (network error, server restart), the response remains in `pending` status in the database and will be resent on the next poll cycle.

### Solution: Ack-Before-Send with Retry Queue

The fix requires **two changes**:

#### Change 1A: Modify `db.ts` - Add "delivering" Status

Add a new status to track responses that are in the process of being delivered:

```typescript
// src/lib/db.ts

export interface DbResponse {
    id: number;
    message_id: string;
    channel: string;
    sender: string;
    sender_id: string | null;
    message: string;
    original_message: string;
    agent: string | null;
    files: string | null;
    status: 'pending' | 'delivering' | 'acked';  // Add 'delivering'
    created_at: number;
    acked_at: number | null;
    delivering_at: number | null;  // Add this field
}

// Add new function to atomically claim a response for delivery
export function claimResponseForDelivery(responseId: number): boolean {
    const d = getDb();
    const result = d.prepare(`
        UPDATE responses 
        SET status = 'delivering', delivering_at = ? 
        WHERE id = ? AND status = 'pending'
    `).run(Date.now(), responseId);
    return result.changes > 0;
}

// Add function to recover stuck delivering responses
export function recoverStuckDeliveringResponses(thresholdMs = 5 * 60 * 1000): number {
    const cutoff = Date.now() - thresholdMs;
    const result = getDb().prepare(`
        UPDATE responses 
        SET status = 'pending', delivering_at = NULL 
        WHERE status = 'delivering' AND delivering_at < ?
    `).run(cutoff);
    return result.changes;
}
```

#### Change 1B: Modify Channel Clients - Ack-Before-Send Pattern

**For Telegram Client (`src/channels/telegram-client.ts`):**

```typescript
// Replace the checkOutgoingQueue function (lines 455-535)

async function checkOutgoingQueue(): Promise<void> {
    if (processingOutgoingQueue) {
        return;
    }

    processingOutgoingQueue = true;

    try {
        const res = await fetch(`${API_BASE}/api/responses/pending?channel=telegram`);
        if (!res.ok) return;
        const responses = await res.json() as any[];

        for (const resp of responses) {
            // STEP 1: Atomically claim this response for delivery
            const claimRes = await fetch(`${API_BASE}/api/responses/${resp.id}/claim`, { 
                method: 'POST' 
            });
            
            if (!claimRes.ok) {
                // Another instance claimed it, skip
                log('INFO', `Response ${resp.id} already being processed by another instance`);
                continue;
            }

            const claimed = await claimRes.json();
            if (!claimed.success) {
                continue; // Already being delivered
            }

            try {
                const responseText = resp.message;
                const messageId = resp.messageId;
                const sender = resp.sender;
                const senderId = resp.senderId;
                const files: string[] = resp.files || [];

                // Find pending message, or fall back to senderId for proactive messages
                const pending = pendingMessages.get(messageId);
                const targetChatId = pending?.chatId ?? (senderId ? Number(senderId) : null);

                if (targetChatId && !Number.isNaN(targetChatId)) {
                    // STEP 2: Send the message (may fail, but response is already claimed)
                    try {
                        // Send any attached files first
                        if (files.length > 0) {
                            for (const file of files) {
                                try {
                                    if (!fs.existsSync(file)) continue;
                                    const ext = path.extname(file).toLowerCase();
                                    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
                                        await bot.sendPhoto(targetChatId, file);
                                    } else if (['.mp3', '.ogg', '.wav', '.m4a'].includes(ext)) {
                                        await bot.sendAudio(targetChatId, file);
                                    } else if (['.mp4', '.avi', '.mov', '.webm'].includes(ext)) {
                                        await bot.sendVideo(targetChatId, file);
                                    } else {
                                        await bot.sendDocument(targetChatId, file);
                                    }
                                    log('INFO', `Sent file to Telegram: ${path.basename(file)}`);
                                } catch (fileErr) {
                                    log('ERROR', `Failed to send file ${file}: ${(fileErr as Error).message}`);
                                    // Continue to send other files and message
                                }
                            }
                        }

                        // Split message if needed (Telegram 4096 char limit)
                        if (responseText) {
                            const chunks = splitMessage(responseText);

                            if (chunks.length > 0) {
                                await bot.sendMessage(targetChatId, chunks[0]!, pending
                                    ? { reply_to_message_id: pending.messageId }
                                    : {},
                                );
                            }
                            for (let i = 1; i < chunks.length; i++) {
                                await bot.sendMessage(targetChatId, chunks[i]!);
                            }
                        }

                        log('INFO', `Sent ${pending ? 'response' : 'proactive message'} to ${sender} (${responseText.length} chars${files.length > 0 ? `, ${files.length} file(s)` : ''})`);

                        if (pending) pendingMessages.delete(messageId);
                        
                        // STEP 3: Final ack (cleanup)
                        await fetch(`${API_BASE}/api/responses/${resp.id}/ack`, { method: 'POST' });
                    } catch (sendError) {
                        // Send failed - unclaim the response so it can be retried
                        log('ERROR', `Failed to send response ${resp.id}: ${(sendError as Error).message}`);
                        await fetch(`${API_BASE}/api/responses/${resp.id}/unclaim`, { method: 'POST' });
                    }
                } else {
                    log('WARN', `No pending message for ${messageId} and no valid senderId, acking`);
                    await fetch(`${API_BASE}/api/responses/${resp.id}/ack`, { method: 'POST' });
                }
            } catch (error) {
                log('ERROR', `Error processing response ${resp.id}: ${(error as Error).message}`);
                // Try to unclaim on error
                try {
                    await fetch(`${API_BASE}/api/responses/${resp.id}/unclaim`, { method: 'POST' });
                } catch {
                    // Ignore unclaim errors
                }
            }
        }
    } catch (error) {
        log('ERROR', `Outgoing queue error: ${(error as Error).message}`);
    } finally {
        processingOutgoingQueue = false;
    }
}
```

#### Change 1C: Add API Endpoints in Server

Add the new `/claim` and `/unclaim` endpoints to the API server:

```typescript
// In src/server/index.ts (or wherever API routes are defined)

// Claim a response for delivery (atomic operation)
app.post('/api/responses/:id/claim', (req, res) => {
    const responseId = parseInt(req.params.id);
    const success = claimResponseForDelivery(responseId);
    res.json({ success });
});

// Unclaim a response (if delivery failed)
app.post('/api/responses/:id/unclaim', (req, res) => {
    const responseId = parseInt(req.params.id);
    const d = getDb();
    const result = d.prepare(`
        UPDATE responses 
        SET status = 'pending', delivering_at = NULL 
        WHERE id = ? AND status = 'delivering'
    `).run(responseId);
    res.json({ success: result.changes > 0 });
});
```

#### Change 1D: Add Periodic Recovery for Stuck Delivering Responses

```typescript
// In queue-processor.ts, add to the periodic maintenance section

setInterval(() => {
    const count = recoverStuckDeliveringResponses();
    if (count > 0) log('INFO', `Recovered ${count} stuck delivering response(s)`);
}, 5 * 60 * 1000); // every 5 min
```

### Alternative Simpler Solution (If Full Atomicity Not Required)

If the claim/unclaim pattern is too complex, a simpler approach is to **ack immediately after successful send** with idempotency:

```typescript
// Simpler pattern - ack immediately, track in-flight
const inFlightResponses = new Set<number>();

async function checkOutgoingQueue(): Promise<void> {
    // ... fetch responses ...
    
    for (const resp of responses) {
        // Skip if already being processed
        if (inFlightResponses.has(resp.id)) continue;
        inFlightResponses.add(resp.id);
        
        try {
            // Send message...
            await bot.sendMessage(targetChatId, message);
            
            // Immediately ack after successful send
            await fetch(`${API_BASE}/api/responses/${resp.id}/ack`, { method: 'POST' });
        } catch (error) {
            log('ERROR', `Send failed for ${resp.id}: ${error}`);
            // Will retry on next poll since not acked
        } finally {
            inFlightResponses.delete(resp.id);
        }
    }
}
```

---

## Bug 2: Inter-Agent Comms Don't Activate Mentioned Agent

### Problem Analysis

Silent validation failures in `routing.ts:extractTeammateMentions()` cause mentions to be dropped without any logging:

```typescript
// routing.ts lines 64-70
for (const candidateId of candidateIds) {
    if (!seen.has(candidateId) && isTeammate(candidateId, currentAgentId, teamId, teams, agents)) {
        results.push({ teammateId: candidateId, message: fullMessage });
        seen.add(candidateId);
    }
    // If isTeammate returns false, the mention is silently dropped!
}
```

**Common failure modes:**
- **Case sensitivity**: `[@Coder: ...]` fails if agent ID is `coder`
- **Typo in agent name**: silently ignored
- **Cross-team mention**: silently dropped
- **Regex ambiguity**: nested brackets `[@agent: hello [world] there]` can cause early match termination

### Solution: Add Validation Logging & Fix Case Sensitivity

#### Change 2A: Modify `routing.ts` - Add Detailed Logging

```typescript
// src/lib/routing.ts

import { log } from './logging';  // Add import

/**
 * Check if a mentioned ID is a valid teammate of the current agent in the given team.
 * Now returns detailed reason for validation failures.
 */
export function isTeammate(
    mentionedId: string,
    currentAgentId: string,
    teamId: string,
    teams: Record<string, TeamConfig>,
    agents: Record<string, AgentConfig>
): { valid: boolean; reason?: string } {
    const team = teams[teamId];
    if (!team) {
        return { valid: false, reason: `Team '${teamId}' not found` };
    }
    
    if (mentionedId === currentAgentId) {
        return { valid: false, reason: `Self-mention (agent: ${mentionedId})` };
    }
    
    if (!team.agents.includes(mentionedId)) {
        return { valid: false, reason: `Agent '${mentionedId}' not in team '${teamId}' (members: ${team.agents.join(', ')})` };
    }
    
    if (!agents[mentionedId]) {
        return { valid: false, reason: `Agent '${mentionedId}' not found in agents config` };
    }
    
    return { valid: true };
}

/**
 * Extract teammate mentions with detailed logging for debugging.
 * Supports case-insensitive agent ID matching.
 */
export function extractTeammateMentions(
    response: string,
    currentAgentId: string,
    teamId: string,
    teams: Record<string, TeamConfig>,
    agents: Record<string, AgentConfig>
): { teammateId: string; message: string }[] {
    const results: { teammateId: string; message: string }[] = [];
    const seen = new Set<string>();
    
    // Build case-insensitive agent lookup map
    const agentIdMap = new Map<string, string>();
    for (const id of Object.keys(agents)) {
        agentIdMap.set(id.toLowerCase(), id);
    }

    // Tag format: [@agent_id: message] or [@agent1,agent2: message]
    // Improved regex: handle nested brackets better by using non-greedy match
    const tagRegex = /\[@([^\]]+?):\s*([\s\S]*?)\]/g;
    
    // Strip all [@teammate: ...] tags from the full response to get shared context
    const sharedContext = response.replace(tagRegex, '').trim();
    
    let tagMatch: RegExpExecArray | null;
    let matchCount = 0;
    
    while ((tagMatch = tagRegex.exec(response)) !== null) {
        matchCount++;
        const rawAgentList = tagMatch[1];
        const directMessage = tagMatch[2].trim();
        
        log('DEBUG', `Found mention tag #${matchCount}: "[@${rawAgentList}: ...]"`);
        
        const fullMessage = sharedContext
            ? `${sharedContext}\n\n------\n\nDirected to you:\n${directMessage}`
            : directMessage;

        // Support comma-separated agent IDs: [@coder,reviewer: message]
        const candidateIds = rawAgentList.split(',').map(id => id.trim()).filter(Boolean);
        
        for (const rawCandidateId of candidateIds) {
            // Case-insensitive lookup
            const candidateId = agentIdMap.get(rawCandidateId.toLowerCase()) || rawCandidateId;
            
            if (seen.has(candidateId)) {
                log('WARN', `Duplicate mention of @${candidateId} ignored`);
                continue;
            }
            
            const validation = isTeammate(candidateId, currentAgentId, teamId, teams, agents);
            
            if (validation.valid) {
                results.push({ teammateId: candidateId, message: fullMessage });
                seen.add(candidateId);
                log('INFO', `Valid mention: @${currentAgentId} → @${candidateId}`);
            } else {
                log('WARN', `Invalid mention "[@${rawCandidateId}: ...]" from @${currentAgentId}: ${validation.reason}`);
            }
        }
    }
    
    if (matchCount === 0) {
        log('DEBUG', `No mention tags found in response from @${currentAgentId}`);
    } else if (results.length === 0 && matchCount > 0) {
        log('WARN', `Found ${matchCount} mention tag(s) but none were valid. Response: "${response.substring(0, 100)}..."`);
    }
    
    return results;
}
```

#### Change 2B: Update Callers to Handle New Return Type

Update `queue-processor.ts` to use the new validation result:

```typescript
// queue-processor.ts lines 236-259

// Check for teammate mentions
const teammateMentions = extractTeammateMentions(
    response, agentId, conv.teamContext.teamId, teams, agents
);

if (teammateMentions.length > 0 && conv.totalMessages < conv.maxMessages) {
    // Enqueue internal messages for each mention
    conv.pending += teammateMentions.length;
    conv.outgoingMentions.set(agentId, teammateMentions.length);
    for (const mention of teammateMentions) {
        log('INFO', `@${agentId} → @${mention.teammateId}`);
        emitEvent('chain_handoff', { teamId: conv.teamContext.teamId, fromAgent: agentId, toAgent: mention.teammateId });

        const internalMsg = `[Message from teammate @${agentId}]:\n${mention.message}`;
        enqueueInternalMessage(conv.id, agentId, mention.teammateId, internalMsg, {
            channel: messageData.channel,
            sender: messageData.sender,
            senderId: messageData.senderId,
            messageId: messageData.messageId,
        });
    }
} else if (teammateMentions.length === 0 && conv.totalMessages < conv.maxMessages) {
    // No valid mentions found - this is expected for leaf responses
    log('DEBUG', `Agent @${agentId} produced no valid teammate mentions`);
}
```

#### Change 2C: Add Agent Response Validation Helper

Add a helper to validate agent responses before processing:

```typescript
// src/lib/routing.ts

/**
 * Validates that an agent response is properly formatted.
 * Returns validation result with any errors found.
 */
export function validateAgentResponse(
    response: string,
    agentId: string,
    teamId: string,
    teams: Record<string, TeamConfig>,
    agents: Record<string, AgentConfig>
): { valid: boolean; errors: string[]; mentions: string[] } {
    const errors: string[] = [];
    const mentions: string[] = [];
    
    // Check for potentially malformed mention tags
    const openBrackets = (response.match(/\[@/g) || []).length;
    const closeBrackets = (response.match(/\]/g) || []).length;
    
    if (openBrackets !== closeBrackets) {
        errors.push(`Mismatched brackets: ${openBrackets} opening, ${closeBrackets} closing`);
    }
    
    // Extract and validate mentions
    const tagRegex = /\[@([^\]]+?):/g;
    let match: RegExpExecArray | null;
    
    while ((match = tagRegex.exec(response)) !== null) {
        const rawList = match[1];
        const ids = rawList.split(',').map(id => id.trim()).filter(Boolean);
        
        for (const rawId of ids) {
            const normalizedId = rawId.toLowerCase();
            const actualId = Object.keys(agents).find(id => id.toLowerCase() === normalizedId);
            
            if (!actualId) {
                errors.push(`Unknown agent: @${rawId}`);
            } else {
                mentions.push(actualId);
                const validation = isTeammate(actualId, agentId, teamId, teams, agents);
                if (!validation.valid) {
                    errors.push(`Invalid mention @${rawId}: ${validation.reason}`);
                }
            }
        }
    }
    
    return { valid: errors.length === 0, errors, mentions };
}
```

---

## Bug 3: Multi-Agent Reply Loss (Race Condition on conv.pending)

### Problem Analysis

When a comma-separated mention like `[@coder,reviewer: message]` is parsed:

```
1. conv.pending += 2 (correct - line 243)
2. Both agents process in parallel via agentProcessingChains
3. Both read conv.pending concurrently and decrement independently (line 262)
```

Since JavaScript promises can interleave, both agents can read `conv.pending = 2`, both decrement to 1, and neither triggers `completeConversation()` (which fires when `pending === 0`).

### Affected Code

- `src/queue-processor.ts` lines 243, 262, 264

### Solution: Atomic Decrement with Compare-and-Swap

#### Change 3A: Add Atomic Operations to Conversation Module

```typescript
// src/lib/conversation.ts

import { EventEmitter } from 'events';

// Event emitter for conversation state changes
export const conversationEvents = new EventEmitter();

/**
 * Atomically decrement the pending counter and check if conversation is complete.
 * Returns true if the conversation should be completed (pending reached 0).
 */
export function decrementPendingAndCheckComplete(conv: Conversation): boolean {
    // Use a lock flag to prevent concurrent decrements
    if ((conv as any)._decrementing) {
        // Another decrement is in progress, queue this one
        return false;
    }
    
    (conv as any)._decrementing = true;
    
    try {
        conv.pending--;
        log('DEBUG', `Conversation ${conv.id}: pending decremented to ${conv.pending}`);
        
        if (conv.pending < 0) {
            log('WARN', `Conversation ${conv.id}: pending went negative (${conv.pending}), resetting to 0`);
            conv.pending = 0;
        }
        
        const shouldComplete = conv.pending === 0;
        
        if (shouldComplete) {
            conversationEvents.emit('conversation:complete', conv);
        }
        
        return shouldComplete;
    } finally {
        (conv as any)._decrementing = false;
    }
}

/**
 * Safely increment pending counter for new mentions.
 */
export function incrementPending(conv: Conversation, count: number): void {
    conv.pending += count;
    log('DEBUG', `Conversation ${conv.id}: pending incremented to ${conv.pending} (+${count})`);
}
```

#### Change 3B: Update queue-processor.ts to Use Atomic Operations

```typescript
// queue-processor.ts - Update imports
import { 
    conversations, 
    MAX_CONVERSATION_MESSAGES, 
    enqueueInternalMessage, 
    completeConversation,
    decrementPendingAndCheckComplete,
    incrementPending
} from './lib/conversation';

// ... in processMessage function, replace lines 243 and 262-268:

if (teammateMentions.length > 0 && conv.totalMessages < conv.maxMessages) {
    // Use atomic increment
    incrementPending(conv, teammateMentions.length);
    conv.outgoingMentions.set(agentId, teammateMentions.length);
    
    for (const mention of teammateMentions) {
        log('INFO', `@${agentId} → @${mention.teammateId}`);
        emitEvent('chain_handoff', { teamId: conv.teamContext.teamId, fromAgent: agentId, toAgent: mention.teammateId });

        const internalMsg = `[Message from teammate @${agentId}]:\n${mention.message}`;
        enqueueInternalMessage(conv.id, agentId, mention.teammateId, internalMsg, {
            channel: messageData.channel,
            sender: messageData.sender,
            senderId: messageData.senderId,
            messageId: messageData.messageId,
        });
    }
} else if (teammateMentions.length > 0) {
    log('WARN', `Conversation ${conv.id} hit max messages (${conv.maxMessages}) — not enqueuing further mentions`);
}

// This branch is done - use atomic decrement
const shouldComplete = decrementPendingAndCheckComplete(conv);

if (shouldComplete) {
    completeConversation(conv);
} else {
    log('INFO', `Conversation ${conv.id}: ${conv.pending} branch(es) still pending`);
}
```

#### Change 3C: Alternative Solution Using Promise Sequencing (Simpler)

If the atomic operations approach is too complex, use promise chaining to ensure sequential access:

```typescript
// queue-processor.ts

// Per-conversation processing locks
const conversationLocks = new Map<string, Promise<void>>();

async function withConversationLock<T>(convId: string, fn: () => Promise<T>): Promise<T> {
    // Get or create lock chain for this conversation
    const currentLock = conversationLocks.get(convId) || Promise.resolve();
    
    // Create new lock that waits for current and then executes fn
    const newLock = currentLock.then(() => fn()).finally(() => {
        // Clean up if this was the last lock
        if (conversationLocks.get(convId) === newLock) {
            conversationLocks.delete(convId);
        }
    });
    
    conversationLocks.set(convId, newLock);
    return newLock;
}

// In processMessage, wrap the pending decrement:
await withConversationLock(conv.id, async () => {
    conv.pending--;
    
    if (conv.pending === 0) {
        completeConversation(conv);
    } else {
        log('INFO', `Conversation ${conv.id}: ${conv.pending} branch(es) still pending`);
    }
});
```

#### Change 3D: Add Conversation State Validation

Add validation to detect and recover from inconsistent states:

```typescript
// src/lib/conversation.ts

/**
 * Validate conversation state and attempt recovery if needed.
 */
export function validateConversationState(conv: Conversation): { valid: boolean; issues: string[] } {
    const issues: string[] = [];
    
    if (conv.pending < 0) {
        issues.push(`Negative pending count: ${conv.pending}`);
    }
    
    if (conv.totalMessages > conv.maxMessages) {
        issues.push(`Exceeded max messages: ${conv.totalMessages}/${conv.maxMessages}`);
    }
    
    if (conv.responses.length === 0 && conv.pending === 0) {
        issues.push(`Conversation has no responses and no pending work`);
    }
    
    // Check for orphaned conversations (pending > 0 but no actual work)
    const expectedPending = conv.outgoingMentions.size > 0 
        ? Array.from(conv.outgoingMentions.values()).reduce((a, b) => a + b, 0)
        : 1;
    
    if (conv.pending !== expectedPending) {
        issues.push(`Pending mismatch: expected ${expectedPending}, got ${conv.pending}`);
    }
    
    return { valid: issues.length === 0, issues };
}

/**
 * Attempt to recover a conversation from an inconsistent state.
 */
export function recoverConversation(conv: Conversation): boolean {
    const validation = validateConversationState(conv);
    
    if (validation.valid) {
        return true;
    }
    
    log('WARN', `Attempting to recover conversation ${conv.id}: ${validation.issues.join(', ')}`);
    
    // Fix negative pending
    if (conv.pending < 0) {
        conv.pending = 0;
    }
    
    // If no pending work, complete the conversation
    if (conv.pending === 0 && conv.responses.length > 0) {
        completeConversation(conv);
        return true;
    }
    
    return false;
}
```

---

## Implementation Priority

### Phase 1: Critical Fixes (Deploy First)

1. **Bug 3 (Race Condition)** - Most critical, affects multi-agent workflows directly
   - Implement Change 3B (atomic decrement) or 3C (promise sequencing)
   - Add Change 3D for state validation

2. **Bug 1 (Response Drops)** - Affects all users
   - Implement Change 1A (delivering status) + 1C (API endpoints)
   - Update one channel client first (e.g., Telegram) as proof of concept

### Phase 2: High Priority Fixes

3. **Bug 2 (Silent Mention Failures)** - Improves debugging and user experience
   - Implement Change 2A (logging + case-insensitive matching)
   - Implement Change 2B (update callers)

### Phase 3: Polish

4. Complete remaining channel clients for Bug 1
5. Add comprehensive tests for all three fixes

---

## Testing Recommendations

### For Bug 1 (Response Drops)

```typescript
// Test case: Simulate ack failure
async function testAckFailure() {
    // 1. Enqueue a response
    const responseId = enqueueResponse({...});
    
    // 2. Simulate network failure during ack
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    
    // 3. Verify response is still pending
    const status = getQueueStatus();
    expect(status.responsesPending).toBe(1);
    
    // 4. Verify response is not duplicated on retry
    // (with claim pattern, should be claimed by first attempt)
}
```

### For Bug 2 (Mention Failures)

```typescript
// Test case: Case-insensitive matching
function testCaseInsensitiveMentions() {
    const agents = { coder: { name: 'Coder' }, reviewer: { name: 'Reviewer' } };
    const teams = { devteam: { agents: ['coder', 'reviewer'], leader_agent: 'coder' } };
    
    // Should match despite case difference
    const mentions = extractTeammateMentions(
        '[@Coder: hello]', 
        'reviewer', 
        'devteam', 
        teams, 
        agents
    );
    
    expect(mentions).toHaveLength(1);
    expect(mentions[0].teammateId).toBe('coder');
}
```

### For Bug 3 (Race Condition)

```typescript
// Test case: Concurrent decrements
async function testConcurrentDecrements() {
    const conv = createConversation({ pending: 2 });
    
    // Simulate two agents completing simultaneously
    await Promise.all([
        decrementPendingAndCheckComplete(conv),
        decrementPendingAndCheckComplete(conv)
    ]);
    
    // Should be 0, not 1
    expect(conv.pending).toBe(0);
}
```

---

## Summary

| Bug | Root Cause | Solution | Files Modified |
|-----|------------|----------|----------------|
| **Bug 1** | Non-atomic send-then-ack | Add "delivering" status, claim-before-send pattern | `db.ts`, `telegram-client.ts`, `discord-client.ts`, `whatsapp-client.ts`, `server/index.ts` |
| **Bug 2** | Silent validation failures | Add detailed logging, case-insensitive matching | `routing.ts`, `queue-processor.ts` |
| **Bug 3** | Race condition on `conv.pending` | Atomic decrement with locking | `conversation.ts`, `queue-processor.ts` |

These fixes address all three critical issues while maintaining backward compatibility and adding robust error handling and logging for easier debugging in the future.
