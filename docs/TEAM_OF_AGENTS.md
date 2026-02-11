# Team of Teams

TinyClaw supports running multiple AI teams simultaneously, each with its own isolated workspace, configuration, and conversation state. This allows you to have specialized teams for different tasks while maintaining complete isolation.

## Overview

The team management feature enables you to:

- **Run multiple teams** with different models, providers, and configurations
- **Route messages** to specific teams using `@team_id` syntax
- **Isolate conversations** - each team has its own workspace directory and conversation history
- **Specialize teams** - give each team a custom system prompt and configuration
- **Switch providers** - mix Anthropic (Claude) and OpenAI (Codex) teams
- **Customize workspaces** - organize teams in your own workspace directory

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
│  • Parses @team_id routing prefix                           │
│  • Falls back to default team if no prefix                  │
│  • Loads team configuration from settings.json              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                    Team Router                               │
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
const routing = parseTeamRouting(rawMessage, teams);
// Result: { teamId: "coder", message: "fix the authentication bug" }
```

**Routing Rules:**
- Message starts with `@team_id` → Routes to that team
- No prefix → Routes to default team (user-named during setup)
- Team not found → Falls back to default team
- No teams configured → Uses legacy single-team mode

### 2. Team Configuration

Each team has its own configuration in `.tinyclaw/settings.json`:

```json
{
  "workspace": {
    "path": "/Users/me/tinyclaw-workspace",
    "name": "tinyclaw-workspace"
  },
  "teams": {
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

**Note:** The `working_directory` is automatically set to `<workspace>/<team_id>/` when creating teams via `tinyclaw.sh team add`.

### 3. Team Isolation

Each team has its own isolated workspace directory with complete copies of configuration files:

**Team Workspaces:**
```
~/tinyclaw-workspace/          # Or custom workspace name
├── coder/
│   ├── .claude/               # Team's own Claude config
│   │   ├── settings.json
│   │   ├── settings.local.json
│   │   └── hooks/
│   │       ├── session-start.sh
│   │       └── log-activity.sh
│   ├── heartbeat.md           # Team-specific heartbeat
│   ├── AGENTS.md              # Team-specific docs
│   └── reset_flag             # Reset signal
├── writer/
│   ├── .claude/
│   ├── heartbeat.md
│   ├── AGENTS.md
│   └── reset_flag
└── assistant/                 # User-named default team
    ├── .claude/
    ├── heartbeat.md
    ├── AGENTS.md
    └── reset_flag
```

**Templates & Shared Resources:**

Templates and shared resources are stored in `~/.tinyclaw/`:

```
~/.tinyclaw/
├── .claude/           # Template: Copied to each new team
├── heartbeat.md       # Template: Copied to each new team
├── AGENTS.md          # Template: Copied to each new team
├── channels/          # SHARED: Channel state (QR codes, ready flags)
├── files/             # SHARED: Uploaded files from all channels
├── logs/              # SHARED: Log files for all teams and channels
└── queue/             # SHARED: Message queue (incoming/outgoing/processing)
```

**How it works:**
- Each team runs CLI commands in its own workspace directory (`~/workspace/team_id/`)
- Each team gets its own copy of `.claude/`, `heartbeat.md`, and `AGENTS.md` from templates
- Teams can customize their settings, hooks, and documentation independently
- Conversation history is isolated per team (managed by Claude/Codex CLI)
- Reset flags allow resetting individual team conversations
- File operations happen in the team's directory
- Templates stored in `~/.tinyclaw/` are copied when creating new teams
- Uploaded files, message queues, and logs are shared (common dependencies)

### 4. Provider Execution

The queue processor calls the appropriate CLI based on provider:

**Anthropic (Claude):**
```bash
cd "$team_working_directory"  # e.g., ~/tinyclaw-workspace/coder/
claude --dangerously-skip-permissions \
  --model claude-sonnet-4-5 \
  --system-prompt "Your custom prompt..." \
  -c \  # Continue conversation
  -p "User message here"
```

**OpenAI (Codex):**
```bash
cd "$team_working_directory"  # e.g., ~/tinyclaw-workspace/coder/
codex exec resume --last \
  --model gpt-5.3-codex \
  --skip-git-repo-check \
  --dangerously-bypass-approvals-and-sandbox \
  --json \
  "User message here"
```

## Configuration

### Initial Setup

During first-time setup (`./tinyclaw.sh setup`), you'll be prompted for:

1. **Workspace name** - Where to store team directories
   - Default: `tinyclaw-workspace`
   - Creates: `~/tinyclaw-workspace/`

2. **Default team name** - Name for your main assistant
   - Default: `assistant`
   - This replaces the hardcoded "default" team

### Adding Teams

**Interactive CLI:**
```bash
./tinyclaw.sh team add
```

This walks you through:
1. Team ID (e.g., `coder`)
2. Display name (e.g., `Code Assistant`)
3. Provider (Anthropic or OpenAI)
4. Model selection
5. Optional system prompt

**Working directory is automatically set to:** `<workspace>/<team_id>/`

**Manual Configuration:**

Edit `.tinyclaw/settings.json`:

```json
{
  "workspace": {
    "path": "/Users/me/tinyclaw-workspace",
    "name": "tinyclaw-workspace"
  },
  "teams": {
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

### Team Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Human-readable display name |
| `provider` | Yes | `anthropic` or `openai` |
| `model` | Yes | Model identifier (e.g., `sonnet`, `opus`, `gpt-5.3-codex`) |
| `working_directory` | Yes | Directory where team operates (auto-set to `<workspace>/<team_id>/`) |
| `system_prompt` | No | Inline system prompt text |
| `prompt_file` | No | Path to file containing system prompt |

**Note:**
- If both `prompt_file` and `system_prompt` are provided, `prompt_file` takes precedence
- The `working_directory` is automatically set to `<workspace>/<team_id>/` when creating teams
- Each team gets its own isolated directory with copies of templates from `~/.tinyclaw/`

## Usage

### Routing Messages to Teams

**In any messaging channel** (Discord, Telegram, WhatsApp):

```
@coder fix the authentication bug in login.ts

@writer document the new API endpoints

@researcher find papers on transformer architectures

help me with this (goes to default team - "assistant" by default)
```

### Listing Teams

**From chat:**
```
/agents
```
(Note: Command shows "agents" but lists teams - backwards compatible)

**From CLI:**
```bash
./tinyclaw.sh team list
```

**Output:**
```
Configured Teams
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

### Managing Teams

**Show team details:**
```bash
./tinyclaw.sh team show coder
```

**Reset team conversation:**
```bash
./tinyclaw.sh team reset coder
```

From chat:
```
@coder /reset
```

**Remove team:**
```bash
./tinyclaw.sh team remove coder
```

## Use Cases

### Specialized Codebases

Have different teams for different projects:

```json
{
  "workspace": {
    "path": "/Users/me/my-workspace"
  },
  "teams": {
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

### Role-Based Teams

Assign different roles to teams:

```json
{
  "teams": {
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
  "teams": {
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

### Dynamic Team Routing

You can pre-route messages from channel clients by setting the `agent` field (name kept for backwards compatibility):

```typescript
// In channel client (discord-client.ts, etc.)
const queueData: QueueData = {
  channel: 'discord',
  message: userMessage,
  agent: 'coder',  // Pre-route to specific team
  // ...
};
```

### Fallback Behavior

If no teams are configured, TinyClaw automatically creates a default team using the legacy `models` section:

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

1. **Global reset:** `~/.tinyclaw/reset_flag` - resets all teams
2. **Per-team reset:** `<workspace>/<team_id>/reset_flag` - resets specific team

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

Files uploaded through messaging channels are automatically available to all teams:

```
User uploads image.png via Telegram
→ Saved to ~/.tinyclaw/files/telegram_123456_image.png
→ Message includes: [file: /path/to/image.png]
→ Routed to team
→ Team can read/process the file
```

Teams can also send files back:

```typescript
// Team response includes:
response = "Here's the diagram [send_file: /path/to/diagram.png]";
// File is extracted and sent back through channel
```

## Troubleshooting

### Team Not Found

If you see "Team 'xyz' not found", check:

1. Team exists in settings: `./tinyclaw.sh team list`
2. Team ID is lowercase and matches exactly
3. Settings file is valid JSON: `cat .tinyclaw/settings.json | jq`

### Wrong Team Responding

If messages go to wrong team:

1. Check routing prefix: `@team_id` with space after
2. Verify team is not deleted
3. Check logs: `tail -f ~/.tinyclaw/logs/queue.log`

### Conversation Not Resetting

If `/reset` doesn't work:

1. Check reset flag exists: `ls ~/tinyclaw-workspace/{team_id}/reset_flag`
2. Send a new message to trigger reset
3. Reset is one-time - next message continues conversation

### CLI Not Found

If team can't execute (error: `command not found`):

1. **Anthropic:** Ensure `claude` CLI is installed and in PATH
2. **OpenAI:** Ensure `codex` CLI is installed and authenticated
3. Test manually: `claude --version` or `codex --version`

### Workspace Issues

If teams aren't being created:

1. Check workspace path: `cat .tinyclaw/settings.json | jq '.workspace.path'`
2. Verify workspace exists: `ls ~/tinyclaw-workspace/`
3. Check permissions: `ls -la ~/tinyclaw-workspace/`

### Templates Not Copying

If new teams don't have `.claude/` or other files:

1. Check templates exist: `ls -la ~/.tinyclaw/`
2. Verify template files: `ls ~/.tinyclaw/{.claude,heartbeat.md,AGENTS.md}`
3. Run setup again to create templates: `./tinyclaw.sh setup`

## Implementation Details

### Code Structure

**Queue Processor** (`src/queue-processor.ts`):
- `getSettings()` - Loads settings from JSON
- `getAgents()` - Returns team configurations (checks `.teams` then `.agents`)
- `parseTeamRouting()` - Parses @team_id prefix
- `processMessage()` - Main routing and execution logic

**Message Interfaces:**
```typescript
interface MessageData {
  agent?: string;      // Pre-routed team ID (field name kept for backwards compat)
  files?: string[];    // Uploaded file paths
  // ...
}

interface ResponseData {
  agent?: string;      // Which team handled this
  files?: string[];    // Files to send back
  // ...
}
```

### Team Directory Structure

**Templates:**
```
~/.tinyclaw/
├── .claude/           # Copied to new teams
├── heartbeat.md       # Copied to new teams
└── AGENTS.md          # Copied to new teams
```

**Team State:**
```
<workspace>/
└── {team_id}/
    ├── .claude/       # Team's own config
    ├── heartbeat.md   # Team's own monitoring
    ├── AGENTS.md      # Team's own docs
    └── reset_flag     # Touch to reset conversation
```

State is managed by the CLI itself (claude or codex) through the `-c` flag and working directory isolation.

## Future Enhancements

Potential features for team management:

- **Team delegation:** Teams can call other teams
- **Shared context:** Optional shared memory between teams
- **Team scheduling:** Time-based or event-based team activation
- **Team groups:** Organize teams into hierarchies
- **Web dashboard:** Visual team management and monitoring
- **Team analytics:** Track usage, performance per team
- **Workspace templates:** Pre-configured team workspaces for common use cases
- **Team migration:** Export/import team configurations

## See Also

- [AGENTS.md](../AGENTS.md) - Original design document
- [README.md](../README.md) - Main project documentation
- [REFACTOR_SUMMARY.md](../REFACTOR_SUMMARY.md) - Details of the agent→team refactor
- Setup wizard: `./tinyclaw.sh setup`
- Team CLI: `./tinyclaw.sh team --help`
