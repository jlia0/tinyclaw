import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Hono } from 'hono';
import { SCRIPT_DIR, getSettings } from '@tinyclaw/core';
import { log } from '@tinyclaw/core';

const app = new Hono();
const execFileAsync = promisify(execFile);

const TINYCLAW_SH = path.join(SCRIPT_DIR, 'tinyclaw.sh');

async function runTinyclaw(...args: string[]): Promise<string> {
    const { stdout, stderr } = await execFileAsync('bash', [TINYCLAW_SH, ...args], {
        cwd: SCRIPT_DIR,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
    });
    return `${stdout}${stderr ? `\n${stderr}` : ''}`.trim();
}

// POST /api/services/apply — start channels + heartbeat based on current settings
app.post('/api/services/apply', async (c) => {
    const settings = getSettings();
    const enabledChannels = settings.channels?.enabled || [];
    const started: string[] = [];
    const errors: string[] = [];

    // Start each enabled channel
    for (const ch of enabledChannels) {
        try {
            await runTinyclaw('channel', 'start', ch);
            started.push(ch);
        } catch (err) {
            const msg = (err as Error).message;
            // "already running" is not an error
            if (msg.includes('already running')) {
                started.push(ch);
            } else {
                errors.push(`${ch}: ${msg}`);
                log('ERROR', `[services/apply] Failed to start channel ${ch}: ${msg}`);
            }
        }
    }

    // Start heartbeat
    let heartbeat = false;
    try {
        await runTinyclaw('heartbeat', 'start');
        heartbeat = true;
    } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('already running')) {
            heartbeat = true;
        } else {
            errors.push(`heartbeat: ${msg}`);
            log('ERROR', `[services/apply] Failed to start heartbeat: ${msg}`);
        }
    }

    log('INFO', `[services/apply] Started channels=[${started.join(',')}] heartbeat=${heartbeat}`);
    return c.json({ ok: true, started, heartbeat, errors: errors.length ? errors : undefined });
});

export default app;
