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
    conversation_id: string | null;
    files: string | null;         // JSON array
    metadata: string | null;      // JSON object (plugin hook metadata)
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
}

export interface EnqueueResponseData {
    channel: string;
    sender: string;
    senderId?: string;
    message: string;
    originalMessage: string;
    messageId: string;
    agent?: string;
    conversationId?: string;
    files?: string[];
    metadata?: Record<string, unknown>;
}

export type QueueMessageStatus = DbMessage['status'];
export type QueueResponseStatus = DbResponse['status'];

export interface QueueMessageRow {
    id: number;
    messageId: string;
    channel: string;
    sender: string;
    senderId: string | null;
    agent: string | null;
    conversationId: string | null;
    fromAgent: string | null;
    status: QueueMessageStatus;
    message: string;
    files: string[];
    retryCount: number;
    lastError: string | null;
    claimedBy: string | null;
    createdAt: number;
    updatedAt: number;
}

export interface QueueResponseRow {
    id: number;
    messageId: string;
    channel: string;
    sender: string;
    senderId: string | null;
    agent: string | null;
    conversationId: string | null;
    message: string;
    originalMessage: string | null;
    files: string[];
    metadata: Record<string, unknown> | null;
    status: QueueResponseStatus;
    createdAt: number;
    ackedAt: number | null;
}

export interface GetQueueMessagesOptions {
    statuses: QueueMessageStatus[];
    channel?: string;
    agentId?: string;
    sender?: string;
    messageId?: string;
    conversationId?: string;
    search?: string;
    limit: number;
}

export interface GetQueueResponsesOptions {
    statuses: QueueResponseStatus[];
    channel?: string;
    agentId?: string;
    sender?: string;
    messageId?: string;
    conversationId?: string;
    search?: string;
    limit: number;
}

