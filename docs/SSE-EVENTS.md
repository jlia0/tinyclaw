# SSE Events

The queue processor broadcasts real-time events over Server-Sent Events (SSE) at `GET /api/events/stream`. Every event includes `type` (the event name) and `timestamp` (UTC ms) in addition to the fields listed below.

## Connection

```javascript
const es = new EventSource('/api/events/stream');
es.addEventListener('response_ready', (e) => {
  const data = JSON.parse(e.data);
  console.log(data);
});
```

## Events

### `processor_start`

Emitted once when the queue processor initializes.

| Field    | Type       | Description                    |
|----------|------------|--------------------------------|
| `agents` | `string[]` | IDs of all configured agents   |
| `teams`  | `string[]` | IDs of all configured teams    |

### `message_enqueued`

A message was submitted via the API and added to the queue.

| Field       | Type             | Description                          |
|-------------|------------------|--------------------------------------|
| `messageId` | `string`         | Unique message identifier            |
| `agent`     | `string \| null` | Target agent (null if auto-routed)   |
| `channel`   | `string`         | Channel name (whatsapp, telegram, …) |
| `sender`    | `string`         | Sender display name                  |
| `message`   | `string`         | Message text (truncated to 120 chars)|

### `message_received`

The queue processor has dequeued and started processing a message. Only fires for external (non-internal) messages. Distinct from `message_enqueued` which fires earlier at the API layer.

| Field       | Type     | Description                           |
|-------------|----------|---------------------------------------|
| `channel`   | `string` | Channel name                          |
| `sender`    | `string` | Sender display name                   |
| `message`   | `string` | Message text (truncated to 120 chars) |
| `messageId` | `string` | Unique message identifier             |

### `agent_routed`

A message has been routed to a specific agent.

| Field           | Type      | Description                              |
|-----------------|-----------|------------------------------------------|
| `agentId`       | `string`  | Agent identifier                         |
| `agentName`     | `string`  | Agent display name                       |
| `provider`      | `string`  | LLM provider (anthropic, openai, …)      |
| `model`         | `string`  | Model identifier                         |
| `isTeamRouted`  | `boolean` | Whether the message was routed via @team |

### `agent_message`

An agent has produced a message. This is the **simplified event for single-agent chat** — instead of listening to the full `chain_step_start → chain_step_done → response_ready` lifecycle, tinyoffice clients can subscribe to just this event to get every agent response. Each `agent_message` is also persisted to the `agent_messages` table for chat history.

| Field           | Type      | Description                                         |
|-----------------|-----------|-----------------------------------------------------|
| `agentId`       | `string`  | Agent identifier                                    |
| `agentName`     | `string`  | Agent display name                                  |
| `role`          | `string`  | Always `"assistant"` (user messages are not emitted) |
| `channel`       | `string`  | Channel name                                        |
| `sender`        | `string`  | Original sender                                     |
| `messageId`     | `string`  | Original message ID                                 |
| `content`       | `string`  | Full message content                                |
| `isTeamMessage` | `boolean` | Whether this is part of a team conversation          |

### `chain_step_start`

An agent is about to be invoked.

| Field       | Type             | Description                                      |
|-------------|------------------|--------------------------------------------------|
| `agentId`   | `string`         | Agent being invoked                              |
| `agentName` | `string`         | Agent display name                               |
| `fromAgent` | `string \| null` | Sending agent (null for user-initiated messages) |

### `chain_step_done`

An agent has finished producing a response.

| Field            | Type     | Description                 |
|------------------|----------|-----------------------------|
| `agentId`        | `string` | Agent that responded        |
| `agentName`      | `string` | Agent display name          |
| `responseLength` | `number` | Response length in chars    |
| `responseText`   | `string` | Full response text          |

### `team_chain_start`

A team conversation has been initiated.

| Field      | Type       | Description                   |
|------------|------------|-------------------------------|
| `teamId`   | `string`   | Team identifier               |
| `teamName` | `string`   | Team display name             |
| `agents`   | `string[]` | Agent IDs in the team         |
| `leader`   | `string`   | Leader agent ID               |

### `chain_handoff`

An agent mentioned a teammate, passing work to them.

| Field       | Type     | Description         |
|-------------|----------|---------------------|
| `teamId`    | `string` | Team identifier     |
| `fromAgent` | `string` | Agent handing off   |
| `toAgent`   | `string` | Agent receiving work|

### `team_chain_end`

A team conversation has completed (all branches resolved).

| Field        | Type       | Description                              |
|--------------|------------|------------------------------------------|
| `teamId`     | `string`   | Team identifier                          |
| `totalSteps` | `number`   | Total agent invocations in conversation  |
| `agents`     | `string[]` | Ordered list of agents that participated |

### `response_ready`

A final response is ready to be delivered back to the user.

| Field            | Type     | Description              |
|------------------|----------|--------------------------|
| `channel`        | `string` | Channel name             |
| `sender`         | `string` | Original sender          |
| `agentId`        | `string` | Responding agent (solo) or team leader (team) |
| `responseLength` | `number` | Response length in chars |
| `responseText`   | `string` | Full response text       |
| `messageId`      | `string` | Original message ID      |

## Event lifecycle

A typical solo message flows through events in this order:

```
message_enqueued → message_received → agent_routed → chain_step_start → chain_step_done → agent_message → response_ready
```

**Simplified (for single-agent chat):** If you only need the agent's response, subscribe to `agent_message` — it fires once per agent response with the full content, and each message is persisted to the `agent_messages` table.

A team conversation adds handoff events between agents:

```
message_enqueued → message_received → agent_routed → team_chain_start
  → chain_step_start → chain_step_done → agent_message → chain_handoff
  → chain_step_start → chain_step_done → agent_message → chain_handoff
  → …
  → team_chain_end → response_ready
```

## Agent message history

All agent messages (both user inputs and agent responses) are persisted to the `agent_messages` SQLite table and available via the REST API:

| Endpoint | Description |
|----------|-------------|
| `GET /api/agent-messages` | All messages across all agents. Query: `?limit=100&since_id=0` |
| `GET /api/agents/:id/messages` | Messages for a specific agent. Query: `?limit=100&since_id=0` |
