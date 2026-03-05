import fs from 'fs';
import path from 'path';
import { TINYCLAW_HOME } from '../../lib/config';

export type OpenVikingSessionMapKey = {
    channel: string;
    senderId: string;
    agentId: string;
};

type OpenVikingSessionRecord = {
    sessionId: string;
    channel: string;
    senderId: string;
    agentId: string;
    updatedAt: string;
};

export type OpenVikingSessionMapEntry = {
    key: OpenVikingSessionMapKey;
    sessionId: string;
    updatedAt: string;
};

type OpenVikingSessionMap = {
    version: 1;
    sessions: Record<string, OpenVikingSessionRecord>;
};

const OPENVIKING_RUNTIME_DIR = path.join(TINYCLAW_HOME, 'runtime', 'openviking');
const OPENVIKING_SESSION_MAP_FILE = path.join(OPENVIKING_RUNTIME_DIR, 'session-map.json');

function ensureRuntimeDir(): void {
    if (!fs.existsSync(OPENVIKING_RUNTIME_DIR)) {
        fs.mkdirSync(OPENVIKING_RUNTIME_DIR, { recursive: true });
    }
}

function toCompositeKey(key: OpenVikingSessionMapKey): string {
    return `${key.channel}::${key.senderId}::${key.agentId}`;
}

// In-memory cache — single source of truth; all writes flush to disk via the serial queue.
let memCache: OpenVikingSessionMap | null = null;

function loadMapFromDisk(): OpenVikingSessionMap {
    ensureRuntimeDir();
    if (!fs.existsSync(OPENVIKING_SESSION_MAP_FILE)) {
        return { version: 1, sessions: {} };
    }
    try {
        const raw = fs.readFileSync(OPENVIKING_SESSION_MAP_FILE, 'utf8');
        const parsed = JSON.parse(raw) as Partial<OpenVikingSessionMap>;
        if (!parsed || typeof parsed !== 'object') {
            return { version: 1, sessions: {} };
        }
        const sessions = parsed.sessions;
        if (!sessions || typeof sessions !== 'object') {
            return { version: 1, sessions: {} };
        }
        return { version: 1, sessions: sessions as Record<string, OpenVikingSessionRecord> };
    } catch {
        return { version: 1, sessions: {} };
    }
}

function getCache(): OpenVikingSessionMap {
    if (!memCache) {
        memCache = loadMapFromDisk();
    }
    return memCache;
}

// Serial write queue — serialises disk flushes; the in-memory mutation is applied
// synchronously so subsequent reads see the change immediately.
let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite(fn: (map: OpenVikingSessionMap) => void): void {
    // Apply the mutation synchronously so in-process reads see it right away.
    const map = getCache();
    fn(map);
    // Flush to disk asynchronously, serialised behind any in-flight flush.
    const snapshot = JSON.stringify(map, null, 2) + '\n';
    writeQueue = writeQueue.then(() => {
        ensureRuntimeDir();
        const tmp = OPENVIKING_SESSION_MAP_FILE + '.tmp';
        fs.writeFileSync(tmp, snapshot, 'utf8');
        fs.renameSync(tmp, OPENVIKING_SESSION_MAP_FILE);
    }).catch(() => {
        // Reset cache on flush error so the next read reloads from disk.
        memCache = null;
    });
}

export function buildOpenVikingSessionMapKey(channel: string, senderId: string, agentId: string): OpenVikingSessionMapKey {
    return { channel, senderId, agentId };
}

export function getOpenVikingSessionId(key: OpenVikingSessionMapKey): string | null {
    const map = getCache();
    const record = map.sessions[toCompositeKey(key)];
    if (!record || !record.sessionId) return null;
    return record.sessionId;
}

export function getOpenVikingSessionEntry(key: OpenVikingSessionMapKey): OpenVikingSessionMapEntry | null {
    const map = getCache();
    const record = map.sessions[toCompositeKey(key)];
    if (!record || !record.sessionId) return null;
    return {
        key: {
            channel: record.channel,
            senderId: record.senderId,
            agentId: record.agentId,
        },
        sessionId: record.sessionId,
        updatedAt: record.updatedAt,
    };
}

export function upsertOpenVikingSessionId(key: OpenVikingSessionMapKey, sessionId: string): void {
    enqueueWrite((map) => {
        map.sessions[toCompositeKey(key)] = {
            sessionId,
            channel: key.channel,
            senderId: key.senderId,
            agentId: key.agentId,
            updatedAt: new Date().toISOString(),
        };
    });
}

export function touchOpenVikingSessionId(key: OpenVikingSessionMapKey): void {
    enqueueWrite((map) => {
        const composite = toCompositeKey(key);
        const existing = map.sessions[composite];
        if (!existing || !existing.sessionId) return;
        map.sessions[composite] = {
            ...existing,
            updatedAt: new Date().toISOString(),
        };
    });
}

export function deleteOpenVikingSessionId(key: OpenVikingSessionMapKey): void {
    enqueueWrite((map) => {
        const composite = toCompositeKey(key);
        if (!map.sessions[composite]) return;
        delete map.sessions[composite];
    });
}

export function listOpenVikingSessionEntries(): OpenVikingSessionMapEntry[] {
    const map = getCache();
    const entries: OpenVikingSessionMapEntry[] = [];
    for (const record of Object.values(map.sessions)) {
        if (!record?.sessionId) continue;
        entries.push({
            key: {
                channel: record.channel,
                senderId: record.senderId,
                agentId: record.agentId,
            },
            sessionId: record.sessionId,
            updatedAt: record.updatedAt,
        });
    }
    return entries;
}

export function getOpenVikingSessionMapFilePath(): string {
    return OPENVIKING_SESSION_MAP_FILE;
}

/** Waits for all pending writes to complete. Call before process exit if needed. */
export function drainSessionMapWrites(): Promise<void> {
    return writeQueue;
}
