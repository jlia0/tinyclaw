# TinyClaw Bug Fix Patches

This directory contains patches to fix three critical bugs in tinyClaw.

## Bug Summary

| Bug | Description | Severity | Files Affected |
|-----|-------------|----------|----------------|
| **Bug 1** | Channel clients (Telegram/Discord/WhatsApp) randomly fail to return responses due to non-atomic send-then-ack flow | Critical | `db.ts`, `telegram-client.ts`, `discord-client.ts`, `whatsapp-client.ts`, `server/index.ts` |
| **Bug 2** | Inter-agent mentions fail silently due to validation issues (case sensitivity, typos, cross-team) | High | `routing.ts` |
| **Bug 3** | Multi-agent conversations lose replies due to race condition on `conv.pending` counter | Critical | `conversation.ts`, `queue-processor.ts` |

## Patch Files

```
patches/
├── README.md                      # This file
├── bug1-db.patch                  # Database changes for delivering status
├── bug1-telegram.patch            # Telegram client fix (claim-before-send pattern)
├── bug2-routing.patch             # Routing improvements (logging, case-insensitive matching)
├── bug3-conversation.patch        # Conversation locking mechanism
├── bug3-queue-processor.patch     # Queue processor integration with locking
└── server-api.patch               # New API endpoints for claim/unclaim
```

## Installation Order

Apply patches in this order to avoid conflicts:

### Phase 1: Database and Core Infrastructure

```bash
# 1. Database changes (adds 'delivering' status)
patch -p1 < patches/bug1-db.patch

# 2. Server API endpoints (claim/unclaim)
patch -p1 < patches/server-api.patch
```

### Phase 2: Core Logic Fixes

```bash
# 3. Conversation locking mechanism
patch -p1 < patches/bug3-conversation.patch

# 4. Queue processor integration
patch -p1 < patches/bug3-queue-processor.patch

# 5. Routing improvements (logging, case-insensitive matching)
patch -p1 < patches/bug2-routing.patch
```

### Phase 3: Channel Clients

```bash
# 6. Telegram client (as proof of concept)
patch -p1 < patches/bug1-telegram.patch

# Note: Discord and WhatsApp clients need similar fixes
# Apply the same pattern from bug1-telegram.patch to:
# - src/channels/discord-client.ts
# - src/channels/whatsapp-client.ts
```

## Manual Application (If Patches Fail)

If `patch` command fails due to line number differences, apply changes manually by referencing the solution document:

1. See `/mnt/okcomputer/output/tinyclaw-bug-solutions.md` for detailed code changes
2. Copy the relevant sections into your files
3. Ensure all imports are updated

## Verification

After applying patches, verify the fixes:

### Bug 1 Verification

```bash
# Check that the delivering status exists in the database
sqlite3 .tinyclaw/tinyclaw.db ".schema responses"
# Should show: status TEXT CHECK(status IN ('pending', 'delivering', 'acked'))
```

### Bug 2 Verification

```bash
# Check logs for mention validation messages
tail -f .tinyclaw/logs/queue.log | grep -i "mention"
# Should see: "Valid mention: @agent1 → @agent2" or "Invalid mention ..."
```

### Bug 3 Verification

```bash
# Check for race condition debug messages
tail -f .tinyclaw/logs/queue.log | grep -i "pending"
# Should see: "Conversation X: pending incremented to N" and "decremented to N"
```

## Rollback

If you need to rollback, restore from git:

```bash
git checkout -- src/lib/db.ts
git checkout -- src/lib/routing.ts
git checkout -- src/lib/conversation.ts
git checkout -- src/queue-processor.ts
git checkout -- src/channels/telegram-client.ts
# ... restore other modified files
```

## Testing Recommendations

### Test Bug 1 Fix

1. Send a message through Telegram
2. Verify response is received
3. Simulate network failure (if possible)
4. Verify no duplicate responses are sent

### Test Bug 2 Fix

1. Configure a team with multiple agents
2. Send message with mixed-case mention: `[@Coder: help]` where agent ID is `coder`
3. Check logs for validation messages
4. Verify mentioned agent is activated

### Test Bug 3 Fix

1. Configure a team with 2+ agents
2. Send message: `[@agent1,agent2: task]`
3. Both agents should respond
4. Final aggregated response should be sent to user

## Additional Notes

### Discord/WhatsApp Client Fixes

The same pattern from `bug1-telegram.patch` should be applied to:

- `src/channels/discord-client.ts` (lines ~369-455)
- `src/channels/whatsapp-client.ts` (lines ~369-445)

Key changes needed:
1. Add `inFlightResponses` tracking Set
2. Add `deliveringResponses` Map for retry tracking
3. Claim response before sending
4. Track delivery attempts
5. Handle max retry exceeded

### Database Migration

The patches add a new column `delivering_at` to the responses table. For existing databases:

```sql
-- Run this if you get schema errors
ALTER TABLE responses ADD COLUMN delivering_at INTEGER;
```

## Support

For questions or issues with these patches:
1. Check the detailed solution document: `tinyclaw-bug-solutions.md`
2. Review the original bug investigation in the GitHub issue
3. Test changes in a development environment first
