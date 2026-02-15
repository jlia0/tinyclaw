# Tinyclaw Queue Message Format

Scheduled tasks deliver messages by writing JSON files to the incoming queue directory (`~/.tinyclaw/queue/incoming/` or `<project>/.tinyclaw/queue/incoming/`).

## Message JSON schema

```json
{
  "channel": "schedule",
  "sender": "Scheduler",
  "senderId": "tinyclaw-schedule:<label>",
  "message": "@<agent_id> <task context>",
  "timestamp": 1707739200000,
  "messageId": "<label>_<unix_ts>_<pid>"
}
```

### Fields

| Field       | Type   | Description |
|-------------|--------|-------------|
| `channel`   | string | Origin channel. Scheduled tasks use `"schedule"` by default. |
| `sender`    | string | Display name. Default `"Scheduler"`. |
| `senderId`  | string | Unique sender ID. Format: `tinyclaw-schedule:<label>`. |
| `message`   | string | Must start with `@agent_id` for routing, followed by the task context. |
| `timestamp` | number | Unix epoch in milliseconds. |
| `messageId` | string | Unique message ID for deduplication and response matching. |

## Routing

The queue processor routes messages by parsing the `@agent_id` prefix from the `message` field. Ensure the message always starts with `@<agent_id> ` so the correct agent receives the task.

## Response handling

Responses from scheduled tasks appear in the outgoing queue (`queue/outgoing/`) like any other message. The channel clients can filter by `channel: "schedule"` to handle them differently (e.g., log-only vs. relay to Discord).
