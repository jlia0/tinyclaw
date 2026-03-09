#!/usr/bin/env node
/**
 * Chatroom Viewer — Real-time TUI for watching and posting to team chat rooms.
 *
 * Polls the API server for new chat messages and displays them in a
 * scrolling log.  Supports type-to-send for posting messages.
 *
 * Usage:  node dist/visualizer/chatroom-viewer.js --team <id> [--port <num>]
 */

import React, { useState, useEffect, useCallback } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import http from 'http';
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
const SETTINGS_FILE = path.join(TINYCLAW_HOME, 'settings.json');

// ─── Types ──────────────────────────────────────────────────────────────────

interface TeamConfig {
    name: string;
    agents: string[];
    leader_agent: string;
}

interface ChatMessage {
    id: number;
    team_id: string;
    from_agent: string;
    message: string;
    created_at: number;
}

// ─── Settings loader ────────────────────────────────────────────────────────

function loadSettings(): { teams: Record<string, TeamConfig> } {
    try {
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const settings = JSON.parse(raw);
        return { teams: settings.teams || {} };
    } catch {
        return { teams: {} };
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString('en-US', {
        hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}

// ─── HTTP helpers ───────────────────────────────────────────────────────────

function fetchJson(url: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => { data += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

function postJson(url: string, body: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const urlObj = new URL(url);
        const req = http.request({
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
        }, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => { data += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

// ─── Components ─────────────────────────────────────────────────────────────

const MAX_VISIBLE_MESSAGES = 50;

function MessageLine({ msg }: { msg: ChatMessage }) {
    const isUser = msg.from_agent === 'user';
    const nameColor = isUser ? 'green' : 'cyan';
    const label = isUser ? 'you' : `@${msg.from_agent}`;

    return (
        <Box flexDirection="column" marginBottom={0}>
            <Box>
                <Text color="gray">[{formatTime(msg.created_at)}] </Text>
                <Text color={nameColor} bold>{label}</Text>
            </Box>
            <Box marginLeft={2}>
                <Text wrap="wrap">{msg.message}</Text>
            </Box>
        </Box>
    );
}

function App({ teamId, apiPort }: { teamId: string; apiPort: number }) {
    const { exit } = useApp();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [teamName, setTeamName] = useState('');
    const [error, setError] = useState('');
    const [connected, setConnected] = useState(false);
    const lastIdRef = React.useRef(0);

    // Load team name from settings
    useEffect(() => {
        const { teams } = loadSettings();
        const team = teams[teamId];
        if (team) {
            setTeamName(team.name);
        } else {
            setError(`Team '${teamId}' not found in settings`);
        }
    }, [teamId]);

    // Poll for new messages
    const poll = useCallback(async () => {
        try {
            const url = `http://localhost:${apiPort}/api/chatroom/${teamId}?since=${lastIdRef.current}&limit=100`;
            const data = await fetchJson(url) as ChatMessage[];
            if (Array.isArray(data) && data.length > 0) {
                lastIdRef.current = data[data.length - 1].id;
                setMessages(prev => {
                    const combined = [...prev, ...data];
                    return combined.slice(-MAX_VISIBLE_MESSAGES);
                });
            }
            setConnected(true);
            setError('');
        } catch {
            setConnected(false);
        }
    }, [teamId, apiPort]);

    useEffect(() => {
        // Initial fetch — get recent history
        poll();
        const timer = setInterval(poll, 1000);
        return () => clearInterval(timer);
    }, [poll]);

    // Send message
    const sendMessage = useCallback(async (text: string) => {
        try {
            await postJson(`http://localhost:${apiPort}/api/chatroom/${teamId}`, { message: text });
        } catch {
            setError('Failed to send message');
        }
    }, [teamId, apiPort]);

    // Keyboard input
    useInput((ch, key) => {
        if (key.return && input.trim()) {
            const text = input.trim();
            setInput('');
            sendMessage(text);
            return;
        }

        if (key.backspace || key.delete) {
            setInput(prev => prev.slice(0, -1));
            return;
        }

        // Quit on Ctrl+C or q when input is empty
        if (key.escape || (ch === 'q' && input === '')) {
            exit();
            return;
        }

        // Regular character input
        if (ch && !key.ctrl && !key.meta) {
            setInput(prev => prev + ch);
        }
    });

    const title = teamName ? `${teamName} (#${teamId})` : `#${teamId}`;

    return (
        <Box flexDirection="column" width="100%">
            {/* Header */}
            <Box borderStyle="single" borderBottom={false} borderLeft={false} borderRight={false} paddingX={1}>
                <Text bold color="cyan">Chat Room: {title}</Text>
                <Text> </Text>
                {connected
                    ? <Text color="green">{'\u25CF'} connected</Text>
                    : <Text color="red">{'\u25CB'} disconnected</Text>
                }
            </Box>

            {/* Messages */}
            <Box flexDirection="column" paddingX={1} flexGrow={1}>
                {messages.length === 0 && !error && (
                    <Text color="gray" italic>No messages yet. Type below to start the conversation.</Text>
                )}
                {messages.map((msg) => (
                    <MessageLine key={msg.id} msg={msg} />
                ))}
            </Box>

            {/* Error */}
            {error && (
                <Box paddingX={1}>
                    <Text color="red">{error}</Text>
                </Box>
            )}

            {/* Input */}
            <Box borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} paddingX={1}>
                <Text color="green" bold>{'> '}</Text>
                <Text>{input}</Text>
                <Text color="gray">{'\u2588'}</Text>
            </Box>

            {/* Help */}
            <Box paddingX={1}>
                <Text color="gray" dimColor>Enter to send | q to quit | Esc to exit</Text>
            </Box>
        </Box>
    );
}

// ─── Entry point ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let teamId: string | null = null;
let apiPort = parseInt(process.env.TINYCLAW_API_PORT || '3777', 10);

for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--team' || args[i] === '-t') && args[i + 1]) {
        teamId = args[i + 1];
        i++;
    }
    if ((args[i] === '--port' || args[i] === '-p') && args[i + 1]) {
        apiPort = parseInt(args[i + 1], 10);
        i++;
    }
}

if (!teamId) {
    console.error('Usage: chatroom-viewer --team <team_id> [--port <num>]');
    process.exit(1);
}

render(<App teamId={teamId!} apiPort={apiPort} />);
