/**
 * Heartbeat — Periodically prompts agents via the API server.
 * Replaces lib/heartbeat-cron.sh with a pure Node.js implementation.
 */

import fs from 'fs';
import path from 'path';
import { getSettings, getAgents, SETTINGS_FILE, log } from '@tinyagi/core';

const API_PORT = parseInt(process.env.TINYAGI_API_PORT || '3777', 10);
const API_URL = `http://localhost:${API_PORT}`;

const lastSentAt = new Map<string, number>();
let timer: ReturnType<typeof setInterval> | null = null;

function getHeartbeatInterval(): number {
    const settings = getSettings();
    return settings?.monitoring?.heartbeat_interval ?? 3600;
}

function isHeartbeatEnabled(): boolean {
    const settings = getSettings();
    return settings?.heartbeat?.enabled !== false;
}

function getBaseInterval(): number {
    const defaultInterval = getHeartbeatInterval();
    const settings = getSettings();
    const agents = getAgents(settings);

    let minOverride = defaultInterval;
    for (const agent of Object.values(agents)) {
        const override = agent.heartbeat?.interval;
        if (typeof override === 'number' && override > 0 && override < minOverride) {
            minOverride = override;
        }
    }

    return Math.max(minOverride, 10);
}

async function tick(): Promise<void> {
    if (!isHeartbeatEnabled()) return;
    const settings = getSettings();
    const agents = getAgents(settings);
    const defaultInterval = getHeartbeatInterval();
    const workspacePath = settings?.workspace?.path
        || path.join(require('os').homedir(), 'tinyagi-workspace');

    const now = Math.floor(Date.now() / 1000);

    for (const [agentId, agent] of Object.entries(agents)) {
        if (agent.heartbeat?.enabled === false) continue;

        const agentInterval = agent.heartbeat?.interval ?? defaultInterval;
        const last = lastSentAt.get(agentId);
        if (last !== undefined && (now - last) < agentInterval) continue;

        const agentDir = agent.working_directory || path.join(workspacePath, agentId);
        const heartbeatFile = path.join(agentDir, 'heartbeat.md');

        let prompt: string;
        if (fs.existsSync(heartbeatFile)) {
            prompt = fs.readFileSync(heartbeatFile, 'utf8');
        } else {
            prompt = 'Quick status check: Any pending tasks? Keep response brief.';
        }

        try {
            const res = await fetch(`${API_URL}/api/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: prompt,
                    agent: agentId,
                    channel: 'heartbeat',
                    sender: 'System',
                }),
            });
            const data = await res.json() as { ok?: boolean; messageId?: string };
            if (data.ok) {
                log('INFO', `Heartbeat queued for @${agentId}: ${data.messageId}`);
                lastSentAt.set(agentId, now);
            } else {
                log('ERROR', `Heartbeat failed for @${agentId}: ${JSON.stringify(data)}`);
            }
        } catch (err) {
            log('ERROR', `Heartbeat error for @${agentId}: ${(err as Error).message}`);
        }
    }
}

export function startHeartbeat(): void {
    if (!isHeartbeatEnabled()) {
        log('INFO', 'Heartbeat disabled (heartbeat.enabled=false in settings)');
        return;
    }
    const interval = getBaseInterval();
    log('INFO', `Heartbeat started (interval: ${interval}s)`);
    timer = setInterval(() => { tick().catch(() => {}); }, interval * 1000);
}

export function stopHeartbeat(): void {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}

export function getHeartbeatStatus(): { running: boolean; interval: number; lastSent: Record<string, number> } {
    return {
        running: timer !== null,
        interval: getBaseInterval(),
        lastSent: Object.fromEntries(lastSentAt),
    };
}
