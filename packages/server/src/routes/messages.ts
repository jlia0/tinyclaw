import { Hono } from 'hono';
import { log, emitEvent, enqueueMessage, genId } from '@tinyagi/core';

const app = new Hono();

// POST /api/message
app.post('/api/message', async (c) => {
    const body = await c.req.json();
    const { message, agent, sender, senderId, channel, messageId: clientMessageId } = body as {
        message?: string; agent?: string; sender?: string; senderId?: string;
        channel?: string; messageId?: string;
    };

    if (!message || typeof message !== 'string') {
        return c.json({ error: 'message is required' }, 400);
    }

    const resolvedChannel = channel || 'api';
    const resolvedSender = sender || 'API';
    const messageId = clientMessageId || genId('api');

    const rowId = enqueueMessage({
        channel: resolvedChannel,
        sender: resolvedSender,
        senderId: senderId || undefined,
        message,
        messageId,
        agent: agent || undefined,
    });

    if (rowId === null) {
        return c.json({ error: 'duplicate messageId', messageId }, 409);
    }

    log('INFO', `[API] Message enqueued: ${message}`);
    emitEvent('message:incoming', {
        messageId,
        agent: agent || null,
        channel: resolvedChannel,
        sender: resolvedSender,
        message: message.substring(0, 120),
    });

    return c.json({ ok: true, messageId });
});

export default app;
