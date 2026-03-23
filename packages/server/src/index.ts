/**
 * API Server — HTTP endpoints for Mission Control and external integrations.
 *
 * Runs on a configurable port (env TINYAGI_API_PORT, default 3777) and
 * provides REST + SSE access to agents, teams, settings, queue status,
 * events, logs, and chat histories.
 */

import http from 'http';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import { log } from '@tinyagi/core';
import { addSSEClient, removeSSEClient } from './sse';

import messagesRoutes from './routes/messages';
import agentsRoutes from './routes/agents';
import teamsRoutes from './routes/teams';
import settingsRoutes from './routes/settings';
import { createQueueRoutes } from './routes/queue';
import tasksRoutes from './routes/tasks';
import projectsRoutes from './routes/projects';
import logsRoutes from './routes/logs';
import chatsRoutes from './routes/chats';
import chatroomRoutes from './routes/chatroom';
import agentMessagesRoutes from './routes/agent-messages';
import servicesRoutes from './routes/services';
import schedulesRoutes from './routes/schedules';
import { initTasksDb } from './tasks-db';

const API_PORT = parseInt(process.env.TINYAGI_API_PORT || '3777', 10);

/**
 * Create and start the API server.
 *
 * @returns The http.Server instance (for graceful shutdown).
 */
export function startApiServer(): http.Server {
    // Initialize tasks/projects SQLite database
    initTasksDb();

    const app = new Hono();

    // CORS middleware
    app.use('/*', cors());

    // Mount route modules
    app.route('/', messagesRoutes);
    app.route('/', agentsRoutes);
    app.route('/', teamsRoutes);
    app.route('/', settingsRoutes);
    app.route('/', createQueueRoutes());
    app.route('/', tasksRoutes);
    app.route('/', projectsRoutes);
    app.route('/', logsRoutes);
    app.route('/', chatsRoutes);
    app.route('/', chatroomRoutes);
    app.route('/', agentMessagesRoutes);
    app.route('/', servicesRoutes);
    app.route('/', schedulesRoutes);

    // SSE endpoint — needs raw Node.js response for streaming
    app.get('/api/events/stream', (c) => {
        const nodeRes = (c.env as { outgoing: http.ServerResponse }).outgoing;
        nodeRes.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        });
        nodeRes.write(`event: connected\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
        addSSEClient(nodeRes);
        nodeRes.on('close', () => removeSSEClient(nodeRes));
        return RESPONSE_ALREADY_SENT;
    });

    // 404 fallback
    app.notFound((c) => {
        return c.json({ error: 'Not found' }, 404);
    });

    // Error handler
    app.onError((err, c) => {
        log('ERROR', `[API] ${err.message}`);
        return c.json({ error: 'Internal server error' }, 500);
    });

    const server = serve({
        fetch: app.fetch,
        port: API_PORT,
    }, () => {
        log('INFO', `API server listening on http://localhost:${API_PORT}`);
    });

    return server as unknown as http.Server;
}