export interface QueueRowCounts {
    pending: number;
    processing: number;
    completed: number;
    dead: number;
    responsesPending: number;
    responsesAcked: number;
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
            conversation_id TEXT,
            files TEXT,
            metadata TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL,
            acked_at INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_messages_status_agent_created
            ON messages(status, agent, created_at);
        CREATE INDEX IF NOT EXISTS idx_responses_channel_status ON responses(channel, status);
    `);

    // Drop legacy indexes/tables
    db.exec('DROP INDEX IF EXISTS idx_messages_status');
    db.exec('DROP INDEX IF EXISTS idx_messages_agent');
    db.exec('DROP TABLE IF EXISTS events');

    // Migrate: add metadata column to responses if missing
    const cols = db.prepare("PRAGMA table_info(responses)").all() as { name: string }[];
    if (!cols.some(c => c.name === 'metadata')) {
        db.exec('ALTER TABLE responses ADD COLUMN metadata TEXT');
    }
    if (!cols.some(c => c.name === 'conversation_id')) {
        db.exec('ALTER TABLE responses ADD COLUMN conversation_id TEXT');
    }
}

function getDb(): Database.Database {
    if (!db) throw new Error('Queue DB not initialized — call initQueueDb() first');
    return db;
}

function safeParseStringArray(value: string | null): string[] {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

function safeParseObject(value: string | null): Record<string, unknown> | null {
    if (!value) return null;
    try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        // Ignore malformed metadata
    }
    return null;
}

function mapQueueMessageRow(row: DbMessage): QueueMessageRow {
    return {
        id: row.id,
        messageId: row.message_id,
        channel: row.channel,
        sender: row.sender,
        senderId: row.sender_id,
        agent: row.agent,
        conversationId: row.conversation_id,
        fromAgent: row.from_agent,
        status: row.status,
        message: row.message,
        files: safeParseStringArray(row.files),
        retryCount: row.retry_count,
        lastError: row.last_error,
        claimedBy: row.claimed_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function mapQueueResponseRow(row: DbResponse): QueueResponseRow {
    return {
        id: row.id,
        messageId: row.message_id,
        channel: row.channel,
        sender: row.sender,
        senderId: row.sender_id,
        agent: row.agent,
        conversationId: row.conversation_id,
        message: row.message,
        originalMessage: row.original_message ?? null,
        files: safeParseStringArray(row.files),
        metadata: safeParseObject(row.metadata),
        status: row.status,
        createdAt: row.created_at,
        ackedAt: row.acked_at,
    };
}

function buildInClause(values: readonly string[]): string {
    return values.map(() => '?').join(', ');
}

function normalizeSearchTerm(search?: string): string | undefined {
    const trimmed = search?.trim();
    return trimmed ? `%${trimmed.toLowerCase()}%` : undefined;
}

// ── Messages (incoming queue) ────────────────────────────────────────────────

export function enqueueMessage(data: EnqueueMessageData): number {
    const d = getDb();
    const now = Date.now();
    const result = d.prepare(`
        INSERT INTO messages (message_id, channel, sender, sender_id, message, agent, files, conversation_id, from_agent, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
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
        INSERT INTO responses (message_id, channel, sender, sender_id, message, original_message, agent, conversation_id, files, metadata, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
        data.messageId,
        data.channel,
        data.sender,
        data.senderId ?? null,
        data.message,
        data.originalMessage,
        data.agent ?? null,
        data.conversationId ?? null,
        data.files ? JSON.stringify(data.files) : null,
        data.metadata ? JSON.stringify(data.metadata) : null,
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

export function getQueueMessages(options: GetQueueMessagesOptions): QueueMessageRow[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    clauses.push(`status IN (${buildInClause(options.statuses)})`);
    params.push(...options.statuses);

    if (options.channel) {
        clauses.push('channel = ?');
        params.push(options.channel);
    }
    if (options.agentId) {
        clauses.push('agent = ?');
        params.push(options.agentId);
    }
    if (options.sender) {
        clauses.push('sender = ?');
        params.push(options.sender);
    }
    if (options.messageId) {
        clauses.push('message_id = ?');
        params.push(options.messageId);
    }
    if (options.conversationId) {
        clauses.push('conversation_id = ?');
        params.push(options.conversationId);
    }

    const searchTerm = normalizeSearchTerm(options.search);
    if (searchTerm) {
        clauses.push(`(
            LOWER(message) LIKE ?
            OR LOWER(sender) LIKE ?
            OR LOWER(message_id) LIKE ?
            OR LOWER(COALESCE(agent, '')) LIKE ?
            OR LOWER(COALESCE(conversation_id, '')) LIKE ?
        )`);
        params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    params.push(options.limit);
    const rows = getDb().prepare(`
        SELECT * FROM messages
        WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT ?
    `).all(...params) as DbMessage[];

    return rows.map(mapQueueMessageRow);
}

export function getQueueResponses(options: GetQueueResponsesOptions): QueueResponseRow[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    clauses.push(`status IN (${buildInClause(options.statuses)})`);
    params.push(...options.statuses);

    if (options.channel) {
        clauses.push('channel = ?');
        params.push(options.channel);
    }
    if (options.agentId) {
        clauses.push('agent = ?');
        params.push(options.agentId);
    }
    if (options.sender) {
        clauses.push('sender = ?');
        params.push(options.sender);
    }
    if (options.messageId) {
        clauses.push('message_id = ?');
        params.push(options.messageId);
    }
    if (options.conversationId) {
        clauses.push('conversation_id = ?');
        params.push(options.conversationId);
    }
    const searchTerm = normalizeSearchTerm(options.search);
    if (searchTerm) {
        clauses.push(`(
            LOWER(message) LIKE ?
            OR LOWER(COALESCE(original_message, '')) LIKE ?
            OR LOWER(sender) LIKE ?
            OR LOWER(message_id) LIKE ?
            OR LOWER(COALESCE(agent, '')) LIKE ?
            OR LOWER(COALESCE(conversation_id, '')) LIKE ?
        )`);
        params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    params.push(options.limit);
    const rows = getDb().prepare(`
        SELECT * FROM responses
        WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT ?
    `).all(...params) as DbResponse[];

    return rows.map(mapQueueResponseRow);
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

export function getQueueRowCounts(): QueueRowCounts {
    const d = getDb();
    const messageCounts = d.prepare(`
        SELECT status, COUNT(*) as cnt FROM messages GROUP BY status
    `).all() as { status: QueueMessageStatus; cnt: number }[];
    const responseCounts = d.prepare(`
        SELECT status, COUNT(*) as cnt FROM responses GROUP BY status
    `).all() as { status: QueueResponseStatus; cnt: number }[];

    const result: QueueRowCounts = {
        pending: 0,
        processing: 0,
        completed: 0,
        dead: 0,
        responsesPending: 0,
        responsesAcked: 0,
    };

    for (const row of messageCounts) {
        switch (row.status) {
            case 'pending':
            case 'processing':
            case 'completed':
            case 'dead':
                result[row.status] = row.cnt;
                break;
        }
    }

    for (const row of responseCounts) {
        if (row.status === 'pending') result.responsesPending = row.cnt;
        if (row.status === 'acked') result.responsesAcked = row.cnt;
    }

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
