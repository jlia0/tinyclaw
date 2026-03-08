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
 * The plugin system also registers a listener for plugin event handlers.
 */
type EventListener = (type: string, data: Record<string, unknown>) => void | Promise<void>;
const eventListeners: EventListener[] = [];

/** Register a listener that is called on every emitEvent. */
export function onEvent(listener: EventListener): void {
    eventListeners.push(listener);
}

/**
 * Emit a structured event — dispatched to in-memory listeners (e.g. SSE broadcast, plugins).
 * Now async to allow listeners to complete before continuing.
 */
export async function emitEvent(type: string, data: Record<string, unknown>): Promise<void> {
    await Promise.allSettled(
        eventListeners.map(listener => {
            try { return Promise.resolve(listener(type, data)); } catch { return Promise.resolve(); }
        })
    );
}
