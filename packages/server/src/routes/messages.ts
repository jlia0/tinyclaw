import { Hono } from 'hono';
import { log, emitEvent, enqueueMessage, insertAgentMessage, genId, parseAgentRouting, getAgents, getTeams, getSettings } from '@tinyagi/core';

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

    // Resolve agent routing at enqueue time so channel messages and scheduled
    // messages end up in the same per-agent promise chain. Without this,
    // messages without an explicit `agent` field go into the 'default' chain
    // and can run in parallel with agent-targeted messages (like heartbeats).
    let resolvedAgent = agent;
    if (!resolvedAgent) {
        const settings = getSettings();
        const agents = getAgents(settings);
        const teams = getTeams(settings);
        const routing = parseAgentRouting(message, agents, teams);
        resolvedAgent = routing.agentId;
    }

    const rowId = enqueueMessage({
        channel: resolvedChannel,
        sender: resolvedSender,
        senderId: senderId || undefined,
        message,
        messageId,
        agent: resolvedAgent,
    });

    if (rowId === null) {
        return c.json({ error: 'duplicate messageId', messageId }, 409);
    }

    // Persist user message immediately so it appears on the next poll
    if (resolvedAgent) {
        insertAgentMessage({
            agentId: resolvedAgent,
            role: 'user',
            channel: resolvedChannel,
            sender: resolvedSender,
            messageId,
            content: message,
        });
    }

    log('INFO', `[API] Message enqueued: ${message}`);
    emitEvent('message:incoming', {
        messageId,
        agent: resolvedAgent || null,
        channel: resolvedChannel,
        sender: resolvedSender,
        message: message.substring(0, 120),
    });

    return c.json({ ok: true, messageId });
});

export default app;
