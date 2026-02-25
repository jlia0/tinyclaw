/**
 * SQLite-backed message queue — replaces the file-based incoming/processing/outgoing directories.
 *
 * Uses better-sqlite3 for synchronous, transactional access with WAL mode.
 * Single module-level singleton; call initQueueDb() before any other export.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { EventEmitter } from 'events';
import { TINYCLAW_HOME } from './config';

// ── Types ────────────────────────────────────────────────────────────────────

export interface DbMessage {
    id: number;
    message_id: string;
    channel: string;
    sender: string;
    sender_id: string | null;
    message: string;
    agent: string | null;
    files: string | null;         // JSON array
    conversation_id: string | null;
    from_agent: string | null;
    status: 'pending' | 'processing' | 'completed' | 'dead';
    retry_count: number;
    last_error: string | null;
    created_at: number;
    updated_at: number;
    claimed_by: string | null;
    handoff_depth: number;
}

export interface DbResponse {
    id: number;
    message_id: string;
    channel: string;
    sender: string;
    sender_id: string | null;
    message: string;
    original_message: string;
    agent: string | null;
    files: string | null;         // JSON array
    status: 'pending' | 'acked';
    created_at: number;
    acked_at: number | null;
}

export interface EnqueueMessageData {
    channel: string;
    sender: string;
    senderId?: string;
    message: string;
    messageId: string;
    agent?: string;
    files?: string[];
    conversationId?: string;
    fromAgent?: string;
    handoffDepth?: number;
}

export interface EnqueueResponseData {
    channel: string;
    sender: string;
    senderId?: string;
    message: string;
    originalMessage: string;
    messageId: string;
    agent?: string;
    files?: string[];
}

// ── Singleton ────────────────────────────────────────────────────────────────

const QUEUE_DB_PATH = path.join(TINYCLAW_HOME, 'tinyclaw.db');
const MAX_RETRIES = 5;

let db: Database.Database | null = null;

export const queueEvents = new EventEmitter();

// ── Init ─────────────────────────────────────────────────────────────────────

export function initQueueDb(): void {
    if (db) return;

    db = new Database(QUEUE_DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT NOT NULL UNIQUE,
            channel TEXT NOT NULL,
            sender TEXT NOT NULL,
            sender_id TEXT,
            message TEXT NOT NULL,
            agent TEXT,
            files TEXT,
            conversation_id TEXT,
            from_agent TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            retry_count INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            claimed_by TEXT
        );

        CREATE TABLE IF NOT EXISTS responses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT NOT NULL,
            channel TEXT NOT NULL,
            sender TEXT NOT NULL,
            sender_id TEXT,
            message TEXT NOT NULL,
            original_message TEXT NOT NULL,
            agent TEXT,
            files TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL,
            acked_at INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_messages_status_agent_created
            ON messages(status, agent, created_at);
        CREATE INDEX IF NOT EXISTS idx_responses_channel_status ON responses(channel, status);
    `);

    // Add handoff_depth column (idempotent)
    try {
        db.exec('ALTER TABLE messages ADD COLUMN handoff_depth INTEGER NOT NULL DEFAULT 0');
    } catch { /* column already exists */ }

    // Drop legacy indexes/tables
    db.exec('DROP INDEX IF EXISTS idx_messages_status');
    db.exec('DROP INDEX IF EXISTS idx_messages_agent');
    db.exec('DROP TABLE IF EXISTS events');
}

function getDb(): Database.Database {
    if (!db) throw new Error('Queue DB not initialized — call initQueueDb() first');
    return db;
}

// ── Messages (incoming queue) ────────────────────────────────────────────────

