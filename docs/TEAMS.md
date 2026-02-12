# Teams

Teams are named groups of agents that collaborate by passing messages to each other. When an agent responds with a `@teammate` mention, the queue processor automatically invokes that teammate, creating a chain of agent interactions.

## How It Works

```
User: "@dev fix the auth bug"
           │
           ▼
   ┌───────────────┐
   │  Team: @dev   │
   │  Leader: coder│
   └───────┬───────┘
           ▼
   ┌───────────────┐    response mentions @reviewer
   │   @coder      │──────────────────────────────┐
   │  "Fixed bug"  │                               ▼
   └───────────────┘                      ┌───────────────┐
                                          │  @reviewer    │
                                          │  "LGTM!"      │
                                          └───────────────┘
           │
           ▼
   Combined response sent to user:
   @coder: Fixed the bug in auth.ts...
   ---
   @reviewer: Changes look good, approved!
```

### Chain Execution Flow

1. User sends `@team_id message` (or `@agent_id` where agent belongs to a team)
2. Queue processor resolves the team and invokes the **leader agent**
3. Leader's response is scanned for `@teammate` mentions
4. If a teammate is mentioned, that agent is invoked with the previous response as context
5. The chain continues until an agent responds without mentioning a teammate
6. All responses are aggregated and sent back to the user

### Team Context Auto-Detection

Even when messaging an agent directly (e.g., `@coder fix this`), team context is automatically activated if that agent belongs to a team. Teammate mentions in the response will still trigger chain execution.

## Configuration

Teams are stored in `~/.tinyclaw/settings.json`:

```json
{
  "teams": {
    "dev": {
      "name": "Development Team",
      "agents": ["coder", "reviewer", "writer"],
      "leader_agent": "coder"
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `name` | Human-readable display name |
| `agents` | Array of agent IDs (must exist in `agents` config) |
| `leader_agent` | Agent that receives `@team_id` messages first (must be in `agents` array) |

Team IDs and agent IDs share the `@` routing namespace, so they cannot collide. The interactive `team add` wizard enforces this.

## Teammate Mention Formats

Agents can mention teammates in two ways:

### Tag Format (recommended for multiple handoffs)

```
[@reviewer: Please check my changes to auth.ts]
[@writer: Document the new login flow]
```

This allows the agent to send a specific message to each teammate. The tag content becomes the message passed to that teammate.

### Bare Mention (legacy, single handoff only)

```
@reviewer please check my changes
```

When using bare mentions, only the first valid teammate is matched and the full response is forwarded.

## Sequential Chains vs Fan-Out

### Sequential Chain

When an agent mentions **one** teammate, the chain continues sequentially:

```
@coder → responds, mentions @reviewer
  └→ @reviewer → responds, mentions @writer
       └→ @writer → responds (no mention, chain ends)
```

Each step receives the previous agent's response prefixed with context:
```
[Message from teammate @coder]:
I fixed the bug in auth.ts. Please review.
```

### Parallel Fan-Out

When an agent mentions **multiple** teammates (using tag format), all are invoked in parallel:

```
@coder → responds with:
  "[@reviewer: check auth.ts changes]"
  "[@writer: document the new login API]"
         │
    ┌────┴────┐
    ▼         ▼
@reviewer  @writer    (invoked in parallel)
    │         │
    └────┬────┘
         ▼
   All responses collected
```

Fan-out responses are aggregated and the chain ends (no further chaining from fan-out results).

## Chat History

Team chain conversations are saved to `~/.tinyclaw/chats/{team_id}/` as timestamped Markdown files.

Each file contains:
- Team name and metadata (date, channel, sender)
- The original user message
- Each chain step with agent name and full response

Example file (`~/.tinyclaw/chats/dev/2026-02-13_14-30-00.md`):

```markdown
# Team Chain: Development Team (@dev)
**Date:** 2026-02-13T14:30:00.000Z
**Channel:** discord | **Sender:** alice
**Steps:** 2

---

## User Message

Fix the auth bug in login.ts

---

## Step 1: Code Assistant (@coder)

I found and fixed the bug...

---

## Step 2: Code Reviewer (@reviewer)

Changes look good, approved!
```

## Live Visualizer

Monitor team chains in real-time with the TUI dashboard:

```bash
tinyclaw team visualize         # Watch all teams
tinyclaw team visualize dev     # Watch specific team
```

The visualizer displays:

- **Agent cards** with status (idle, active, done, error), provider/model, and leader indicator
- **Chain flow** showing handoff arrows between agents
- **Activity log** of recent events with timestamps
- **Status bar** with queue depth and processing counts

Press `q` to quit.

## CLI Commands

```bash
tinyclaw team list              # List all teams
tinyclaw team add               # Add a new team (interactive wizard)
tinyclaw team show dev          # Show team configuration
tinyclaw team remove dev        # Remove a team
tinyclaw team visualize [id]    # Live TUI dashboard
```

### In-Chat Commands

| Command | Description |
|---------|-------------|
| `/team` | List all available teams |
| `@team_id message` | Route to team's leader agent |
| `@agent_id message` | Route to agent directly (team context still active if agent is in a team) |

## Events

Team chain execution emits events to `~/.tinyclaw/events/` for the visualizer and external tooling:

| Event | Description |
|-------|-------------|
| `team_chain_start` | Chain begins (team ID, agents, leader) |
| `chain_step_start` | Agent invocation begins |
| `chain_step_done` | Agent responds (includes response text) |
| `chain_handoff` | Agent hands off to teammate |
| `team_chain_end` | Chain complete (total steps, agent list) |

## Example: Setting Up a Dev Team

```bash
# 1. Create agents
tinyclaw agent add    # Create "coder" agent
tinyclaw agent add    # Create "reviewer" agent

# 2. Create team
tinyclaw team add     # Interactive: name "dev", agents [coder, reviewer], leader: coder

# 3. Send a message
tinyclaw send "@dev fix the auth bug"

# 4. Watch it work
tinyclaw team visualize dev
```

## See Also

- [AGENTS.md](AGENTS.md) - Agent configuration and management
- [QUEUE.md](QUEUE.md) - Queue system and message processing
- [README.md](../README.md) - Main project documentation
