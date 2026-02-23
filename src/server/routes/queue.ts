import { Hono } from 'hono';
import { Conversation } from '../../lib/types';
import { log } from '../../lib/logging';
import {
    getQueueStatus, getRecentResponses, getResponsesForChannel, ackResponse,
    enqueueResponse, getDeadMessages, retryDeadMessage, deleteDeadMessage,
} from '../../lib/db';

export function createQueueRoutes(conversations: Map<string, Conversation>) {
    const app = new Hono();

    // GET /api/queue/status
    app.get('/api/queue/status', (c) => {
        const status = getQueueStatus();
        return c.json({
            incoming: status.pending,
            processing: status.processing,
            outgoing: status.responsesPending,
            dead: status.dead,
            activeConversations: conversations.size,
        });
    });

    // GET /api/responses
    app.get('/api/responses', (c) => {
        const limit = parseInt(c.req.query('limit') || '20', 10);
        const responses = getRecentResponses(limit);
        return c.json(responses.map(r => ({
            channel: r.channel,
            sender: r.sender,
            senderId: r.sender_id,
            message: r.message,
            originalMessage: r.original_message,
            timestamp: r.created_at,
            messageId: r.message_id,
            agent: r.agent,
            files: r.files ? JSON.parse(r.files) : undefined,
        })));
    });

    // GET /api/responses/pending?channel=whatsapp
    app.get('/api/responses/pending', (c) => {
        const channel = c.req.query('channel');
        if (!channel) return c.json({ error: 'channel query param required' }, 400);
        const responses = getResponsesForChannel(channel);
        return c.json(responses.map(r => ({
            id: r.id,
            channel: r.channel,
            sender: r.sender,
            senderId: r.sender_id,
            message: r.message,
            originalMessage: r.original_message,
            messageId: r.message_id,
            agent: r.agent,
            files: r.files ? JSON.parse(r.files) : undefined,
        })));
    });

    // POST /api/responses — enqueue a proactive outgoing message
    app.post('/api/responses', async (c) => {
        const body = await c.req.json();
        const { channel, sender, senderId, message, agent, files } = body as {
            channel?: string; sender?: string; senderId?: string;
            message?: string; agent?: string; files?: string[];
        };

        if (!channel || !sender || !message) {
            return c.json({ error: 'channel, sender, and message are required' }, 400);
        }

        const messageId = `proactive_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        enqueueResponse({
            channel,
            sender,
            senderId,
            message,
            originalMessage: '',
            messageId,
            agent,
            files: files && files.length > 0 ? files : undefined,
        });

        log('INFO', `[API] Proactive response enqueued for ${channel}/${sender}`);
        return c.json({ ok: true, messageId });
    });

    // POST /api/responses/:id/ack
    app.post('/api/responses/:id/ack', (c) => {
        const id = parseInt(c.req.param('id'), 10);
        ackResponse(id);
        return c.json({ ok: true });
    });

    // GET /api/queue/dead
    app.get('/api/queue/dead', (c) => {
        return c.json(getDeadMessages());
    });

    // POST /api/queue/dead/:id/retry
    app.post('/api/queue/dead/:id/retry', (c) => {
        const id = parseInt(c.req.param('id'), 10);
        const ok = retryDeadMessage(id);
        if (!ok) return c.json({ error: 'dead message not found' }, 404);
        log('INFO', `[API] Dead message ${id} retried`);
        return c.json({ ok: true });
    });

    // DELETE /api/queue/dead/:id
    app.delete('/api/queue/dead/:id', (c) => {
        const id = parseInt(c.req.param('id'), 10);
        const ok = deleteDeadMessage(id);
        if (!ok) return c.json({ error: 'dead message not found' }, 404);
        log('INFO', `[API] Dead message ${id} deleted`);
        return c.json({ ok: true });
    });

    return app;
}
