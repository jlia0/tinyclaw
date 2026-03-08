/**
 * Signal system for push notifications to channel clients.
 * 
 * Replaces HTTP polling with file-based signaling. When a response is ready,
 * the queue-processor writes a signal file; channel clients watch for this
 * file and immediately fetch responses.
 * 
 * This reduces latency from ~1-2 seconds (polling interval) to near-zero.
 */

import fs from 'fs';
import path from 'path';
import { TINYCLAW_HOME } from './config';

const SIGNALS_DIR = path.join(TINYCLAW_HOME, 'signals');

// Ensure signals directory exists
function ensureSignalsDir(): void {
    if (!fs.existsSync(SIGNALS_DIR)) {
        fs.mkdirSync(SIGNALS_DIR, { recursive: true });
    }
}

/**
 * Signal that a channel has pending responses.
 * Called by queue-processor when enqueueResponse is called.
 * 
 * This creates a file that channel clients watch for.
 */
export function signalChannel(channel: string): void {
    ensureSignalsDir();
    const signalFile = path.join(SIGNALS_DIR, `${channel}.ready`);
    fs.writeFileSync(signalFile, `${Date.now()}`);
}

/**
 * Watch for signals on a channel.
 * Called by channel clients to receive push notifications.
 * 
 * Returns a cleanup function to stop watching.
 */
export function watchChannel(
    channel: string,
    callback: () => void
): () => void {
    ensureSignalsDir();
    const signalFile = path.join(SIGNALS_DIR, `${channel}.ready`);

    // Initial check - if signal exists, trigger immediately
    if (fs.existsSync(signalFile)) {
        callback();
    }

    // Watch directory for changes
    const watcher = fs.watch(SIGNALS_DIR, (eventType, filename) => {
        if (filename === `${channel}.ready`) {
            callback();
        }
    });

    // Return cleanup function
    return () => watcher.close();
}

/**
 * Clear signal for a channel.
 * Called by channel client after processing responses.
 *
 * Handles race condition where two processes try to delete simultaneously:
 * First process deletes file successfully, second gets ENOENT which we ignore.
 */
export function clearSignal(channel: string): void {
    const signalFile = path.join(SIGNALS_DIR, `${channel}.ready`);
    try {
        fs.unlinkSync(signalFile);
    } catch (error: any) {
        // Ignore ENOENT: file already deleted by another process
        if (error?.code !== 'ENOENT') {
            throw error;
        }
    }
}

/**
 * Check if channel has signal (for polling fallback).
 */
export function hasSignal(channel: string): boolean {
    return fs.existsSync(path.join(SIGNALS_DIR, `${channel}.ready`));
}

/**
 * Get timestamp of last signal (for debugging).
 */
export function getSignalTimestamp(channel: string): number | null {
    const signalFile = path.join(SIGNALS_DIR, `${channel}.ready`);
    if (!fs.existsSync(signalFile)) {
        return null;
    }
    try {
        const content = fs.readFileSync(signalFile, 'utf8');
        return parseInt(content, 10);
    } catch {
        return null;
    }
}
