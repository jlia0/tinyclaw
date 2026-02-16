import fs from 'fs';
import path from 'path';
import { LOG_FILE, EVENTS_DIR } from './config';

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
        const event = { type, timestamp: Date.now(), ...data };
        const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
        fs.writeFileSync(path.join(EVENTS_DIR, filename), JSON.stringify(event) + '\n');
    } catch {
        // Visualizer events are best-effort; never break the queue processor
    }
}
