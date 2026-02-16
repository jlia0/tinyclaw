---
name: send-user-message
description: "Send a proactive message to a paired user via their channel (Discord, Telegram, or WhatsApp). Use when the agent needs to notify, alert, or send an unsolicited message to a user — especially during heartbeat invocations, scheduled tasks, or when the agent wants to reach out without a prior user message in the current conversation. Triggers: 'send message to user', 'notify user', 'alert user', 'message the user on discord/telegram/whatsapp', or any need to proactively communicate with a paired sender."
---

# Send User Message

Send a message to a paired user by writing to the TinyClaw outgoing queue. The message is delivered by the channel client (Discord, Telegram, or WhatsApp) that polls the queue.

## When to use

- Proactively notify a user (e.g., task completion, status update, alert)
- Send a message during a heartbeat invocation (no active user conversation)
- Reach a specific user on a specific channel when multiple pairings exist

## Workflow

### 1. Identify the target

If you already know the target from the current conversation context (channel and senderId from the incoming message), skip to step 2.

If you are running from a heartbeat invocation or are unsure which user to send to, list available targets first:

```bash
<skill_dir>/scripts/send-message.sh list-targets
```

This reads `pairing.json` and prints all approved pairings with their `channel`, `senderId`, and `sender` (display name). Pick the appropriate target.

### 2. Send the message

```bash
<skill_dir>/scripts/send-message.sh send \
  --channel <channel> \
  --sender-id <senderId> \
  --sender "<display name>" \
  --message "<your message>"
```

With file attachments:

```bash
<skill_dir>/scripts/send-message.sh send \
  --channel telegram \
  --sender-id 123456 \
  --sender "Alice" \
  --message "Here's the report you requested." \
  --files "/Users/you/.tinyclaw/files/report.pdf,/Users/you/.tinyclaw/files/chart.png"
```

Parameters:
- `--channel`: One of `discord`, `telegram`, `whatsapp`
- `--sender-id`: The channel-specific user ID (from pairing.json or conversation context)
- `--sender`: Human-readable display name of the recipient
- `--message`: The message text to send (max 4000 chars)
- `--agent`: (Optional) Agent ID to attribute the message to
- `--files`: (Optional) Comma-separated absolute file paths to attach (files must exist on disk)

The script writes a JSON file to the outgoing queue directory with the correct `{channel}_` prefix so the channel client picks it up.

### 3. Choosing a target when multiple pairings exist

When there are multiple approved pairings and you need to decide who to message:
- If the task or context specifies a user by name, match against the `sender` field
- If the task specifies a channel, filter by `channel`
- If ambiguous, prefer the most recently approved pairing
- If still ambiguous, send to all relevant targets (run the send command once per target)

## Notes

- The outgoing queue path is resolved automatically (checks local `.tinyclaw/` first, then `~/.tinyclaw/`)
- Messages include a `senderId` field so channel clients can route agent-initiated messages to the correct user
- For heartbeat-context messages, set `--agent` to identify which agent is sending
