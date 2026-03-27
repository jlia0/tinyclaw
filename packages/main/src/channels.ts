/**
 * Channel Spawner — Starts enabled messaging channels as child processes.
 * Replaces the channel-spawning logic from lib/daemon.sh and docker-entrypoint.sh.
 */

import { fork, ChildProcess } from 'child_process';
import path from 'path';
import { getSettings, SCRIPT_DIR, log } from '@tinyagi/core';

const CHANNEL_SCRIPTS: Record<string, string> = {
    discord: 'discord.js',
    telegram: 'telegram.js',
    whatsapp: 'whatsapp.js',
};

const TOKEN_ENV_KEYS: Record<string, string> = {
    discord: 'DISCORD_BOT_TOKEN',
    telegram: 'TELEGRAM_BOT_TOKEN',
};

const children = new Map<string, ChildProcess>();

function getChannelToken(channelId: string): string | undefined {
    // Check environment first (Docker / manual override)
    const envKey = TOKEN_ENV_KEYS[channelId];
    if (envKey && process.env[envKey]) return process.env[envKey];

    // Fall back to settings.json
    const settings = getSettings();
    const channelConf = (settings.channels as any)?.[channelId];
    return channelConf?.bot_token || undefined;
}

export function startChannels(): void {
    const settings = getSettings();
    const enabled = settings.channels?.enabled ?? [];

    if (enabled.length === 0) {
        log('INFO', 'No channels enabled');
        return;
    }

    for (const channelId of enabled) {
        const script = CHANNEL_SCRIPTS[channelId];
        if (!script) {
            log('WARN', `Unknown channel: ${channelId}`);
            continue;
        }

        const envKey = TOKEN_ENV_KEYS[channelId];
        const token = getChannelToken(channelId);

        // WhatsApp doesn't need a token (uses QR code auth)
        if (envKey && !token) {
            log('WARN', `${channelId} enabled but ${envKey} not set, skipping`);
            continue;
        }

        const scriptPath = path.join(SCRIPT_DIR, 'packages', 'channels', 'dist', script);
        const env: Record<string, string> = { ...process.env as Record<string, string> };
        if (envKey && token) {
            env[envKey] = token;
        }

        log('INFO', `Starting ${channelId} channel...`);
        const child = fork(scriptPath, [], { env, stdio: 'inherit' });

        child.on('exit', (code) => {
            log('INFO', `Channel ${channelId} exited (code ${code})`);
            children.delete(channelId);
        });

        children.set(channelId, child);
    }

    log('INFO', `Started ${children.size} channel(s): ${[...children.keys()].join(', ')}`);
}

export function stopChannel(channelId: string): boolean {
    const child = children.get(channelId);
    if (!child) return false;
    log('INFO', `Stopping ${channelId} channel...`);
    child.kill('SIGTERM');
    children.delete(channelId);
    return true;
}

export function startChannel(channelId: string): boolean {
    if (children.has(channelId)) {
        log('WARN', `Channel ${channelId} is already running`);
        return false;
    }

    const script = CHANNEL_SCRIPTS[channelId];
    if (!script) {
        log('WARN', `Unknown channel: ${channelId}`);
        return false;
    }

    const envKey = TOKEN_ENV_KEYS[channelId];
    const token = getChannelToken(channelId);

    if (envKey && !token) {
        log('WARN', `${channelId} requires ${envKey} but it is not set`);
        return false;
    }

    const scriptPath = path.join(SCRIPT_DIR, 'packages', 'channels', 'dist', script);
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (envKey && token) {
        env[envKey] = token;
    }

    log('INFO', `Starting ${channelId} channel...`);
    const child = fork(scriptPath, [], { env, stdio: 'inherit' });

    child.on('exit', (code) => {
        log('INFO', `Channel ${channelId} exited (code ${code})`);
        children.delete(channelId);
    });

    children.set(channelId, child);
    return true;
}

export function restartChannel(channelId: string): boolean {
    stopChannel(channelId);
    return startChannel(channelId);
}

export function stopChannels(): void {
    for (const [channelId, child] of children) {
        log('INFO', `Stopping ${channelId} channel...`);
        child.kill('SIGTERM');
    }
    children.clear();
}

export function getChannelStatus(): Record<string, { running: boolean; pid?: number }> {
    const settings = getSettings();
    const enabled = settings.channels?.enabled ?? [];
    const status: Record<string, { running: boolean; pid?: number }> = {};
    for (const ch of enabled) {
        const child = children.get(ch);
        status[ch] = {
            running: !!child && !child.killed,
            pid: child?.pid,
        };
    }
    // Also include any running channels not in enabled list
    for (const [ch, child] of children) {
        if (!status[ch]) {
            status[ch] = { running: !child.killed, pid: child.pid };
        }
    }
    return status;
}
