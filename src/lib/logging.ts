import fs from 'fs';
import { LOG_FILE } from './config';

export function log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(LOG_FILE, logMessage);
}

/**
 * Pluggable event listeners.  The API server registers a listener so that
 * every event emitted by the queue processor is also broadcast over SSE.
 */
type EventListener = (type: string, data: Record<string, unknown>) => void;
const eventListeners: EventListener[] = [];

/** Register a listener that is called on every emitEvent. */
export function onEvent(listener: EventListener): void {
    eventListeners.push(listener);
}

/**
 * Emit a structured event — dispatched to in-memory listeners (e.g. SSE broadcast).
 */
export function emitEvent(type: string, data: Record<string, unknown>): void {
    for (const listener of eventListeners) {
        try { listener(type, data); } catch { /* never break the queue processor */ }
    }
}
