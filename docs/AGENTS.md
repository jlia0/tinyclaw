# Agents

TinyClaw supports running multiple AI agents simultaneously, each with its own isolated workspace, configuration, and conversation state. This allows you to have specialized agents for different tasks while maintaining complete isolation.

## Overview

The agent management feature enables you to:

- **Run multiple agents** with different models, providers, and configurations
- **Route messages** to specific agents using `@agent_id` syntax
- **Isolate conversations** - each agent has its own workspace directory and conversation history
- **Specialize agents** - give each agent a custom system prompt and configuration
- **Switch providers** - mix Anthropic (Claude) and OpenAI (Codex) agents
- **Customize workspaces** - organize agents in your own workspace directory

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Message Channels                          │
│              (Discord, Telegram, WhatsApp)                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ User sends: "@coder fix the bug"
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                   Queue Processor                            │
│  • Parses @agent_id routing prefix                          │
│  • Falls back to default agent if no prefix                 │
│  • Loads agent configuration from settings.json             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                    Agent Router                              │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ @coder       │  │ @writer      │  │ @assistant   │     │
│  │              │  │              │  │ (default)    │     │
│  │ Provider:    │  │ Provider:    │  │ Provider:    │     │
│  │ anthropic    │  │ openai       │  │ anthropic    │     │
│  │ Model:       │  │ Model:       │  │ Model:       │     │
│  │ sonnet       │  │ gpt-5.3-codex│  │ opus         │     │
│  │              │  │              │  │              │     │
│  │ Workspace:   │  │ Workspace:   │  │ Workspace:   │     │
│  │ ~/workspace/ │  │ ~/workspace/ │  │ ~/workspace/ │     │
│  │    coder/    │  │    writer/   │  │  assistant/  │     │
│  │              │  │              │  │              │     │
│  │ Config:      │  │ Config:      │  │ Config:      │     │
│  │ .claude/     │  │ .claude/     │  │ .claude/     │     │
│  │ heartbeat.md │  │ heartbeat.md │  │ heartbeat.md │     │
│  │ AGENTS.md    │  │ AGENTS.md    │  │ AGENTS.md    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│                                                              │
│  Shared: ~/.tinyclaw/ (channels, files, logs, queue)       │
└─────────────────────────────────────────────────────────────┘
```

## How It Works

### 1. Message Routing

When a message arrives, the queue processor parses it for routing:

```typescript
// User sends: "@coder fix the authentication bug"
const routing = parseAgentRouting(rawMessage, agents);
// Result: { agentId: "coder", message: "fix the authentication bug" }
```

**Routing Rules:**
- Message starts with `@agent_id` → Routes to that agent
- No prefix → Routes to default agent (user-named during setup)
- Agent not found → Falls back to default agent
- No agents configured → Uses legacy single-agent mode

### 2. Agent Configuration

Each agent has its own configuration in `.tinyclaw/settings.json`:

```json
{
  "workspace": {
    "path": "/Users/me/tinyclaw-workspace",
    "name": "tinyclaw-workspace"
  },
  "agents": {
    "coder": {
      "name": "Code Assistant",
      "provider": "anthropic",
      "model": "sonnet",
      "working_directory": "/Users/me/tinyclaw-workspace/coder",
      "system_prompt": "You are a senior software engineer..."
    },
    "writer": {
      "name": "Technical Writer",
      "provider": "openai",
      "model": "gpt-5.3-codex",
      "working_directory": "/Users/me/tinyclaw-workspace/writer",
      "prompt_file": "/path/to/writer-prompt.md"
    },
    "assistant": {
      "name": "Assistant",
      "provider": "anthropic",
      "model": "opus",
      "working_directory": "/Users/me/tinyclaw-workspace/assistant"
    }
  }
}
```

**Note:** The `working_directory` is automatically set to `<workspace>/<agent_id>/` when creating agents via `tinyclaw agent add`.

### 3. Agent Isolation

Each agent has its own isolated workspace directory with complete copies of configuration files:

**Agent Workspaces:**
```
~/tinyclaw-workspace/          # Or custom workspace name
├── coder/
│   ├── .claude/               # Agent's own Claude config
│   │   ├── settings.json
│   │   ├── settings.local.json
│   │   └── hooks/
│   │       ├── session-start.sh
│   │       └── log-activity.sh
│   ├── heartbeat.md           # Agent-specific heartbeat
│   ├── AGENTS.md              # Agent-specific docs
│   └── reset_flag             # Reset signal
├── writer/
│   ├── .claude/
│   ├── heartbeat.md
│   ├── AGENTS.md
│   └── reset_flag
└── assistant/                 # User-named default agent
    ├── .claude/
    ├── heartbeat.md
    ├── AGENTS.md
    └── reset_flag
