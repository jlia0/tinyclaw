import fs from 'fs';
import path from 'path';
import { TINYCLAW_HOME } from './config';

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

function loadMap(): OpenVikingSessionMap {
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

function saveMap(map: OpenVikingSessionMap): void {
    ensureRuntimeDir();
    fs.writeFileSync(OPENVIKING_SESSION_MAP_FILE, JSON.stringify(map, null, 2) + '\n', 'utf8');
}

export function buildOpenVikingSessionMapKey(channel: string, senderId: string, agentId: string): OpenVikingSessionMapKey {
    return { channel, senderId, agentId };
}

export function getOpenVikingSessionId(key: OpenVikingSessionMapKey): string | null {
    const map = loadMap();
    const record = map.sessions[toCompositeKey(key)];
    if (!record || !record.sessionId) return null;
    return record.sessionId;
}

export function upsertOpenVikingSessionId(key: OpenVikingSessionMapKey, sessionId: string): void {
    const map = loadMap();
    map.sessions[toCompositeKey(key)] = {
        sessionId,
        channel: key.channel,
        senderId: key.senderId,
        agentId: key.agentId,
        updatedAt: new Date().toISOString(),
    };
    saveMap(map);
}

export function deleteOpenVikingSessionId(key: OpenVikingSessionMapKey): void {
    const map = loadMap();
    const composite = toCompositeKey(key);
    if (!map.sessions[composite]) return;
    delete map.sessions[composite];
    saveMap(map);
}

export function getOpenVikingSessionMapFilePath(): string {
    return OPENVIKING_SESSION_MAP_FILE;
}
