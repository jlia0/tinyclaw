import fs from 'fs';
import path from 'path';
import { LOG_FILE, EVENTS_DIR } from './config';

const EVENT_RETENTION_MS = Number(process.env.TINYCLAW_EVENT_RETENTION_MS || (24 * 60 * 60 * 1000));
let lastEventCleanup = 0;

export function log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(LOG_FILE, logMessage);
}

/**
 * Emit a structured event for the team visualizer TUI.
 * Events are written as JSON files to EVENTS_DIR, watched by the visualizer.
 */
export function emitEvent(type: string, data: Record<string, unknown>): void {
    try {
        if (!fs.existsSync(EVENTS_DIR)) {
            fs.mkdirSync(EVENTS_DIR, { recursive: true });
        }
        const now = Date.now();
        if (now - lastEventCleanup > 60_000) {
            lastEventCleanup = now;
            const files = fs.readdirSync(EVENTS_DIR).filter(f => f.endsWith('.json'));
            for (const file of files) {
                const filePath = path.join(EVENTS_DIR, file);
                try {
                    const stat = fs.statSync(filePath);
                    if (now - stat.mtimeMs > EVENT_RETENTION_MS) {
                        fs.unlinkSync(filePath);
                    }
                } catch {
                    // Best-effort cleanup only.
                }
            }
        }
        const event = { type, timestamp: Date.now(), ...data };
        const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
        fs.writeFileSync(path.join(EVENTS_DIR, filename), JSON.stringify(event) + '\n');
    } catch {
        // Visualizer events are best-effort; never break the queue processor
    }
}
