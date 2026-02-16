# Message Patterns

Team communication in TinyClaw uses an actor model: each agent has its own mailbox (per-agent promise chain), communicates only by sending messages (queue files), and processes one message at a time. There is no central orchestrator.

## How it works

```
User: "@dev host an all hands meeting"
         │
         ▼
  ┌──────────────┐
  │   @manager   │  (team leader)
  │   responds   │
  └──┬───┬───┬───┘
     │   │   │
     │   │   └─── [@tester: share your testing update]
     │   └─────── [@reviewer: share your review status]
     └─────────── [@coder: share what you're working on]
                        │
              3 messages enqueued in QUEUE_INCOMING
              each processed by its own agent
```

1. User sends a message to a team (or an agent in a team)
2. The leader agent is invoked and responds
3. Any `[@teammate: message]` tags in the response become new messages in `QUEUE_INCOMING`
4. The queue processor picks them up naturally on the next poll cycle
5. Each agent processes its message via its own per-agent promise chain (parallel across agents)
6. If an agent's response mentions more teammates, those become new messages too
7. When no more messages are pending (`conv.pending === 0`), all responses are aggregated and sent to the user

## Shared context

Text outside `[@agent: ...]` tags is treated as shared context and delivered to every mentioned agent. Agent-specific instructions go inside the tags.

```
We're doing a standup. Sprint ends Friday, 3 open bugs.
Reply with: (1) status (2) blockers (3) next step.

[@coder: Also list any PRs you have open.]
[@reviewer: Also flag any PRs waiting on you.]
[@tester: Also report test coverage for the auth module.]
```

Each agent receives the full shared context + their directed message.

## Message flow patterns

### Sequential handoff

One agent mentions one teammate. The chain continues linearly.

```
@manager → [@coder: fix the auth bug]
  │
  ▼
@coder → [@reviewer: please review my fix]
  │
  ▼
@reviewer → (no mentions, done)
```

Pending count: `1 → 1 → 1 → 0 (complete)`

### Fan-out

One agent mentions multiple teammates. All are invoked in parallel.

```
@manager → [@coder: ...] [@reviewer: ...] [@tester: ...]
  │
  ├── @coder   (processes independently)
  ├── @reviewer (processes independently)
  └── @tester  (processes independently)
```

Pending count: `1 → 3 → 2 → 1 → 0 (complete)`

### Backflow

Agents can message back to whoever mentioned them. This is natural — the `[@manager: ...]` tag becomes a new message for manager.

```
@manager → [@coder: what's your status?]
  │
  ▼
@coder → [@manager: systems operational, no blockers]
  │
  ▼
@manager → (processes coder's response)
```

### Cross-talk

After a fan-out, agents can message each other directly.

```
@manager → [@coder: ...] [@reviewer: ...] [@tester: ...]
  │
  ├── @reviewer → [@coder: check the fail-open behavior]
  ├── @tester   → [@coder: here are the test results]
  └── @coder    → (no mentions)
       │
       ▼
  @coder gets two separate messages (processed sequentially):
    1. From @reviewer
    2. From @tester
```

## Pending response indicator

When an agent is invoked as part of a conversation and other teammates are still processing, the system appends a note:

```
[2 other teammate response(s) are still being processed and will be
delivered when ready. Do not re-mention teammates who haven't responded yet.]
```

This prevents the "re-ask spiral" where an agent keeps mentioning teammates who already have pending messages. The note is informational — agents are trusted to respect it rather than enforced in code.

### Why this matters

Without the indicator, this happens in a standup:

```
Manager fans out to coder, reviewer, tester
Reviewer responds first → [@manager: here's my update]
Manager is invoked with ONLY reviewer's message
Manager says "Still waiting on @coder and @tester"    ← PROBLEM
  → Enqueues ANOTHER message for coder (who already responded!)
  → Enqueues ANOTHER message for tester (who already responded!)
Coder responds: "I already told you!"
Cycle repeats...
```

With the indicator, manager sees `[2 other teammate response(s) are still being processed...]` and knows to wait.

## Conversation lifecycle

### Tracking

Each team interaction creates a `Conversation` object in memory:

| Field | Purpose |
|---|---|
| `pending` | In-flight message count. Incremented when a mention is enqueued, decremented when an agent finishes processing. |
| `responses[]` | All agent responses collected in order of completion. |
| `files` | Accumulated `[send_file:]` paths from all agents. |
| `totalMessages` | Counter for loop protection (max 15). |
| `outgoingMentions` | How many mentions each agent sent (for future batch-read support). |

### Completion

A conversation completes when `pending === 0` — all branches have resolved and no more messages are in flight.

On completion:
1. All responses are aggregated (single response: as-is, multiple: joined with `@agent: response` format)
2. Chat history is saved to `~/.tinyclaw/chats/{team_id}/{timestamp}.md`
3. The aggregated response is written to `QUEUE_OUTGOING` for the user's channel
4. The conversation is cleaned up from memory

### Loop protection

`totalMessages` is capped at 15. When reached, no further mentions are enqueued and active branches resolve naturally.

## Comparison with chain model (previous)

The previous implementation used a centralized `while(true)` loop that orchestrated all agent interactions synchronously.

| | Chain (previous) | Actor model (current) |
|---|---|---|
| **Control flow** | Central `while` loop | Decentralized, queue-driven |
| **Parallelism** | Explicit `Promise.all` | Natural per-agent promise chains |
| **Backflow** | Not supported | Natural — agent mentions sender |
| **Fan-out** | Scatter phase + gather phase | N mentions = N enqueued messages |
| **Completion** | Loop exits | `pending === 0` |
| **New patterns** | New code for each topology | Same logic handles any topology |
