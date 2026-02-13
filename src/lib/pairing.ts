import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface PairingPendingEntry {
    channel: string;
    senderId: string;
    sender: string;
    code: string;
    createdAt: number;
    lastSeenAt: number;
}

export interface PairingApprovedEntry {
    channel: string;
    senderId: string;
    sender: string;
    approvedAt: number;
    approvedCode?: string;
}

export interface PairingState {
    pending: PairingPendingEntry[];
    approved: PairingApprovedEntry[];
}

export interface PairingCheckResult {
    approved: boolean;
    code?: string;
    isNewPending?: boolean;
}

function defaultState(): PairingState {
    return {
        pending: [],
        approved: [],
    };
}

function normalizeState(raw: unknown): PairingState {
    if (!raw || typeof raw !== 'object') {
        return defaultState();
    }

    const parsed = raw as Partial<PairingState>;
    const pending = Array.isArray(parsed.pending) ? parsed.pending : [];
    const approved = Array.isArray(parsed.approved) ? parsed.approved : [];

    return {
        pending: pending.filter((entry): entry is PairingPendingEntry => {
            return !!entry
                && typeof entry.channel === 'string'
                && typeof entry.senderId === 'string'
                && typeof entry.sender === 'string'
                && typeof entry.code === 'string'
                && typeof entry.createdAt === 'number'
                && typeof entry.lastSeenAt === 'number';
        }),
        approved: approved.filter((entry): entry is PairingApprovedEntry => {
            return !!entry
                && typeof entry.channel === 'string'
                && typeof entry.senderId === 'string'
                && typeof entry.sender === 'string'
                && typeof entry.approvedAt === 'number';
        }),
    };
}

function makeSenderKey(channel: string, senderId: string): string {
    return `${channel}::${senderId}`;
}

function randomPairingCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(8);
    let code = '';
    for (let i = 0; i < bytes.length; i += 1) {
        code += alphabet[bytes[i] % alphabet.length];
    }
    return code;
}

function createUniqueCode(state: PairingState): string {
    const existing = new Set<string>([
        ...state.pending.map(entry => entry.code.toUpperCase()),
        ...state.approved.map(entry => (entry.approvedCode || '').toUpperCase()).filter(Boolean),
    ]);

    for (let attempt = 0; attempt < 20; attempt += 1) {
        const candidate = randomPairingCode();
        if (!existing.has(candidate)) {
            return candidate;
        }
    }

    return `${Date.now().toString(36).toUpperCase().slice(-8).padStart(8, 'A')}`;
}

export function loadPairingState(pairingFile: string): PairingState {
    try {
        if (!fs.existsSync(pairingFile)) {
            return defaultState();
        }
        const raw = JSON.parse(fs.readFileSync(pairingFile, 'utf8'));
        return normalizeState(raw);
    } catch {
        return defaultState();
    }
}

export function savePairingState(pairingFile: string, state: PairingState): void {
    const dir = path.dirname(pairingFile);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = `${pairingFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, pairingFile);
}

export function ensureSenderPaired(pairingFile: string, channel: string, senderId: string, sender: string): PairingCheckResult {
    const state = loadPairingState(pairingFile);
    const senderKey = makeSenderKey(channel, senderId);
    const approvedMap = new Map<string, PairingApprovedEntry>(
        state.approved.map(entry => [makeSenderKey(entry.channel, entry.senderId), entry])
    );
    const existingApproved = approvedMap.get(senderKey);
    if (existingApproved) {
        if (existingApproved.sender !== sender) {
            existingApproved.sender = sender;
            savePairingState(pairingFile, state);
        }
        return { approved: true };
    }

    const existingPending = state.pending.find(entry => entry.channel === channel && entry.senderId === senderId);
    if (existingPending) {
        existingPending.lastSeenAt = Date.now();
        existingPending.sender = sender;
        savePairingState(pairingFile, state);
        return {
            approved: false,
            code: existingPending.code,
            isNewPending: false,
        };
    }

    const code = createUniqueCode(state);
    const now = Date.now();
    state.pending.push({
        channel,
        senderId,
        sender,
        code,
        createdAt: now,
        lastSeenAt: now,
    });
    savePairingState(pairingFile, state);
    return {
        approved: false,
        code,
        isNewPending: true,
    };
}

export interface PairingApproveResult {
    ok: boolean;
    reason?: string;
    entry?: PairingApprovedEntry;
}

export function approvePairingCode(pairingFile: string, code: string): PairingApproveResult {
    const normalizedCode = code.trim().toUpperCase();
    if (!normalizedCode) {
        return {
            ok: false,
            reason: 'Pairing code is required.',
        };
    }

    const state = loadPairingState(pairingFile);
    const pendingIndex = state.pending.findIndex(entry => entry.code.toUpperCase() === normalizedCode);
    if (pendingIndex === -1) {
        return {
            ok: false,
            reason: `Pairing code not found: ${normalizedCode}`,
        };
    }

    const pending = state.pending[pendingIndex];
    state.pending.splice(pendingIndex, 1);

    const existingApprovedIndex = state.approved.findIndex(
        entry => entry.channel === pending.channel && entry.senderId === pending.senderId
    );
    const approvedEntry: PairingApprovedEntry = {
        channel: pending.channel,
        senderId: pending.senderId,
        sender: pending.sender,
        approvedAt: Date.now(),
        approvedCode: normalizedCode,
    };

    if (existingApprovedIndex >= 0) {
        state.approved[existingApprovedIndex] = approvedEntry;
    } else {
        state.approved.push(approvedEntry);
    }

    savePairingState(pairingFile, state);
    return {
        ok: true,
        entry: approvedEntry,
    };
}