```

**Templates & Shared Resources:**

Templates and shared resources are stored in `~/.tinyclaw/`:

```
~/.tinyclaw/
├── .claude/           # Template: Copied to each new agent
├── heartbeat.md       # Template: Copied to each new agent
├── AGENTS.md          # Template: Copied to each new agent
├── channels/          # SHARED: Channel state (QR codes, ready flags)
├── files/             # SHARED: Uploaded files from all channels
├── logs/              # SHARED: Log files for all agents and channels
└── queue/             # SHARED: Message queue (incoming/outgoing/processing/dead-letter)
```

**How it works:**
- Each agent runs CLI commands in its own workspace directory (`~/workspace/agent_id/`)
- Each agent gets its own copy of `.claude/`, `heartbeat.md`, and `AGENTS.md` from templates
- Agents can customize their settings, hooks, and documentation independently
- Conversation history is isolated per agent (managed by Claude/Codex CLI)
- Reset flags allow resetting individual agent conversations
- File operations happen in the agent's directory
- Templates stored in `~/.tinyclaw/` are copied when creating new agents
- Uploaded files, message queues, and logs are shared (common dependencies)

### 4. Provider Execution

The queue processor calls the appropriate CLI based on provider:

When sandbox mode is enabled (`docker` or `apple`), the same provider commands run inside container runtime isolation.

**Anthropic (Claude):**
```bash
cd "$agent_working_directory"  # e.g., ~/tinyclaw-workspace/coder/
claude --dangerously-skip-permissions \
  --model claude-sonnet-4-5 \
  --system-prompt "Your custom prompt..." \
  -c \  # Continue conversation
  -p "User message here"
```

**OpenAI (Codex):**
```bash
cd "$agent_working_directory"  # e.g., ~/tinyclaw-workspace/coder/
codex exec resume --last \
  --model gpt-5.3-codex \
  --skip-git-repo-check \
  --dangerously-bypass-approvals-and-sandbox \
  --json \
  "User message here"
```

## Configuration

### Initial Setup

During first-time setup (`tinyclaw setup`), you'll be prompted for:

1. **Workspace name** - Where to store agent directories
   - Default: `tinyclaw-workspace`
   - Creates: `~/tinyclaw-workspace/`

2. **Default agent name** - Name for your main assistant
   - Default: `assistant`
   - This replaces the hardcoded "default" agent

### Adding Agents

**Interactive CLI:**
```bash
tinyclaw agent add
```

This walks you through:
1. Agent ID (e.g., `coder`)
2. Display name (e.g., `Code Assistant`)
3. Provider (Anthropic or OpenAI)
4. Model selection
5. Optional system prompt

**Working directory is automatically set to:** `<workspace>/<agent_id>/`

**Manual Configuration:**

Edit `.tinyclaw/settings.json`:

```json
{
  "workspace": {
    "path": "/Users/me/tinyclaw-workspace",
    "name": "tinyclaw-workspace"
  },
  "agents": {
    "researcher": {
      "name": "Research Assistant",
      "provider": "anthropic",
      "model": "opus",
      "working_directory": "/Users/me/tinyclaw-workspace/researcher",
      "system_prompt": "You are a research assistant specialized in academic literature review and data analysis."
    }
  }
}
```

### Agent Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Human-readable display name |
| `provider` | Yes | `anthropic` or `openai` |
| `model` | Yes | Model identifier (e.g., `sonnet`, `opus`, `gpt-5.3-codex`) |
| `working_directory` | Yes | Directory where agent operates (auto-set to `<workspace>/<agent_id>/`) |
| `sandbox_mode` | No | Per-agent override for sandbox runtime (`host`, `docker`, `apple`) |
| `system_prompt` | No | Inline system prompt text |
| `prompt_file` | No | Path to file containing system prompt |

**Note:**
- If both `prompt_file` and `system_prompt` are provided, `prompt_file` takes precedence
- The `working_directory` is automatically set to `<workspace>/<agent_id>/` when creating agents
- Each agent gets its own isolated directory with copies of templates from `~/.tinyclaw/`
- `sandbox_mode` overrides global `sandbox.mode` from settings when provided

## Usage

### Routing Messages to Agents

**In any messaging channel** (Discord, Telegram, WhatsApp):

```
@coder fix the authentication bug in login.ts

