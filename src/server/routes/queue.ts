import { Hono } from 'hono';
import { Conversation } from '../../lib/types';
import { createLogger, logError } from '../../lib/logging';
import {
    getQueueStatus, getRecentResponses, getResponsesForChannel, ackResponse,
    enqueueResponse, getDeadMessages, retryDeadMessage, deleteDeadMessage,
    getQueueMessages, getQueueResponses, getQueueRowCounts,
    type QueueMessageStatus, type QueueResponseStatus,
} from '../../lib/db';

export function createQueueRoutes(conversations: Map<string, Conversation>) {
    const app = new Hono();
    const logger = createLogger({ runtime: 'api', source: 'api', component: 'queue-route' });
    const validMessageStatuses: QueueMessageStatus[] = ['pending', 'processing', 'completed', 'dead'];
    const validResponseStatuses: QueueResponseStatus[] = ['pending', 'acked'];

    const parseStatusList = <T extends string>(value: string | undefined, valid: readonly T[], defaults: T[]): T[] => {
        const parsed = (value || '')
            .split(',')
            .map(item => item.trim().toLowerCase())
            .filter((item): item is T => valid.includes(item as T));
        return parsed.length > 0 ? parsed : defaults;
    };

    const parseOptionalString = (value: string | undefined): string | undefined => {
        const trimmed = value?.trim();
        return trimmed ? trimmed : undefined;
    };

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
            metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
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

        logger.info({ channel, sender, agentId: agent, messageId }, 'Proactive response enqueued');
        return c.json({ ok: true, messageId });
    });

    // POST /api/responses/:id/ack
    app.post('/api/responses/:id/ack', (c) => {
        const id = parseInt(c.req.param('id'), 10);
        ackResponse(id);
        return c.json({ ok: true });
    });

    // GET /api/queue/rows
    app.get('/api/queue/rows', (c) => {
        const messageStatuses = parseStatusList(c.req.query('messageStatus'), validMessageStatuses, ['pending', 'processing', 'dead']);
        const responseStatuses = parseStatusList(c.req.query('responseStatus'), validResponseStatuses, ['pending']);
        const channel = parseOptionalString(c.req.query('channel'));
        const agentId = parseOptionalString(c.req.query('agentId'));
        const sender = parseOptionalString(c.req.query('sender'));
        const messageId = parseOptionalString(c.req.query('messageId'));
        const conversationId = parseOptionalString(c.req.query('conversationId'));
        const search = parseOptionalString(c.req.query('search'));
        const rawLimit = parseInt(c.req.query('limit') || '100', 10);
        const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 100;

        try {
            const messages = getQueueMessages({
                statuses: messageStatuses,
                channel,
                agentId,
                sender,
                messageId,
                conversationId,
                search,
                limit,
            });
            const responses = getQueueResponses({
                statuses: responseStatuses,
                channel,
                agentId,
                sender,
                messageId,
                conversationId,
                search,
                limit,
            });
            const counts = getQueueRowCounts();

            logger.debug({
                messageStatuses,
                responseStatuses,
                channel,
                agentId,
                sender,
                messageId,
                conversationId,
                search,
                limit,
                context: {
                    messageCount: messages.length,
                    responseCount: responses.length,
                    counts,
                },
            }, 'Queue rows fetched');

            return c.json({ messages, responses, counts });
        } catch (error) {
            logError(logger, error, 'Failed to fetch queue rows', {
                messageStatuses,
                responseStatuses,
                channel,
                agentId,
                sender,
                messageId,
                conversationId,
                search,
                limit,
            });
            return c.json({ ok: false, error: 'Failed to fetch queue rows', message: 'Failed to fetch queue rows' }, 500);
        }
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
        logger.info({ context: { deadMessageId: id } }, 'Dead message retried');
        return c.json({ ok: true });
    });

    // DELETE /api/queue/dead/:id
    app.delete('/api/queue/dead/:id', (c) => {
        const id = parseInt(c.req.param('id'), 10);
        const ok = deleteDeadMessage(id);
        if (!ok) return c.json({ error: 'dead message not found' }, 404);
        logger.info({ context: { deadMessageId: id } }, 'Dead message deleted');
        return c.json({ ok: true });
    });

    return app;
}
