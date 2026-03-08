/**
 * Heartbeat system for monitoring queue-processor health.
 * 
 * The queue-processor writes a heartbeat file every 5 seconds. Channel clients
 * and other monitors can check this file to detect if the queue-processor has
 * crashed or become unresponsive.
 * 
 * This is more reliable than file-based signaling alone, which has no way to
 * detect when the writer has died.
 */

import fs from 'fs';
import path from 'path';
import { TINYCLAW_HOME } from './config';

const HEARTBEAT_FILE = path.join(TINYCLAW_HOME, 'heartbeat.json');
let heartbeatInterval: NodeJS.Timeout | null = null;

export interface HeartbeatData {
    timestamp: number;
    pid: number;
    uptime: number;
}

/**
 * Start writing heartbeat every 5 seconds.
 * Call this when queue-processor starts.
 */
export function startHeartbeat(): void {
    // Write initial heartbeat immediately
    writeHeartbeat();
    
    // Update every 5 seconds
    heartbeatInterval = setInterval(writeHeartbeat, 5000);
}

/**
 * Stop writing heartbeat and clean up.
 * Call this on graceful shutdown.
 */
export function stopHeartbeat(): void {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    // Remove heartbeat file on clean shutdown
    if (fs.existsSync(HEARTBEAT_FILE)) {
        fs.unlinkSync(HEARTBEAT_FILE);
    }
}

/**
 * Write current heartbeat to file.
 */
function writeHeartbeat(): void {
    const heartbeat: HeartbeatData = {
        timestamp: Date.now(),
        pid: process.pid,
        uptime: process.uptime(),
    };
    
    try {
        // Write atomically using temp file + rename
        const tempFile = `${HEARTBEAT_FILE}.tmp`;
        fs.writeFileSync(tempFile, JSON.stringify(heartbeat));
        fs.renameSync(tempFile, HEARTBEAT_FILE);
    } catch (e) {
        // Ignore write errors - don't crash the queue processor
    }
}

/**
 * Read current heartbeat data.
 */
export function getHeartbeat(): HeartbeatData | null {
    if (!fs.existsSync(HEARTBEAT_FILE)) {
        return null;
    }
    try {
        const content = fs.readFileSync(HEARTBEAT_FILE, 'utf8');
        return JSON.parse(content) as HeartbeatData;
    } catch {
        return null;
    }
}

/**
 * Check if heartbeat is stale (queue-processor may have crashed).
 * Default threshold: 15 seconds (3 missed heartbeats).
 */
export function isHeartbeatStale(thresholdMs = 15000): boolean {
    const hb = getHeartbeat();
    if (!hb) return true;
    return Date.now() - hb.timestamp > thresholdMs;
}

/**
 * Get time since last heartbeat in milliseconds.
 */
export function getTimeSinceHeartbeat(): number | null {
    const hb = getHeartbeat();
    if (!hb) return null;
    return Date.now() - hb.timestamp;
}
