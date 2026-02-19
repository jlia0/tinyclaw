/**
 * API Server — HTTP endpoints for Mission Control and external integrations.
 *
 * Runs on a configurable port (env TINYCLAW_API_PORT, default 3001) and
 * provides REST + SSE access to agents, teams, settings, queue status,
 * events, logs, and chat histories.  Incoming messages are enqueued via
 * POST /api/message just like any other channel client.
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { MessageData, ResponseData, Settings, AgentConfig, TeamConfig, Conversation } from './types';
import {
    QUEUE_INCOMING, QUEUE_OUTGOING, QUEUE_PROCESSING,
    LOG_FILE, EVENTS_DIR, CHATS_DIR, SETTINGS_FILE,
    getSettings, getAgents, getTeams
} from './config';
import { log, emitEvent, onEvent } from './logging';

const API_PORT = parseInt(process.env.TINYCLAW_API_PORT || '3001', 10);

// ── SSE ──────────────────────────────────────────────────────────────────────

const sseClients = new Set<http.ServerResponse>();

/** Broadcast an SSE event to every connected client. */
function broadcastSSE(event: string, data: unknown): void {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
        try { client.write(message); } catch { sseClients.delete(client); }
    }
}

// Wire emitEvent → SSE so every queue-processor event is also pushed to the web.
onEvent((type, data) => {
    broadcastSSE(type, { type, timestamp: Date.now(), ...data });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString()));
        req.on('error', reject);
    });
}

function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(payload);
}

// ── Settings persistence ─────────────────────────────────────────────────────

/** Read, mutate, and persist settings.json atomically. */
function mutateSettings(fn: (settings: Settings) => void): Settings {
    const settings = getSettings();
    fn(settings);
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
    return settings;
}

// ── Server ───────────────────────────────────────────────────────────────────

/**
 * Create and start the API server.
 *
 * @param conversations  Live reference to the queue-processor conversation map
 *                       so the /api/queue/status endpoint can report active count.
 * @returns The http.Server instance (for graceful shutdown).
 */
