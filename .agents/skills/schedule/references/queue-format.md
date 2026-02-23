# Tinyclaw Queue Message Format

Scheduled tasks deliver messages by POSTing to the TinyClaw API server (`POST /api/message`).

## API endpoint

```
POST http://localhost:{TINYCLAW_API_PORT}/api/message
Content-Type: application/json
```

## Request body

```json
{
  "channel": "schedule",
  "sender": "Scheduler",
  "senderId": "tinyclaw-schedule:<label>",
  "message": "@<agent_id> <task context>",
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
| `messageId` | string | Unique message ID for deduplication and response matching. |

## Routing

The queue processor routes messages by parsing the `@agent_id` prefix from the `message` field. Ensure the message always starts with `@<agent_id> ` so the correct agent receives the task.

## Response handling

Responses from scheduled tasks are stored in the SQLite responses table and can be retrieved via `GET /api/responses`. Channel clients can filter by `channel: "schedule"` to handle them differently (e.g., log-only vs. relay to Discord).
