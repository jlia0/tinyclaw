#!/usr/bin/env node
/**
 * Team Visualizer — Real-time TUI for watching team conversations.
 *
 * Connects to the API server's SSE endpoint for live events and
 * polls SQLite for queue depth stats.  Renders a live dashboard with
 * Ink (React for CLI).
 *
 * Usage:  node dist/team-visualizer.js [--team <id>] [--port <num>]
 */

import React, { useState, useEffect, useCallback } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import http from 'http';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

// ─── Paths ──────────────────────────────────────────────────────────────────
const __filename_ = fileURLToPath(import.meta.url);
const __dirname_ = path.dirname(__filename_);
const _localTinyclaw = path.join(__dirname_, '..', '..', '.tinyclaw');
const TINYCLAW_HOME = fs.existsSync(path.join(_localTinyclaw, 'settings.json'))
    ? _localTinyclaw
    : path.join(os.homedir(), '.tinyclaw');
const QUEUE_DB_PATH = path.join(TINYCLAW_HOME, 'tinyclaw.db');
const SETTINGS_FILE = path.join(TINYCLAW_HOME, 'settings.json');

// ─── SQLite helper ──────────────────────────────────────────────────────────

function openDb(): Database.Database | null {
    try {
        if (!fs.existsSync(QUEUE_DB_PATH)) return null;
        const db = new Database(QUEUE_DB_PATH, { readonly: true });
        db.pragma('journal_mode = WAL');
        return db;
    } catch {
        return null;
    }
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface TeamConfig {
    name: string;
    agents: string[];
    leader_agent: string;
}

interface AgentConfig {
    name: string;
    provider: string;
    model: string;
    working_directory: string;
}

interface TinyClawEvent {
    type: string;
    timestamp: number;
    [key: string]: unknown;
}

type AgentStatus = 'idle' | 'active' | 'done' | 'error' | 'waiting';

interface AgentState {
    id: string;
    name: string;
    provider: string;
    model: string;
    status: AgentStatus;
    lastActivity: string;
    responseLength?: number;
}

interface ChainArrow {
    from: string;
    to: string;
    step: number;
    timestamp: number;
}

interface LogEntry {
    time: string;
    icon: string;
    text: string;
    color: string;
}

// ─── Settings loader ────────────────────────────────────────────────────────

function loadSettings(): { teams: Record<string, TeamConfig>; agents: Record<string, AgentConfig> } {
    try {
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const settings = JSON.parse(raw);
        return {
            teams: settings.teams || {},
            agents: settings.agents || {},
        };
    } catch {
        return { teams: {}, agents: {} };
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 5) return 'just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
}

function shortTime(ts: number): string {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function truncate(s: string, max: number): string {
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + '\u2026';
}

const STATUS_ICON: Record<AgentStatus, string> = {
    idle: '\u25CB',     // ○
    active: '\u25CF',   // ●
    done: '\u2713',     // ✓
    error: '\u2717',    // ✗
    waiting: '\u25D4',  // ◔
};

const STATUS_COLOR: Record<AgentStatus, string> = {
    idle: 'gray',
    active: 'cyan',
    done: 'green',
    error: 'red',
    waiting: 'yellow',
};

// ─── Components ─────────────────────────────────────────────────────────────

function Header({ teamId, teamName, uptime }: { teamId: string | null; teamName: string | null; uptime: string }) {
    return (
        <Box flexDirection="column" marginBottom={1}>
            <Box>
                <Text bold color="magenta">{'  \u2726 '}</Text>
                <Text bold color="white">TinyClaw Team Visualizer</Text>
                <Text color="gray">{' \u2502 '}</Text>
                {teamId ? (
                    <Text>
                        <Text color="cyan" bold>@{teamId}</Text>
                        <Text color="gray"> ({teamName})</Text>
                    </Text>
                ) : (
                    <Text color="yellow">all teams</Text>
                )}
                <Text color="gray">{' \u2502 '}</Text>
                <Text color="gray">{uptime}</Text>
            </Box>
            <Text color="gray">{'\u2500'.repeat(72)}</Text>
        </Box>
    );
}

function AgentCard({ agent, isLeader }: { agent: AgentState; isLeader: boolean }) {
    const color = STATUS_COLOR[agent.status];
    const icon = STATUS_ICON[agent.status];
    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={agent.status === 'active' ? 'cyan' : agent.status === 'done' ? 'green' : 'gray'}
            paddingX={1}
            width={30}
        >
            <Box>
                <Text color={color}>{icon} </Text>
                <Text bold color="white">@{agent.id}</Text>
                {isLeader && <Text color="yellow"> {'\u2605'}</Text>}
            </Box>
            <Text color="gray">{agent.name}</Text>
            <Text dimColor>{agent.provider}/{agent.model}</Text>
            <Box marginTop={0}>
                {agent.status === 'active' ? (
                    <Text color="cyan">{'\u25B8'} Processing{dots()}</Text>
                ) : agent.status === 'done' ? (
                    <Text color="green">{'\u2713'} Done ({agent.responseLength ?? 0} chars)</Text>
                ) : agent.status === 'error' ? (
                    <Text color="red">{'\u2717'} Error</Text>
                ) : (
                    <Text color="gray">{agent.lastActivity || 'Idle'}</Text>
                )}
            </Box>
        </Box>
    );
}

function dots(): string {
    const n = Math.floor((Date.now() / 400) % 4);
    return '.'.repeat(n);
}

function ChainFlow({ arrows }: { arrows: ChainArrow[] }) {
    if (arrows.length === 0) return null;
    return (
        <Box flexDirection="column" marginY={1}>
            <Text bold color="white">{'\u21C0'} Message Flow</Text>
            <Box flexDirection="row" gap={1}>
                {arrows.map((arrow, i) => (
                    <Box key={i}>
                        <Text color="cyan" bold>@{arrow.from}</Text>
                        <Text color="yellow">{' \u2192 '}</Text>
                        <Text color="magenta" bold>@{arrow.to}</Text>
                        {i < arrows.length - 1 && <Text color="gray">{' \u2502'}</Text>}
                    </Box>
                ))}
            </Box>
        </Box>
    );
}

function ActivityLog({ entries }: { entries: LogEntry[] }) {
    const visible = entries.slice(-12);
    return (
        <Box flexDirection="column" marginTop={1}>
            <Text bold color="white">{'\u2630'} Activity</Text>
            <Text color="gray">{'\u2500'.repeat(72)}</Text>
            {visible.length === 0 ? (
                <Text color="gray" italic>  Waiting for events... (send a message to a team)</Text>
            ) : (
                visible.map((entry, i) => (
                    <Box key={i}>
                        <Text color="gray">{entry.time} </Text>
                        <Text>{entry.icon} </Text>
                        <Text color={entry.color as any}>{entry.text}</Text>
                    </Box>
                ))
            )}
        </Box>
    );
}

function StatusBar({ queueDepth, totalProcessed, processorAlive, deadCount }: { queueDepth: number; totalProcessed: number; processorAlive: boolean; deadCount: number }) {
    const sep = '\u2502';
    return (
        <Box flexDirection="column" marginTop={1}>
            <Text color="gray">{'\u2500'.repeat(72)}</Text>
            <Box gap={2}>
                {processorAlive ? (
                    <Text color="green">{'\u25CF'} Queue Processor Online</Text>
                ) : (
                    <Text color="yellow">{'\u25CB'} Queue Processor Idle</Text>
                )}
                <Text color="gray">{sep}</Text>
                <Text color="white">Queue: <Text color={queueDepth > 0 ? 'yellow' : 'green'}>{queueDepth}</Text></Text>
                <Text color="gray">{sep}</Text>
                <Text color="white">Processed: <Text color="cyan">{totalProcessed}</Text></Text>
                {deadCount > 0 && (
                    <>
                        <Text color="gray">{sep}</Text>
                        <Text color="red">Dead: {deadCount}</Text>
                    </>
                )}
                <Text color="gray">{sep}</Text>
                <Text dimColor>q to quit</Text>
            </Box>
        </Box>
    );
}

// ─── Main App ───────────────────────────────────────────────────────────────

function App({ filterTeamId, apiPort }: { filterTeamId: string | null; apiPort: number }) {
    const { exit } = useApp();
    const [settings, setSettings] = useState(() => loadSettings());
    const [agentStates, setAgentStates] = useState<Record<string, AgentState>>({});
    const [arrows, setArrows] = useState<ChainArrow[]>([]);
    const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
    const [totalProcessed, setTotalProcessed] = useState(0);
    const [queueDepth, setQueueDepth] = useState(0);
    const [deadCount, setDeadCount] = useState(0);
    const [processorAlive, setProcessorAlive] = useState(false);
    const [startTime] = useState(Date.now());
    const [, setTick] = useState(0);

    // Force re-render every second for animated dots and uptime
    useEffect(() => {
        const timer = setInterval(() => setTick(t => t + 1), 500);
        return () => clearInterval(timer);
    }, []);

    useInput((input: string) => {
        if (input === 'q' || input === 'Q') {
            exit();
        }
    }, { isActive: process.stdin.isTTY === true });

    // Initialize agent states from settings
    useEffect(() => {
        const { agents, teams } = settings;
        const states: Record<string, AgentState> = {};

        // Determine which agents to show
        let agentIds: string[];
        if (filterTeamId && teams[filterTeamId]) {
            agentIds = teams[filterTeamId].agents;
        } else {
            // Show all agents that belong to any team
            const teamAgentIds = new Set<string>();
            for (const team of Object.values(teams)) {
                for (const aid of team.agents) teamAgentIds.add(aid);
            }
            agentIds = teamAgentIds.size > 0 ? Array.from(teamAgentIds) : Object.keys(agents);
        }

        for (const id of agentIds) {
            const agent = agents[id];
            if (agent) {
                states[id] = {
                    id,
                    name: agent.name,
                    provider: agent.provider || 'anthropic',
                    model: agent.model || 'sonnet',
                    status: 'idle',
                    lastActivity: '',
                };
            }
        }
        setAgentStates(states);
    }, [settings, filterTeamId]);

    // Add a log entry helper
    const addLog = useCallback((icon: string, text: string, color: string) => {
        setLogEntries(prev => {
            const entry: LogEntry = { time: shortTime(Date.now()), icon, text, color };
            const next = [...prev, entry];
            return next.length > 50 ? next.slice(-50) : next;
        });
    }, []);

    // Process a single event
    const handleEvent = useCallback((event: TinyClawEvent) => {
        switch (event.type) {
            case 'processor_start':
                setProcessorAlive(true);
                addLog('\u26A1', 'Queue processor started', 'green');
                // Refresh settings when processor starts
                setSettings(loadSettings());
                break;

            case 'message_received':
                addLog('\u2709', `[${event.channel}] ${event.sender}: ${truncate(String(event.message || ''), 50)}`, 'white');
                break;

            case 'agent_routed': {
                const aid = String(event.agentId);
                setAgentStates(prev => {
                    if (!prev[aid]) return prev;
                    return { ...prev, [aid]: { ...prev[aid], status: 'active' as AgentStatus, lastActivity: 'Routing...' } };
                });
                if (event.isTeamRouted) {
                    addLog('\u2691', `Routed to @${aid} (via team)`, 'cyan');
                } else {
                    addLog('\u2192', `Routed to @${aid}`, 'cyan');
                }
                break;
            }

            case 'team_chain_start':
                addLog('\u26D3', `Conversation started: ${event.teamName} [${(event.agents as string[]).map(a => '@' + a).join(', ')}]`, 'magenta');
                setArrows([]);
                break;

            case 'chain_step_start': {
                const aid = String(event.agentId);
                setAgentStates(prev => {
                    if (!prev[aid]) return prev;
                    return { ...prev, [aid]: { ...prev[aid], status: 'active' as AgentStatus, lastActivity: event.fromAgent ? `From @${event.fromAgent}` : 'Processing' } };
                });
                break;
            }

            case 'chain_step_done': {
                const aid = String(event.agentId);
                setAgentStates(prev => {
                    if (!prev[aid]) return prev;
                    return { ...prev, [aid]: { ...prev[aid], status: 'done' as AgentStatus, responseLength: event.responseLength as number } };
                });
                const text = event.responseText ? String(event.responseText) : `(${event.responseLength} chars)`;
                addLog('\u{1F4AC}', `@${aid}: ${text}`, 'white');
                break;
            }

            case 'chain_handoff': {
                const from = String(event.fromAgent);
                const to = String(event.toAgent);
                setArrows(prev => [...prev, { from, to, step: event.step as number, timestamp: event.timestamp }]);
                setAgentStates(prev => {
                    const updated = { ...prev };
                    if (updated[to]) {
                        updated[to] = { ...updated[to], status: 'waiting' as AgentStatus, lastActivity: `Handoff from @${from}` };
                    }
                    return updated;
                });
                addLog('\u2192', `@${from} \u2192 @${to}`, 'yellow');
                break;
            }

            case 'team_chain_end': {
                const chainAgents = event.agents as string[];
                addLog('\u2714', `Conversation complete [${chainAgents.map(a => '@' + a).join(', ')}]`, 'green');
                setAgentStates(prev => {
                    const updated = { ...prev };
                    for (const aid of chainAgents) {
                        if (updated[aid]) {
                            updated[aid] = { ...updated[aid], status: 'done' as AgentStatus };
                        }
                    }
                    return updated;
                });
                break;
            }

            case 'response_ready':
                setTotalProcessed(prev => prev + 1);
                // Reset agent states to idle after a short delay via next tick
                setTimeout(() => {
                    setAgentStates(prev => {
                        const updated = { ...prev };
                        for (const key of Object.keys(updated)) {
                            if (updated[key].status === 'done' || updated[key].status === 'error') {
                                updated[key] = { ...updated[key], status: 'idle' as AgentStatus, lastActivity: timeAgo(Date.now()) };
                            }
                        }
                        return updated;
                    });
                    setArrows([]);
                }, 3000);
                break;
        }
    }, [addLog]);

    // Connect to API server SSE for real-time events
    useEffect(() => {
        let req: http.ClientRequest | null = null;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let destroyed = false;

        function connect() {
            if (destroyed) return;
            req = http.get(`http://localhost:${apiPort}/api/events/stream`, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    // Retry after a delay
                    reconnectTimer = setTimeout(connect, 3000);
                    return;
                }

                setProcessorAlive(true);
                res.setEncoding('utf8');
                let buffer = '';

                res.on('data', (chunk: string) => {
                    buffer += chunk;
                    // Parse SSE frames: "event: <type>\ndata: <json>\n\n"
                    const frames = buffer.split('\n\n');
                    buffer = frames.pop() || '';
                    for (const frame of frames) {
                        if (!frame.trim()) continue;
                        const lines = frame.split('\n');
                        let data: string | null = null;
                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                data = line.slice(6);
                            }
                        }
                        if (data) {
                            try {
                                const event: TinyClawEvent = JSON.parse(data);
                                handleEvent(event);
                            } catch { /* skip malformed */ }
                        }
                    }
                });

                res.on('end', () => {
                    setProcessorAlive(false);
                    if (!destroyed) {
                        reconnectTimer = setTimeout(connect, 3000);
                    }
                });
            });

            req.on('error', () => {
                setProcessorAlive(false);
                if (!destroyed) {
                    reconnectTimer = setTimeout(connect, 3000);
                }
            });
        }

        connect();

        return () => {
            destroyed = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            if (req) { req.destroy(); }
        };
    }, [handleEvent, apiPort]);

    // Poll queue depth + dead count from SQLite
    useEffect(() => {
        const pollTimer = setInterval(() => {
            const db = openDb();
            if (!db) return;
            try {
                const pending = db.prepare(
                    "SELECT COUNT(*) as cnt FROM messages WHERE status = 'pending'"
                ).get() as { cnt: number };
                setQueueDepth(pending.cnt);

                const dead = db.prepare(
                    "SELECT COUNT(*) as cnt FROM messages WHERE status = 'dead'"
                ).get() as { cnt: number };
                setDeadCount(dead.cnt);
            } catch {
                setQueueDepth(0);
                setDeadCount(0);
            } finally {
                try { db.close(); } catch { /* ignore */ }
            }
        }, 1000);
        return () => clearInterval(pollTimer);
    }, []);


    // Determine current team info
    const teamId = filterTeamId;
    const teamName = teamId && settings.teams[teamId] ? settings.teams[teamId].name : null;
    const leaderAgent = teamId && settings.teams[teamId] ? settings.teams[teamId].leader_agent : null;

    const uptime = timeAgo(startTime);
    const agentList = Object.values(agentStates);

    return (
        <Box flexDirection="column" paddingX={1}>
            <Header teamId={teamId} teamName={teamName} uptime={`up ${uptime}`} />

            {/* Team topology */}
            {Object.keys(settings.teams).length === 0 ? (
                <Box flexDirection="column" marginBottom={1}>
                    <Text color="yellow">No teams configured.</Text>
                    <Text color="gray">Create a team with: tinyclaw team add</Text>
                </Box>
            ) : (
                <>
                    {/* Agent cards */}
                    <Box flexDirection="row" gap={1} flexWrap="wrap">
                        {agentList.map(agent => (
                            <AgentCard
                                key={agent.id}
                                agent={agent}
                                isLeader={agent.id === leaderAgent}
                            />
                        ))}
                    </Box>

                    {/* Chain flow arrows */}
                    <ChainFlow arrows={arrows} />

                    {/* Team legend when viewing all teams */}
                    {!filterTeamId && Object.keys(settings.teams).length > 0 && (
                        <Box flexDirection="column" marginTop={1}>
                            <Text bold color="white">{'\u2263'} Teams</Text>
                            {Object.entries(settings.teams).map(([id, team]) => (
                                <Box key={id}>
                                    <Text color="cyan" bold>  @{id}</Text>
                                    <Text color="gray"> {team.name} </Text>
                                    <Text color="gray">[{team.agents.map(a => '@' + a).join(', ')}]</Text>
                                    <Text color="yellow"> {'\u2605'} @{team.leader_agent}</Text>
                                </Box>
                            ))}
                        </Box>
                    )}
                </>
            )}

            {/* Activity log */}
            <ActivityLog entries={logEntries} />

            {/* Status bar */}
            <StatusBar queueDepth={queueDepth} totalProcessed={totalProcessed} processorAlive={processorAlive} deadCount={deadCount} />
        </Box>
    );
}

// ─── Entry point ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let filterTeamId: string | null = null;
let apiPort = parseInt(process.env.TINYCLAW_API_PORT || '3777', 10);

for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--team' || args[i] === '-t') && args[i + 1]) {
        filterTeamId = args[i + 1];
        i++;
    }
    if ((args[i] === '--port' || args[i] === '-p') && args[i + 1]) {
        apiPort = parseInt(args[i + 1], 10);
        i++;
    }
}

render(<App filterTeamId={filterTeamId} apiPort={apiPort} />);
