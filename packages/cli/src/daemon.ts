/**
 * Daemon lifecycle — start, stop, restart, status.
 */

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { TINYAGI_HOME, SCRIPT_DIR } from '@tinyagi/core';

// ── Constants ────────────────────────────────────────────────────────────────

const PID_FILE = path.join(TINYAGI_HOME, 'tinyagi.pid');
const LOG_DIR = path.join(TINYAGI_HOME, 'logs');
const API_PORT = parseInt(process.env.TINYAGI_API_PORT || '3777', 10);
const API_URL = `http://localhost:${API_PORT}`;

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const NC = '\x1b[0m';

function log(color: string, msg: string): void {
    process.stdout.write(`${color}${msg}${NC}\n`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getMainScript(): string | null {
    const local = path.join(SCRIPT_DIR, 'packages/main/dist/index.js');
    const installed = path.join(TINYAGI_HOME, 'packages/main/dist/index.js');
    if (fs.existsSync(local)) return local;
    if (fs.existsSync(installed)) return installed;
    return null;
}

export function isRunning(): boolean {
    if (!fs.existsSync(PID_FILE)) return false;
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        fs.unlinkSync(PID_FILE);
        return false;
    }
}

async function fetchStatus(): Promise<any> {
    try {
        const res = await fetch(`${API_URL}/api/status`);
        return await res.json();
    } catch {
        return null;
    }
}

async function waitForServer(maxWait = 8000): Promise<any> {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
        const status = await fetchStatus();
        if (status?.ok) return status;
        await new Promise(r => setTimeout(r, 300));
    }
    return null;
}

export function formatUptime(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
}

// ── Commands ─────────────────────────────────────────────────────────────────

export async function startDaemon(): Promise<void> {
    if (isRunning()) {
        log(YELLOW, 'TinyAGI is already running');
        return;
    }

    const mainScript = getMainScript();
    if (!mainScript) {
        log(RED, 'TinyAGI is not built. Run "npm run build" first.');
        process.exit(1);
    }

    fs.mkdirSync(LOG_DIR, { recursive: true });

    const logFile = path.join(LOG_DIR, 'daemon.log');
    const out = fs.openSync(logFile, 'a');

    const child = spawn('node', [mainScript], {
        detached: true,
        stdio: ['ignore', out, out],
        env: { ...process.env, TINYAGI_HOME },
    });

    fs.writeFileSync(PID_FILE, String(child.pid));
    child.unref();

    log(GREEN, `TinyAGI started (PID: ${child.pid})`);

    const status = await waitForServer();
    if (status) {
        log(GREEN, `  Server:    http://localhost:${status.server?.port || API_PORT}`);

        const channels = status.channels || {};
        const channelNames = Object.keys(channels);
        if (channelNames.length > 0) {
            for (const ch of channelNames) {
                const c = channels[ch];
                const icon = c.running ? GREEN + '●' : RED + '○';
                log(NC, `  Channel:   ${icon} ${ch}${c.pid ? ` (PID: ${c.pid})` : ''}${NC}`);
            }
        } else {
            log(NC, `  Channels:  ${YELLOW}none enabled${NC}`);
        }

        const hb = status.heartbeat || {};
        if (hb.running) {
            log(NC, `  Heartbeat: ${GREEN}● running${NC} (interval: ${hb.interval}s)`);
        } else {
            log(NC, `  Heartbeat: ${YELLOW}○ off${NC}`);
        }
    } else {
        log(YELLOW, '  (waiting for server...)');
    }

    log(NC, `  Logs:      ${logFile}`);
}

export function stopDaemon(): void {
    if (!fs.existsSync(PID_FILE)) {
        log(YELLOW, 'TinyAGI is not running');
        return;
    }

    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (pid === 1) {
        log(RED, 'TinyAGI is running as PID 1 (container mode). Use "tinyagi restart" or "docker restart" instead.');
        return;
    }
    try {
        process.kill(pid, 'SIGTERM');
        log(GREEN, `TinyAGI stopped (PID: ${pid})`);
    } catch {
        log(YELLOW, 'Process already exited');
    }
    try { fs.unlinkSync(PID_FILE); } catch {}
}