export function startApiServer(
    conversations: Map<string, Conversation>
): http.Server {
    const server = http.createServer(async (req, res) => {
        // CORS preflight
        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            });
            res.end();
            return;
        }

        const url = new URL(req.url || '/', `http://localhost:${API_PORT}`);
        const pathname = url.pathname;

        try {
            // ── POST /api/message ────────────────────────────────────────
            if (req.method === 'POST' && pathname === '/api/message') {
                const body = JSON.parse(await readBody(req));
                const { message, agent, sender, channel } = body as {
                    message?: string; agent?: string; sender?: string; channel?: string;
                };

                if (!message || typeof message !== 'string') {
                    return jsonResponse(res, 400, { error: 'message is required' });
                }

                const messageData: MessageData = {
                    channel: channel || 'web',
                    sender: sender || 'Web',
                    message,
                    timestamp: Date.now(),
                    messageId: `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    agent: agent || undefined,
                };

                const filename = `${messageData.messageId}.json`;
                fs.writeFileSync(
                    path.join(QUEUE_INCOMING, filename),
                    JSON.stringify(messageData, null, 2)
                );

                log('INFO', `[API] Message enqueued: ${message.substring(0, 60)}...`);
                emitEvent('message_enqueued', {
                    messageId: messageData.messageId,
                    agent: agent || null,
                    message: message.substring(0, 120),
                });

                return jsonResponse(res, 200, { ok: true, messageId: messageData.messageId });
            }

            // ── GET /api/agents ──────────────────────────────────────────
            if (req.method === 'GET' && pathname === '/api/agents') {
                return jsonResponse(res, 200, getAgents(getSettings()));
            }

            // ── GET /api/teams ───────────────────────────────────────────
            if (req.method === 'GET' && pathname === '/api/teams') {
                return jsonResponse(res, 200, getTeams(getSettings()));
            }

            // ── GET /api/settings ────────────────────────────────────────
            if (req.method === 'GET' && pathname === '/api/settings') {
                return jsonResponse(res, 200, getSettings());
            }

            // ── PUT /api/settings ────────────────────────────────────────
            if (req.method === 'PUT' && pathname === '/api/settings') {
                const body = JSON.parse(await readBody(req));
                const current = getSettings();
                const merged = { ...current, ...body } as Settings;
                fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2) + '\n');
                log('INFO', '[API] Settings updated');
                return jsonResponse(res, 200, { ok: true, settings: merged });
            }

            // ── GET /api/queue/status ────────────────────────────────────
            if (req.method === 'GET' && pathname === '/api/queue/status') {
                const incoming = fs.readdirSync(QUEUE_INCOMING).filter(f => f.endsWith('.json')).length;
                const processing = fs.readdirSync(QUEUE_PROCESSING).filter(f => f.endsWith('.json')).length;
                const outgoing = fs.readdirSync(QUEUE_OUTGOING).filter(f => f.endsWith('.json')).length;
                return jsonResponse(res, 200, {
                    incoming,
                    processing,
                    outgoing,
                    activeConversations: conversations.size,
                });
            }

            // ── GET /api/responses ───────────────────────────────────────
            if (req.method === 'GET' && pathname === '/api/responses') {
                const limit = parseInt(url.searchParams.get('limit') || '20', 10);
                const files = fs.readdirSync(QUEUE_OUTGOING)
                    .filter(f => f.endsWith('.json'))
                    .map(f => ({ name: f, time: fs.statSync(path.join(QUEUE_OUTGOING, f)).mtimeMs }))
                    .sort((a, b) => b.time - a.time)
                    .slice(0, limit);

                const responses: ResponseData[] = [];
                for (const file of files) {
                    try {
                        responses.push(JSON.parse(fs.readFileSync(path.join(QUEUE_OUTGOING, file.name), 'utf8')));
                    } catch { /* skip bad files */ }
                }
                return jsonResponse(res, 200, responses);
            }

            // ── GET /api/events/stream (SSE) ─────────────────────────────
            if (req.method === 'GET' && pathname === '/api/events/stream') {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'Access-Control-Allow-Origin': '*',
                });
                res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
                sseClients.add(res);
                req.on('close', () => sseClients.delete(res));
                return;
            }

            // ── GET /api/events (polling) ────────────────────────────────
            if (req.method === 'GET' && pathname === '/api/events') {
                const since = parseInt(url.searchParams.get('since') || '0', 10);
                const limit = parseInt(url.searchParams.get('limit') || '50', 10);

                const eventFiles = fs.readdirSync(EVENTS_DIR)
                    .filter(f => f.endsWith('.json'))
                    .map(f => ({ name: f, ts: parseInt(f.split('-')[0], 10) }))
                    .filter(f => f.ts > since)
                    .sort((a, b) => b.ts - a.ts)
                    .slice(0, limit);

                const events: unknown[] = [];
                for (const file of eventFiles) {
                    try {
                        events.push(JSON.parse(fs.readFileSync(path.join(EVENTS_DIR, file.name), 'utf8')));
                    } catch { /* skip */ }
                }
                return jsonResponse(res, 200, events);
            }

            // ── GET /api/logs ────────────────────────────────────────────
            if (req.method === 'GET' && pathname === '/api/logs') {
                const limit = parseInt(url.searchParams.get('limit') || '100', 10);
                try {
                    const logContent = fs.readFileSync(LOG_FILE, 'utf8');
                    const lines = logContent.trim().split('\n').slice(-limit);
                    return jsonResponse(res, 200, { lines });
                } catch {
                    return jsonResponse(res, 200, { lines: [] });
                }
            }

            // ── GET /api/chats ───────────────────────────────────────────
            if (req.method === 'GET' && pathname === '/api/chats') {
                const chats: { teamId: string; file: string; time: number }[] = [];
                if (fs.existsSync(CHATS_DIR)) {
                    for (const teamDir of fs.readdirSync(CHATS_DIR)) {
                        const teamPath = path.join(CHATS_DIR, teamDir);
                        if (fs.statSync(teamPath).isDirectory()) {
                            for (const file of fs.readdirSync(teamPath).filter(f => f.endsWith('.md'))) {
                                const time = fs.statSync(path.join(teamPath, file)).mtimeMs;
                                chats.push({ teamId: teamDir, file, time });
                            }
                        }
                    }
                }
                chats.sort((a, b) => b.time - a.time);
                return jsonResponse(res, 200, chats);
            }

            // ── PUT /api/agents/:id — Create or update an agent ─────────
            if (req.method === 'PUT' && pathname.startsWith('/api/agents/')) {
                const agentId = pathname.slice('/api/agents/'.length);
                if (!agentId) return jsonResponse(res, 400, { error: 'agent id is required' });
                const body = JSON.parse(await readBody(req)) as Partial<AgentConfig>;
                if (!body.name || !body.provider || !body.model) {
                    return jsonResponse(res, 400, { error: 'name, provider, and model are required' });
                }
                const settings = mutateSettings(s => {
                    if (!s.agents) s.agents = {};
                    s.agents[agentId] = {
                        name: body.name!,
                        provider: body.provider!,
                        model: body.model!,
                        working_directory: body.working_directory || '',
                        ...(body.system_prompt ? { system_prompt: body.system_prompt } : {}),
                        ...(body.prompt_file ? { prompt_file: body.prompt_file } : {}),
                    };
                });
                log('INFO', `[API] Agent '${agentId}' saved`);
                return jsonResponse(res, 200, { ok: true, agent: settings.agents![agentId] });
            }

            // ── DELETE /api/agents/:id — Delete an agent ─────────────────
            if (req.method === 'DELETE' && pathname.startsWith('/api/agents/')) {
                const agentId = pathname.slice('/api/agents/'.length);
                if (!agentId) return jsonResponse(res, 400, { error: 'agent id is required' });
                const settings = getSettings();
                if (!settings.agents?.[agentId]) {
                    return jsonResponse(res, 404, { error: `agent '${agentId}' not found` });
                }
                mutateSettings(s => { delete s.agents![agentId]; });
                log('INFO', `[API] Agent '${agentId}' deleted`);
                return jsonResponse(res, 200, { ok: true });
            }

            // ── PUT /api/teams/:id — Create or update a team ─────────────
            if (req.method === 'PUT' && pathname.startsWith('/api/teams/')) {
                const teamId = pathname.slice('/api/teams/'.length);
                if (!teamId) return jsonResponse(res, 400, { error: 'team id is required' });
                const body = JSON.parse(await readBody(req)) as Partial<TeamConfig>;
                if (!body.name || !body.agents || !body.leader_agent) {
                    return jsonResponse(res, 400, { error: 'name, agents, and leader_agent are required' });
                }
                const settings = mutateSettings(s => {
                    if (!s.teams) s.teams = {};
                    s.teams[teamId] = {
                        name: body.name!,
                        agents: body.agents!,
                        leader_agent: body.leader_agent!,
                    };
                });
                log('INFO', `[API] Team '${teamId}' saved`);
                return jsonResponse(res, 200, { ok: true, team: settings.teams![teamId] });
            }

            // ── DELETE /api/teams/:id — Delete a team ────────────────────
            if (req.method === 'DELETE' && pathname.startsWith('/api/teams/')) {
                const teamId = pathname.slice('/api/teams/'.length);
                if (!teamId) return jsonResponse(res, 400, { error: 'team id is required' });
                const settings = getSettings();
                if (!settings.teams?.[teamId]) {
                    return jsonResponse(res, 404, { error: `team '${teamId}' not found` });
                }
                mutateSettings(s => { delete s.teams![teamId]; });
                log('INFO', `[API] Team '${teamId}' deleted`);
                return jsonResponse(res, 200, { ok: true });
            }

            // ── 404 ──────────────────────────────────────────────────────
            jsonResponse(res, 404, { error: 'Not found' });

        } catch (error) {
            log('ERROR', `[API] ${(error as Error).message}`);
            jsonResponse(res, 500, { error: 'Internal server error' });
        }
    });

    server.listen(API_PORT, () => {
        log('INFO', `API server listening on http://localhost:${API_PORT}`);
    });

    return server;
}
