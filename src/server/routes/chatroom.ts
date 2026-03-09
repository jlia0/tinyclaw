import { Hono } from 'hono';
import { getSettings, getTeams } from '../../lib/config';
import { getChatMessages } from '../../lib/db';
import { postToChatRoom } from '../../lib/conversation';

const app = new Hono();

// GET /api/chatroom/:teamId — Get recent chat room messages
app.get('/api/chatroom/:teamId', (c) => {
    const teamId = c.req.param('teamId');
    const teams = getTeams(getSettings());
    if (!teams[teamId]) {
        return c.json({ error: `team '${teamId}' not found` }, 404);
    }

    const limit = parseInt(c.req.query('limit') || '100', 10);
    const sinceId = parseInt(c.req.query('since') || '0', 10);

    const messages = getChatMessages(teamId, limit, sinceId);
    return c.json(messages);
});

// POST /api/chatroom/:teamId — Post a message to the chat room
app.post('/api/chatroom/:teamId', async (c) => {
    const teamId = c.req.param('teamId');
    const teams = getTeams(getSettings());
    const team = teams[teamId];
    if (!team) {
        return c.json({ error: `team '${teamId}' not found` }, 404);
    }

    const body = await c.req.json() as { message?: string };
    if (!body.message || !body.message.trim()) {
        return c.json({ error: 'message is required' }, 400);
    }

    postToChatRoom(teamId, 'user', body.message.trim(), team.agents, {
        channel: 'chatroom',
        sender: 'user',
        messageId: `chatroom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    });

    return c.json({ ok: true });
});

export default app;
