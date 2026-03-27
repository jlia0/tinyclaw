/**
 * Log viewing — tail daemon and channel log files.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { TINYAGI_HOME } from '@tinyagi/core';

const LOG_DIR = path.join(TINYAGI_HOME, 'logs');

const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const NC = '\x1b[0m';

function log(color: string, msg: string): void {
    process.stdout.write(`${color}${msg}${NC}\n`);
}

const LOG_FILES: Record<string, string> = {
    queue: 'queue.log',
    daemon: 'daemon.log',
    heartbeat: 'heartbeat.log',
    discord: 'discord.log',
    telegram: 'telegram.log',
    whatsapp: 'whatsapp.log',
};

export function viewLogs(type?: string): void {
    if (type === 'all' || !type) {
        const files = Object.values(LOG_FILES)
            .map(f => path.join(LOG_DIR, f))
            .filter(f => fs.existsSync(f));
        if (files.length === 0) {
            log(YELLOW, 'No log files found');
            return;
        }
        const child = spawn('tail', ['-f', ...files], { stdio: 'inherit' });
        child.on('exit', (code: number | null) => process.exit(code || 0));
    } else {
        const file = LOG_FILES[type];
        if (!file) {
            log(RED, `Unknown log type: ${type}`);
            console.log(`Available: ${Object.keys(LOG_FILES).join(', ')}, all`);
            process.exit(1);
        }
        const logPath = path.join(LOG_DIR, file);
        if (!fs.existsSync(logPath)) {
            log(YELLOW, `No ${type} log file found`);
            return;
        }
        const child = spawn('tail', ['-f', logPath], { stdio: 'inherit' });
        child.on('exit', (code: number | null) => process.exit(code || 0));
    }
}

// ── CLI Dispatch ─────────────────────────────────────────────────────────────

viewLogs(process.argv[2]);