@writer document the new API endpoints

@researcher find papers on transformer architectures

help me with this (goes to default agent - "assistant" by default)
```

### Listing Agents

**From chat:**
```
/agents
```

**From CLI:**
```bash
tinyclaw agent list
```

**Output:**
```
Configured Agents
==================

  @coder - Code Assistant
    Provider:  anthropic/sonnet
    Directory: /Users/me/tinyclaw-workspace/coder

  @writer - Technical Writer
    Provider:  openai/gpt-5.3-codex
    Directory: /Users/me/tinyclaw-workspace/writer
    Prompt:    /path/to/writer-prompt.md

  @assistant - Assistant
    Provider:  anthropic/opus
    Directory: /Users/me/tinyclaw-workspace/assistant
```

### Managing Agents

**Show agent details:**
```bash
tinyclaw agent show coder
```

**Reset agent conversation:**
```bash
tinyclaw agent reset coder
```

From chat:
```
@coder /reset
```

**Remove agent:**
```bash
tinyclaw agent remove coder
```

## Use Cases

### Specialized Codebases

Have different agents for different projects:

```json
{
  "workspace": {
    "path": "/Users/me/my-workspace"
  },
  "agents": {
    "frontend": {
      "working_directory": "/Users/me/my-workspace/frontend",
      "system_prompt": "You are a React and TypeScript expert..."
    },
    "backend": {
      "working_directory": "/Users/me/my-workspace/backend",
      "system_prompt": "You are a Node.js backend engineer..."
    }
  }
}
```

Usage:
```
@frontend add a loading spinner to the dashboard

@backend optimize the database queries in user service
```

### Role-Based Agents

Assign different roles to agents:

```json
{
  "agents": {
    "reviewer": {
      "system_prompt": "You are a code reviewer. Focus on security, performance, and best practices."
    },
    "debugger": {
      "system_prompt": "You are a debugging expert. Help identify and fix bugs systematically."
    },
    "architect": {
      "model": "opus",
      "system_prompt": "You are a software architect. Design scalable, maintainable systems."
    }
  }
}
```

### Provider Mixing

Use different AI providers for different tasks:

```json
{
  "agents": {
    "quick": {
      "provider": "anthropic",
      "model": "sonnet",
      "system_prompt": "Fast, efficient responses for quick questions."
    },
    "deep": {
      "provider": "anthropic",
      "model": "opus",
      "system_prompt": "Thorough, detailed analysis for complex problems."
    },
    "codegen": {
      "provider": "openai",
      "model": "gpt-5.3-codex",
      "system_prompt": "Code generation specialist."
    }
  }
}
```

## Advanced Features

### Dynamic Agent Routing

You can pre-route messages from channel clients by setting the `agent` field:

```typescript
// In channel client (discord-client.ts, etc.)
const queueData: QueueData = {
  channel: 'discord',
  message: userMessage,
  agent: 'coder',  // Pre-route to specific agent
  // ...
};
```

### Fallback Behavior

If no agents are configured, TinyClaw automatically creates a default agent using the legacy `models` section:

```json
{
  "models": {
    "provider": "anthropic",
    "anthropic": {
      "model": "sonnet"
    }
  }
}
```

This ensures backward compatibility with older configurations.

### Reset Flags

Two types of reset flags:

1. **Global reset:** `~/.tinyclaw/reset_flag` - resets all agents
2. **Per-agent reset:** `<workspace>/<agent_id>/reset_flag` - resets specific agent

Both are automatically cleaned up after use.

### Custom Workspaces

You can create multiple workspaces for different purposes:

```json
{
  "workspace": {
    "path": "/Users/me/work-projects",
    "name": "work-projects"
  }
}
```

Or even use cloud-synced directories:
```json
{
  "workspace": {
    "path": "/Users/me/Dropbox/tinyclaw-workspace",
    "name": "tinyclaw-workspace"
  }
}
```

## File Handling

Files uploaded through messaging channels are automatically available to all agents:

```
User uploads image.png via Telegram
→ Saved to ~/.tinyclaw/files/telegram_123456_image.png
→ Message includes: [file: /path/to/image.png]
→ Routed to agent
→ Agent can read/process the file
```

Agents can also send files back:

```typescript
// Agent response includes:
response = "Here's the diagram [send_file: /path/to/diagram.png]";
// File is extracted and sent back through channel
```

## Troubleshooting

For detailed troubleshooting of agent-related issues, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

**Quick reference:**

- **Agent not found** → Check: `tinyclaw agent list`
- **Wrong agent responding** → Verify routing: `@agent_id message` (with space)
- **Conversation not resetting** → Send message after: `tinyclaw agent reset <id>`
- **CLI not found** → Install Claude Code or Codex CLI
- **Workspace issues** → Check: `cat .tinyclaw/settings.json | jq '.workspace'`
- **Templates not copying** → Run: `tinyclaw setup`

## Implementation Details

### Code Structure

**Queue Processor** (`src/queue-processor.ts`):
- `getSettings()` - Loads settings from JSON
- `getAgents()` - Returns agent configurations (checks `.agents`)
- `parseAgentRouting()` - Parses @agent_id prefix
- `processMessage()` - Main routing and execution logic

**Message Interfaces:**
```typescript
interface MessageData {
  agent?: string;      // Pre-routed agent ID
  files?: string[];    // Uploaded file paths
  // ...
}

