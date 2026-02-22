import { Hono } from 'hono';
import { Conversation } from '../../lib/types';
import { log } from '../../lib/logging';
import {
    getQueueStatus, getRecentResponses,
    getDeadMessages, retryDeadMessage, deleteDeadMessage,
} from '../../lib/queue-db';

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