export async function statusDaemon(): Promise<void> {
    if (!isRunning()) {
        log(YELLOW, 'TinyAGI is not running');
        return;
    }

    const pid = fs.readFileSync(PID_FILE, 'utf8').trim();
    const status = await fetchStatus();

    if (!status?.ok) {
        log(GREEN, `TinyAGI is running (PID: ${pid})`);
        log(YELLOW, '  Server:    not responding');
        return;
    }

    log(GREEN, `TinyAGI is running (PID: ${pid}, uptime: ${formatUptime(status.uptime)})`);
    log(NC, `  Server:    ${GREEN}● http://localhost:${status.server?.port || API_PORT}${NC}`);

    // Queue status
    try {
        const qRes = await fetch(`${API_URL}/api/queue/status`);
        const q: any = await qRes.json();
        const parts: string[] = [];
        if (q.processing > 0) parts.push(`${q.processing} processing`);
        if (q.queued > 0) parts.push(`${q.queued} queued`);
        if (q.dead > 0) parts.push(`${RED}${q.dead} dead${NC}`);
        if (q.completed > 0) parts.push(`${q.completed} completed`);
        log(NC, `  Queue:     ${GREEN}●${NC} ${parts.length > 0 ? parts.join(', ') : 'idle'}`);
    } catch {
        log(NC, `  Queue:     ${YELLOW}? unknown${NC}`);
    }

    // Channels
    const channels = status.channels || {};
    const channelNames = Object.keys(channels);
    if (channelNames.length > 0) {
        for (const ch of channelNames) {
            const c = channels[ch];
            const icon = c.running ? GREEN + '●' : RED + '○';
            const state = c.running ? 'running' : 'stopped';
            log(NC, `  Channel:   ${icon} ${ch}${NC} — ${state}${c.pid ? ` (PID: ${c.pid})` : ''}`);
        }
    } else {
        log(NC, `  Channels:  ${YELLOW}none enabled${NC}`);
    }

    // Heartbeat
    const hb = status.heartbeat || {};
    if (hb.running) {
        const lastSent = Object.entries(hb.lastSent || {});
        const lastStr = lastSent.length > 0
            ? lastSent.map(([agent, ts]) => `${agent}: ${formatUptime(Math.floor(Date.now() / 1000) - (ts as number))} ago`).join(', ')
            : 'none yet';
        log(NC, `  Heartbeat: ${GREEN}● running${NC} (interval: ${hb.interval}s, last: ${lastStr})`);
    } else {
        log(NC, `  Heartbeat: ${YELLOW}○ off${NC}`);
    }
}

export async function restartDaemon(): Promise<void> {
    // Try API-based restart first (works in container mode and normal mode)
    try {
        const res = await fetch(`${API_URL}/api/services/restart`, { method: 'POST' });
        const data = await res.json() as any;
        if (data.ok) {
            log(GREEN, 'TinyAGI restarting...');
            // Wait for the process to come back up
            await new Promise(r => setTimeout(r, 2000));
            const status = await waitForServer();
            if (status) {
                log(GREEN, 'TinyAGI restarted successfully');
            } else {
                log(YELLOW, 'TinyAGI is restarting (may take a moment)');
            }
            return;
        }
    } catch {
        // API not available, fall back to kill+respawn
    }

    // Fallback: stop and start (non-container mode)
    stopDaemon();
    await new Promise(r => setTimeout(r, 1000));
    await startDaemon();
}

export async function openOffice(): Promise<void> {
    const PORTAL_URL = 'https://office.tinyagicompany.com';
    console.log('');
    log(GREEN, `Opening TinyOffice: ${PORTAL_URL}`);
    try {
        const open = (await import('open')).default;
        await open(PORTAL_URL);
    } catch {
        log(YELLOW, `Could not open browser. Visit ${PORTAL_URL} manually.`);
    }
}

// ── CLI Dispatch ─────────────────────────────────────────────────────────────

const command = process.argv[2];
const flags = process.argv.slice(3);

switch (command) {
    case 'start':
        await startDaemon();
        if (flags.includes('--open')) await openOffice();
        break;
    case 'stop':
        stopDaemon();
        break;
    case 'restart':
        await restartDaemon();
        break;
    case 'status':
        await statusDaemon();
        break;
}
