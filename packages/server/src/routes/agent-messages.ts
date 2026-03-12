import { Hono } from 'hono';
import { getAgentMessages, getAllAgentMessages } from '@tinyclaw/core';

const app = new Hono();

// GET /api/agent-messages — all agent messages (across all agents)
app.get('/api/agent-messages', (c) => {
    const limit = parseInt(c.req.query('limit') || '100', 10);
    const sinceId = parseInt(c.req.query('since_id') || '0', 10);
    return c.json(getAllAgentMessages(limit, sinceId));
});

// GET /api/agents/:id/messages — messages for a specific agent
app.get('/api/agents/:id/messages', (c) => {
    const agentId = c.req.param('id');
    const limit = parseInt(c.req.query('limit') || '100', 10);
    const sinceId = parseInt(c.req.query('since_id') || '0', 10);

    return c.json(getAgentMessages(agentId, limit, sinceId));
});

export default app;
