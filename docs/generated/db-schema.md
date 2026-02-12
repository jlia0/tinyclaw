# Queue File Schemas (Auto-Generated Reference)

> This document describes the JSON schemas for files in `.tinyclaw/queue/`.
> It is maintained manually for now but should be auto-generated from the
> Rust types in `tinyclaw-core` in the future.

## IncomingMessage

Written to `incoming/{channel}_{message_id}.json`.

```json
{
  "channel": "discord | telegram | whatsapp | heartbeat | http | manual",
  "sender": "string — display name or identifier",
  "sender_id": "string — platform-specific user ID",
  "message": "string — message body",
  "timestamp": 1700000000000,
  "message_id": "string — {timestamp}_{random}"
}
```

## OutgoingMessage

Written to `outgoing/{channel}_{message_id}_{timestamp}_.json`.

```json
{
  "channel": "discord | telegram | whatsapp | heartbeat | http | manual",
  "sender": "string — always \"tinyclaw\"",
  "message": "string — response body (max 4000 chars)",
  "original_message": "string — echo of the incoming message",
  "timestamp": 1700000000000,
  "message_id": "string — matches the incoming message_id"
}
```

## Settings

Stored at `.tinyclaw/settings.json`.  See `Settings` struct in
`tinyclaw-core/src/config.rs` for the canonical definition.

## Queue Directories

| Directory | Contains | Lifecycle |
|-----------|----------|-----------|
| `incoming/` | New messages from channels | Created by channels, claimed by processor |
| `processing/` | Message currently being inferred | Moved from incoming, deleted on completion |
| `outgoing/` | Responses waiting for delivery | Created by processor, deleted by channels |
