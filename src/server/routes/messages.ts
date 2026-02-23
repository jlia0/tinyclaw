import { Hono } from 'hono';
import { log, emitEvent } from '../../lib/logging';
import { enqueueMessage } from '../../lib/db';

const app = new Hono();

// POST /api/message
app.post('/api/message', async (c) => {
    const body = await c.req.json();
    const { message, agent, sender, senderId, channel, files, messageId: clientMessageId } = body as {
        message?: string; agent?: string; sender?: string; senderId?: string;
        channel?: string; files?: string[]; messageId?: string;
    };

    if (!message || typeof message !== 'string') {
        return c.json({ error: 'message is required' }, 400);
    }

    const resolvedChannel = channel || 'api';
    const resolvedSender = sender || 'API';
    const messageId = clientMessageId || `api_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Prepend channel and sender context only when explicitly provided
    const fullMessage = (channel && sender) ? `[${channel}/${sender}]: ${message}` : message;

    enqueueMessage({
        channel: resolvedChannel,
        sender: resolvedSender,
        senderId: senderId || undefined,
        message: fullMessage,
        messageId,
        agent: agent || undefined,
        files: files && files.length > 0 ? files : undefined,
    });

    log('INFO', `[API] Message enqueued: ${message.substring(0, 60)}...`);
    emitEvent('message_enqueued', {
        messageId,
        agent: agent || null,
        channel: resolvedChannel,
        sender: resolvedSender,
        message: message.substring(0, 120),
    });

    return c.json({ ok: true, messageId });
});

export default app;
