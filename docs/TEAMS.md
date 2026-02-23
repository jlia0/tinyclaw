# Teams

Teams are named groups of agents that collaborate by passing messages to each other. When an agent responds with `[@teammate: message]` mentions, those become new messages in the queue, processed naturally by each agent's own promise chain. No central orchestrator — agents communicate directly.

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
   ┌───────────────┐    [@reviewer: please review]
   │   @coder      │──────────────────────────────┐
   │  "Fixed bug"  │                               ▼
   └───────────────┘                      ┌───────────────┐
                                          │  @reviewer    │
                                          │  "LGTM!"      │
                                          └───────────────┘
           │
           ▼
   All branches resolved → aggregate:
   @coder: Fixed the bug in auth.ts...
   ---
   @reviewer: Changes look good, approved!
```

### Message Flow

1. User sends `@team_id message` (or `@agent_id` where agent belongs to a team)
2. Queue processor resolves the team and invokes the **leader agent**
3. `[@teammate: message]` tags in the response become new messages in the queue
4. Each mentioned agent processes its message via its own promise chain (parallel across agents)
5. If an agent's response mentions more teammates, those become new messages too
6. When all branches resolve (`pending === 0`), responses are aggregated and sent to the user

For detailed message patterns (fan-out, backflow, cross-talk, shared context), see [MESSAGE-PATTERNS.md](MESSAGE-PATTERNS.md).

### Team Context Auto-Detection

Even when messaging an agent directly (e.g., `@coder fix this`), team context is automatically activated if that agent belongs to a team. Teammate mentions in the response will still trigger message passing.

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

## Message Patterns

See [MESSAGE-PATTERNS.md](MESSAGE-PATTERNS.md) for detailed documentation on:

- **Sequential handoff** — one agent mentions one teammate
- **Fan-out** — one agent mentions multiple teammates (parallel)
- **Backflow** — agents message back to whoever mentioned them
- **Cross-talk** — agents message each other after a fan-out
- **Shared context** — text outside bracket tags delivered to all mentioned agents
- **Pending response indicator** — prevents agents from re-mentioning teammates who are still processing

## Chat History

Team conversations are saved to `~/.tinyclaw/chats/{team_id}/` as timestamped Markdown files.

Each file contains:
- Team name and metadata (date, channel, sender, message count)
- The original user message
- Each agent's response with agent name

Example file (`~/.tinyclaw/chats/dev/2026-02-13_14-30-00.md`):

```markdown
# Team Conversation: Development Team (@dev)
**Date:** 2026-02-13T14:30:00.000Z
**Channel:** discord | **Sender:** alice
**Messages:** 3

------

## User Message

Fix the auth bug in login.ts

------

## Code Assistant (@coder)

I found and fixed the bug...

------

## Code Reviewer (@reviewer)

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

Team conversations emit events via SSE (`GET /api/events/stream`) for the visualizer and web dashboard:

| Event | Description |
|-------|-------------|
| `team_chain_start` | Conversation begins (team ID, agents, leader) |
| `chain_step_done` | Agent responds (includes response text) |
| `chain_handoff` | Agent mentions a teammate (from → to) |
| `team_chain_end` | Conversation complete (total messages, agent list) |

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

- [MESSAGE-PATTERNS.md](MESSAGE-PATTERNS.md) - Message flow patterns, shared context, pending indicators
- [AGENTS.md](AGENTS.md) - Agent configuration and management
- [QUEUE.md](QUEUE.md) - Queue system and message processing
- [README.md](../README.md) - Main project documentation