export function enqueueMessage(data: EnqueueMessageData): number {
    const d = getDb();
    const now = Date.now();
    const result = d.prepare(`
        INSERT INTO messages (message_id, channel, sender, sender_id, message, agent, files, conversation_id, from_agent, handoff_depth, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
        data.messageId,
        data.channel,
        data.sender,
        data.senderId ?? null,
        data.message,
        data.agent ?? null,
        data.files ? JSON.stringify(data.files) : null,
        data.conversationId ?? null,
        data.fromAgent ?? null,
        data.handoffDepth ?? 0,
        now,
        now,
    );
    const rowId = result.lastInsertRowid as number;
    queueEvents.emit('message:enqueued', { id: rowId, agent: data.agent });
    return rowId;
}

/**
 * Atomically claim the oldest pending message for a given agent.
 * Uses BEGIN IMMEDIATE to prevent concurrent claims.
 */
export function claimNextMessage(agentId: string): DbMessage | null {
    const d = getDb();
    const claim = d.transaction(() => {
        const row = d.prepare(`
            SELECT * FROM messages
            WHERE status = 'pending' AND (agent = ? OR (agent IS NULL AND ? = 'default'))
            ORDER BY created_at ASC
            LIMIT 1
        `).get(agentId, agentId) as DbMessage | undefined;

        if (!row) return null;

        d.prepare(`
            UPDATE messages SET status = 'processing', claimed_by = ?, updated_at = ?
            WHERE id = ?
        `).run(agentId, Date.now(), row.id);

        return { ...row, status: 'processing' as const, claimed_by: agentId };
    });

    return claim.immediate();
}

export function completeMessage(rowId: number): void {
    getDb().prepare(`
        UPDATE messages SET status = 'completed', updated_at = ? WHERE id = ?
    `).run(Date.now(), rowId);
}

export function failMessage(rowId: number, error: string): void {
    const d = getDb();
    const msg = d.prepare('SELECT retry_count FROM messages WHERE id = ?').get(rowId) as { retry_count: number } | undefined;
    if (!msg) return;

    const newCount = msg.retry_count + 1;
    const newStatus = newCount >= MAX_RETRIES ? 'dead' : 'pending';

    d.prepare(`
        UPDATE messages SET status = ?, retry_count = ?, last_error = ?, claimed_by = NULL, updated_at = ?
        WHERE id = ?
    `).run(newStatus, newCount, error, Date.now(), rowId);
}

// ── Responses (outgoing queue) ───────────────────────────────────────────────

export function enqueueResponse(data: EnqueueResponseData): number {
    const d = getDb();
    const now = Date.now();
    const result = d.prepare(`
        INSERT INTO responses (message_id, channel, sender, sender_id, message, original_message, agent, files, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
        data.messageId,
        data.channel,
        data.sender,
        data.senderId ?? null,
        data.message,
        data.originalMessage,
        data.agent ?? null,
        data.files ? JSON.stringify(data.files) : null,
        now,
    );
    return result.lastInsertRowid as number;
}

export function getResponsesForChannel(channel: string): DbResponse[] {
    return getDb().prepare(`
        SELECT * FROM responses WHERE channel = ? AND status = 'pending' ORDER BY created_at ASC
    `).all(channel) as DbResponse[];
}

export function ackResponse(responseId: number): void {
    getDb().prepare(`
        UPDATE responses SET status = 'acked', acked_at = ? WHERE id = ?
    `).run(Date.now(), responseId);
}

export function getRecentResponses(limit: number): DbResponse[] {
    return getDb().prepare(`
        SELECT * FROM responses ORDER BY created_at DESC LIMIT ?
    `).all(limit) as DbResponse[];
}

// ── Queue status & management ────────────────────────────────────────────────

export function getQueueStatus(): {
    pending: number; processing: number; completed: number; dead: number;
    responsesPending: number;
} {
    const d = getDb();
    const counts = d.prepare(`
        SELECT status, COUNT(*) as cnt FROM messages GROUP BY status
    `).all() as { status: string; cnt: number }[];

    const result = { pending: 0, processing: 0, completed: 0, dead: 0, responsesPending: 0 };
    for (const row of counts) {
        if (row.status in result) (result as any)[row.status] = row.cnt;
    }

    const respCount = d.prepare(`
        SELECT COUNT(*) as cnt FROM responses WHERE status = 'pending'
    `).get() as { cnt: number };
    result.responsesPending = respCount.cnt;

    return result;
}

export function getDeadMessages(): DbMessage[] {
    return getDb().prepare(`
        SELECT * FROM messages WHERE status = 'dead' ORDER BY updated_at DESC
    `).all() as DbMessage[];
}

export function retryDeadMessage(rowId: number): boolean {
    const result = getDb().prepare(`
        UPDATE messages SET status = 'pending', retry_count = 0, claimed_by = NULL, updated_at = ?
        WHERE id = ? AND status = 'dead'
    `).run(Date.now(), rowId);
    return result.changes > 0;
}

export function deleteDeadMessage(rowId: number): boolean {
    const result = getDb().prepare(`
        DELETE FROM messages WHERE id = ? AND status = 'dead'
    `).run(rowId);
    return result.changes > 0;
}

/**
 * Recover messages stuck in 'processing' for longer than thresholdMs (default 10 min).
 */
export function recoverStaleMessages(thresholdMs = 10 * 60 * 1000): number {
    const cutoff = Date.now() - thresholdMs;
    const result = getDb().prepare(`
        UPDATE messages SET status = 'pending', claimed_by = NULL, updated_at = ?
        WHERE status = 'processing' AND updated_at < ?
    `).run(Date.now(), cutoff);
    return result.changes;
}

/**
 * Clean up acked responses older than the given threshold (default 24h).
 */
export function pruneAckedResponses(olderThanMs = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs;
    const result = getDb().prepare(`
        DELETE FROM responses WHERE status = 'acked' AND acked_at < ?
    `).run(cutoff);
    return result.changes;
}

/**
 * Clean up completed messages older than the given threshold (default 24h).
 * Dead messages are kept for manual review/retry.
 */
export function pruneCompletedMessages(olderThanMs = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs;
    const result = getDb().prepare(
        `DELETE FROM messages WHERE status = 'completed' AND updated_at < ?`
    ).run(cutoff);
    return result.changes;
}

/**
 * Get all distinct agent values from pending messages (for processQueue iteration).
 */
export function getPendingAgents(): string[] {
    const rows = getDb().prepare(`
        SELECT DISTINCT COALESCE(agent, 'default') as agent FROM messages WHERE status = 'pending'
    `).all() as { agent: string }[];
    return rows.map(r => r.agent);
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

export function closeQueueDb(): void {
    if (db) {
        db.close();
        db = null;
    }
}
