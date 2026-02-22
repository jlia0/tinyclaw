import { Hono } from 'hono';
import { log, emitEvent } from '../../lib/logging';
import { enqueueMessage } from '../../lib/queue-db';

const app = new Hono();

// POST /api/message
app.post('/api/message', async (c) => {
    const body = await c.req.json();
    const { message, agent, sender, channel } = body as {
        message?: string; agent?: string; sender?: string; channel?: string;
    };

    if (!message || typeof message !== 'string') {
        return c.json({ error: 'message is required' }, 400);
    }

    const messageId = `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    enqueueMessage({
        channel: channel || 'web',
        sender: sender || 'Web',
        message,
        messageId,
        agent: agent || undefined,
    });

    log('INFO', `[API] Message enqueued: ${message.substring(0, 60)}...`);
    emitEvent('message_enqueued', {
        messageId,
        agent: agent || null,
        message: message.substring(0, 120),
    });

    return c.json({ ok: true, messageId });
});

export default app;
