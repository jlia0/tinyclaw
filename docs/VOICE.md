# Voice Channel (Telnyx/ClawdTalk)

TinyClaw supports voice calling capabilities through Telnyx, powered by ClawdTalk for AI voice interactions. This channel enables your agents to make and receive phone calls.

## Features

- **Inbound calls**: Receive calls on your Telnyx phone number
- **Outbound calls**: Make calls programmatically from agents
- **Text-to-speech**: Speak responses to callers
- **DTMF gathering**: Collect keypad input from callers
- **Call recording**: Optional recording of conversations
- **Multi-agent routing**: Route calls to specific agents with `@agent_id`

## Setup

### 1. Create a Telnyx Account

1. Sign up at [telnyx.com](https://telnyx.com)
2. Navigate to the [Portal](https://portal.telnyx.com)
3. Complete account verification

### 2. Create an API Key

1. Go to [API Keys](https://portal.telnyx.com/#/app/api-keys)
2. Click "Create API Key"
3. Save the key securely (you will need it for configuration)

### 3. Configure a Voice Profile

1. Go to [Voice > Profiles](https://portal.telnyx.com/#/app/voice/profiles)
2. Create a new voice profile
3. Note the **Connection ID** for configuration

### 4. Purchase a Phone Number

1. Go to [Phone Numbers](https://portal.telnyx.com/#/app/numbers)
2. Search for and purchase a number
3. Assign it to your voice profile
4. Note the number in E.164 format (e.g., `+15551234567`)

### 5. Configure Webhook

1. In your voice profile settings, set the webhook URL:
   ```
   https://your-server.com:8080/telnyx-webhook
   ```
2. Ensure your server is accessible from the internet
3. Port 8080 is used by default (configurable via `TELNYX_WEBHOOK_PORT`)

### 6. Run Setup Wizard

```bash
tinyclaw setup
```

When prompted:
1. Select "Voice (Telnyx/ClawdTalk)" as a channel
2. Enter your Telnyx API key
3. Enter your Connection ID
4. Enter your phone number

## Environment Variables

The voice channel can also be configured via environment variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `TELNYX_API_KEY` | Your Telnyx API key | Yes |
| `TELNYX_PUBLIC_KEY` | Your Telnyx public key (for webhook verification) | Recommended |
| `TELNYX_CONNECTION_ID` | Voice profile connection ID | For outbound calls |
| `TELNYX_PHONE_NUMBER` | Your Telnyx phone number (E.164) | For outbound calls |
| `TELNYX_WEBHOOK_PORT` | Webhook server port (default: 8080) | No |
| `TELNYX_WEBHOOK_PATH` | Webhook endpoint path (default: `/telnyx-webhook`) | No |

## Usage

### Inbound Calls

When someone calls your Telnyx number:
1. The call is automatically answered
2. A greeting is spoken to the caller
3. The call is routed to the default agent
4. Agent responses are spoken to the caller
5. DTMF input is collected and processed

### Outbound Calls

From the command line:
```bash
node dist/channels/telnyx-voice-client.js call +15551234567 "Hello, this is a test call"
```

From within an agent response:
```
[voice_call: +15551234567]
```

### Agent Routing

Route voice calls to specific agents:
- During a call, say `@agent_id` followed by your request
- Example: "Let me connect you to @coder for that technical question"

### DTMF Input

Callers can use their keypad to provide input:
- Press 1 for sales
- Press 2 for support
- etc.

The DTMF tones are captured and forwarded to the agent as text.

## Response Metadata

Agents can include special metadata in their responses to control the call:

```json
{
  "message": "Thank you for calling. Goodbye!",
  "metadata": {
    "speak": "Thank you for calling. Goodbye!",
    "hangup": true
  }
}
```

| Field | Description |
|-------|-------------|
| `speak` | Text to speak to the caller |
| `hangup` | Whether to end the call after speaking |
| `gather` | Whether to collect DTMF input after speaking |

## ClawdTalk Integration

[ClawdTalk](https://clawdtalk.com) provides advanced voice AI capabilities for AI agents:

- Natural language understanding
- Real-time transcription
- Conversation flow management
- Multi-language support

To use ClawdTalk with your TinyClaw voice channel:
1. Sign up at [clawdtalk.com](https://clawdtalk.com)
2. Follow the integration guide at [github.com/team-telnyx/clawdtalk-client](https://github.com/team-telnyx/clawdtalk-client)
3. Configure your agent to use ClawdTalk for voice processing

## Troubleshooting

### Webhook Not Receiving Events

1. Verify your webhook URL is publicly accessible
2. Check firewall rules allow inbound connections on the webhook port
3. Verify the webhook URL matches what's configured in Telnyx portal

### Outbound Calls Failing

1. Verify `TELNYX_CONNECTION_ID` and `TELNYX_PHONE_NUMBER` are set
2. Check your Telnyx account has sufficient balance
3. Verify the destination number is in E.164 format

### Signature Verification Failing

1. Ensure `TELNYX_PUBLIC_KEY` is set correctly
2. Verify you're using the correct public key (not the API key)

## Logs

View voice channel logs:
```bash
tinyclaw logs voice
```

Or directly:
```bash
tail -f ~/.tinyclaw/logs/voice.log
```

## API Reference

The voice channel exports the following functions for programmatic use:

```typescript
import { makeOutboundCall, speakOnCall, hangupCall, gatherInput } from './channels/telnyx-voice-client';

// Make an outbound call
const callControlId = await makeOutboundCall('+15551234567', 'Hello from AI');

// Speak on an active call
await speakOnCall(callControlId, 'This is a test message');

// Gather DTMF input
await gatherInput(callControlId);

// Hang up a call
await hangupCall(callControlId);
```

## Resources

- [Telnyx Documentation](https://developers.telnyx.com)
- [Telnyx Node SDK](https://www.npmjs.com/package/@telnyx/node)
- [ClawdTalk](https://clawdtalk.com)
- [ClawdTalk Client](https://github.com/team-telnyx/clawdtalk-client)
