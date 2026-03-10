# Per-Agent Log Streaming to Discord Threads

Stream real-time agent activity (tool calls, tool results) into a Discord thread while the agent processes a message. The final answer is still delivered as a reply to the original message.

## How It Works

1. User sends a message in a Discord guild channel
2. A thread is created on that message titled `<AgentName> working...`
3. As the agent works, tool calls and results stream into the thread in real-time
4. When the agent finishes, a completion message is posted in the thread
5. The final response is delivered as a normal reply to the original message

## Enabling

Add `"stream_logs": true` to any agent in `.tinyclaw/settings.json`:

```json
{
  "agents": {
    "my-agent": {
      "name": "MyAgent",
      "provider": "anthropic",
      "model": "opus",
      "working_directory": "/path/to/workspace",
      "stream_logs": true
    }
  }
}
```

To disable, set `"stream_logs": false` or remove the field.

## Requirements

- **Provider**: Only works with `anthropic` (Claude) agents. Other providers fall back to normal invocation silently.
- **Channel**: Only works in Discord guild (server) channels. DMs are skipped gracefully — the agent still responds normally, just without the thread.
- **System**: Requires the `script` command (from `util-linux`, available on all standard Linux systems).

## What Shows in the Thread

| Agent Activity | Thread Message |
|---|---|
| Tool call (Bash) | `` Tool: `Bash` `echo hello` `` |
| Tool call (Read) | `` Tool: `Read` `/path/to/file` `` |
| Tool call (Glob) | `` Tool: `Glob` `**/*.ts` `` |
| Tool result | `Result: <first 200 chars of output>` |
| Agent starts | `Agent **MyAgent** is processing...` |
| Agent finishes | `Agent **MyAgent** finished.` |

Events that are **not** shown: system init, rate limits, final text response, thinking blocks.

## Architecture

```
Discord User
    │
    ▼
Discord Client ──POST──▶ Queue Processor
    │                         │
    │◀──────── SSE ───────────┤  (stream_start, stream_log, stream_end)
    │                         │
    ▼                         ▼
Discord Thread          Claude CLI (--output-format stream-json --verbose)
```

- **Queue Processor** invokes Claude CLI with `--output-format stream-json --verbose` via a PTY (`script -qec`) to get real-time line-by-line JSON output
- Each JSON line is parsed by `formatStreamEvent()` into a human-readable string
- Formatted events are broadcast as SSE events (`stream_start`, `stream_log`, `stream_end`)
- **Discord Client** connects to the SSE endpoint on startup, creates threads on `stream_start`, buffers and flushes log lines on `stream_log`, and cleans up on `stream_end`

### Batching

Log messages are batched to avoid Discord rate limits:
- Flushed every **2 seconds** or when **15 lines** accumulate (whichever comes first)
- Each message is capped at Discord's **2000 character** limit

## Files Changed

| File | Change |
|---|---|
| `src/lib/types.ts` | Added `stream_logs?: boolean` to `AgentConfig`, new `StreamLogEvent` interface |
| `src/lib/invoke.ts` | Added `runCommandStreaming()` (PTY-based line streaming) and `invokeAgentStreaming()` |
| `src/queue-processor.ts` | Added `formatStreamEvent()` helper and streaming branch in `processMessage()` |
| `src/channels/discord-client.ts` | Added SSE client (`connectSSE`), thread management, batched log delivery |

## Troubleshooting

**Thread not created**: Check that the message is from a guild channel (not a DM) and the agent has `"stream_logs": true`.

**No tool calls in thread**: Check queue logs for `[stream-debug]` entries. If `total lines: 0`, the PTY wrapper may not be working — verify `script` command is available.

**Thread shows only start/end**: The agent may have responded without using any tools (e.g., a simple text reply).
