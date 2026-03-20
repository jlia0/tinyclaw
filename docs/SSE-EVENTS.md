# SSE Events

The queue processor broadcasts real-time events over Server-Sent Events (SSE) at `GET /api/events/stream`. Every event includes `type` (the event name) and `timestamp` (UTC ms) in addition to the fields listed below.

## Connection

```javascript
const es = new EventSource('/api/events/stream');
es.addEventListener('agent:response', (e) => {
  const data = JSON.parse(e.data);
  console.log(data);
});
```

## Events

### `message:incoming`

A message was submitted via the API and added to the queue.

| Field       | Type             | Description                          |
|-------------|------------------|--------------------------------------|
| `messageId` | `string`         | Unique message identifier            |
| `agent`     | `string \| null` | Target agent (null if auto-routed)   |
| `channel`   | `string`         | Channel name (whatsapp, telegram, …) |
| `sender`    | `string`         | Sender display name                  |
| `message`   | `string`         | Message text (truncated to 120 chars)|

### `agent:invoke`

An agent has been invoked to process a message.

| Field       | Type             | Description                                      |
|-------------|------------------|--------------------------------------------------|
| `agentId`   | `string`         | Agent being invoked                              |
| `agentName` | `string`         | Agent display name                               |
| `fromAgent` | `string \| null` | Sending agent (null for user-initiated messages) |

### `agent:progress`

An agent is streaming incremental progress while processing.

| Field       | Type     | Description                |
|-------------|----------|----------------------------|
| `agentId`   | `string` | Agent identifier           |
| `agentName` | `string` | Agent display name         |
| `text`      | `string` | Progress text              |
| `messageId` | `string` | Original message identifier|

### `agent:response`

An agent has produced a response. Each response is persisted to the `agent_messages` table.

| Field           | Type      | Description                                         |
|-----------------|-----------|-----------------------------------------------------|
| `agentId`       | `string`  | Agent identifier                                    |
| `agentName`     | `string`  | Agent display name                                  |
| `role`          | `string`  | Always `"assistant"`                                |
| `channel`       | `string`  | Channel name                                        |
| `sender`        | `string`  | Original sender                                     |
| `messageId`     | `string`  | Original message ID                                 |
| `content`       | `string`  | Full message content                                |
| `isTeamMessage` | `boolean` | Whether this is part of a team conversation          |

### `agent:mention`

An agent mentioned a teammate in its response, triggering the teammate to work.

| Field       | Type     | Description         |
|-------------|----------|---------------------|
| `teamId`    | `string` | Team identifier     |
| `fromAgent` | `string` | Agent that mentioned |
| `toAgent`   | `string` | Agent being mentioned|

### `message:done`

A final response has been delivered back to the user.

| Field            | Type     | Description              |
|------------------|----------|--------------------------|
| `channel`        | `string` | Channel name             |
| `sender`         | `string` | Original sender          |
| `agentId`        | `string` | Responding agent         |
| `responseLength` | `number` | Response length in chars |
| `responseText`   | `string` | Full response text       |
| `messageId`      | `string` | Original message ID      |

## Event lifecycle

A typical solo message:

```
message:incoming → agent:invoke → agent:progress (0..n) → agent:response → message:done
```

When an agent mentions teammates:

```
message:incoming → agent:invoke → agent:response → agent:mention
  → agent:invoke → agent:response → agent:mention
  → …
  → message:done
```

## Agent message history

All agent messages are persisted to the `agent_messages` SQLite table and available via the REST API:

| Endpoint | Description |
|----------|-------------|
| `GET /api/agent-messages` | All messages across all agents. Query: `?limit=100&since_id=0` |
| `GET /api/agents/:id/messages` | Messages for a specific agent. Query: `?limit=100&since_id=0` |