interface ResponseData {
  agent?: string;      // Which agent handled this
  files?: string[];    // Files to send back
  // ...
}
```

### Agent Directory Structure

**Templates:**
```
~/.tinyclaw/
├── .claude/           # Copied to new agents
├── heartbeat.md       # Copied to new agents
└── AGENTS.md          # Copied to new agents
```

**Agent State:**
```
<workspace>/
└── {agent_id}/
    ├── .claude/       # Agent's own config
    ├── heartbeat.md   # Agent's own monitoring
    ├── AGENTS.md      # Agent's own docs
    └── reset_flag     # Touch to reset conversation
```

State is managed by the CLI itself (claude or codex) through the `-c` flag and working directory isolation.

## Teams

Teams are named groups of agents that can collaborate by forwarding messages to each other via `@teammate` mentions in their responses.

### How Team Collaboration Works

1. User sends `@dev fix the auth bug` (where `dev` is a team with leader `coder`)
2. Queue processor resolves `@dev` → team → leader agent `@coder`
3. Coder's AI responds: `"I fixed the bug in auth.ts. @reviewer please check my changes"`
4. Queue processor scans response, sees `@reviewer` is a teammate in team `dev`
5. Queue processor calls reviewer with coder's response (prefixed with context)
6. Reviewer responds: `"Changes look good, approved!"`
7. Combined response sent to user: `@coder: ... \n---\n @reviewer: ...`

The chain ends naturally when an agent responds without mentioning a teammate.

### Team Configuration

Teams are stored in `~/.tinyclaw/settings.json`:

```json
{
  "teams": {
    "dev": {
      "name": "Development Team",
      "agents": ["coder", "reviewer"],
      "leader_agent": "coder"
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `name` | Human-readable display name |
| `agents` | Array of agent IDs (must exist in `.agents`) |
| `leader_agent` | Agent that receives `@team_id` messages first |

Team IDs share the `@` routing namespace with agents, so no collisions are allowed.

### Managing Teams

**CLI Commands:**
```bash
tinyclaw team list                # List all teams
tinyclaw team add                 # Add a new team (interactive)
tinyclaw team show dev            # Show team configuration
tinyclaw team remove dev          # Remove a team
```

**In-chat Commands:**
```
/team                             # List all teams
@dev fix the auth bug             # Route to team leader
@coder fix the auth bug           # Route directly to agent (team context still active)
```

### Direct Agent Routing with Teams

When you message an agent directly (e.g., `@coder fix this`), team context is automatically activated if the agent belongs to a team. This means teammate mentions in the agent's response will still be followed.

### Agent AGENTS.md Updates

When an agent is added to a team, its `AGENTS.md` file is automatically updated with a team collaboration section listing teammates and instructions for using `@teammate_id` mentions.

## Future Enhancements

Potential features for agent management:

- **Shared context:** Optional shared memory between agents
- **Agent scheduling:** Time-based or event-based agent activation
- **Web dashboard:** Visual agent management and monitoring
- **Agent analytics:** Track usage, performance per agent
- **Workspace templates:** Pre-configured agent workspaces for common use cases
- **Agent migration:** Export/import agent configurations

## See Also

- [README.md](../README.md) - Main project documentation
- Setup wizard: `tinyclaw setup`
- Agent CLI: `tinyclaw agent --help`
