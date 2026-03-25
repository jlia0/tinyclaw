/**
 * Simplified SQLite queue — messages + responses + chat_messages.
 * ~130 lines replacing the old 427-line db.ts.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { EventEmitter } from 'events';
import { TINYAGI_HOME } from './config';
import { MessageJobData, ResponseJobData } from './types';

const QUEUE_DB_PATH = path.join(TINYAGI_HOME, 'tinyagi.db');
const MAX_RETRIES = 5;

let db: Database.Database | null = null;
export const queueEvents = new EventEmitter();

export function initQueueDb(): void {
    if (db) return;
    db = new Database(QUEUE_DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT NOT NULL UNIQUE,
            channel TEXT NOT NULL, sender TEXT NOT NULL, sender_id TEXT,
            message TEXT NOT NULL, agent TEXT,
            from_agent TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            retry_count INTEGER NOT NULL DEFAULT 0, last_error TEXT,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS responses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT NOT NULL,
            channel TEXT NOT NULL, sender TEXT NOT NULL, sender_id TEXT,
            message TEXT NOT NULL, original_message TEXT NOT NULL,
            agent TEXT, files TEXT, metadata TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL, acked_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_id TEXT NOT NULL, from_agent TEXT NOT NULL,
            message TEXT NOT NULL, created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS agent_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id TEXT NOT NULL,
            role TEXT NOT NULL,
            channel TEXT NOT NULL,
            sender TEXT NOT NULL,
            message_id TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_msg_status ON messages(status, agent, created_at);
        CREATE INDEX IF NOT EXISTS idx_resp_channel ON responses(channel, status);
        CREATE INDEX IF NOT EXISTS idx_chat_team ON chat_messages(team_id, id);
        CREATE INDEX IF NOT EXISTS idx_agent_messages_agent ON agent_messages(agent_id, created_at);
    `);

    // Migrations for existing databases
    const respCols = db.prepare("PRAGMA table_info(responses)").all() as { name: string }[];
    if (!respCols.some(c => c.name === 'metadata')) {
        db.exec('ALTER TABLE responses ADD COLUMN metadata TEXT');
    }
    const msgCols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
    if (msgCols.some(c => c.name === 'files')) {
        db.exec('ALTER TABLE messages DROP COLUMN files');
    }
    if (msgCols.some(c => c.name === 'conversation_id')) {
        db.exec('ALTER TABLE messages DROP COLUMN conversation_id');
    }
}

function getDb(): Database.Database {
    if (!db) throw new Error('Queue DB not initialized — call initQueueDb() first');
    return db;
}

// ── Messages ────────────────────────────────────────────────────────────────

export function enqueueMessage(data: MessageJobData): number | null {
    const now = Date.now();
    try {
        const r = getDb().prepare(
            `INSERT INTO messages (message_id,channel,sender,sender_id,message,agent,from_agent,status,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,'pending',?,?)`
        ).run(data.messageId, data.channel, data.sender, data.senderId ?? null, data.message,
            data.agent ?? null, data.fromAgent ?? null, now, now);
        queueEvents.emit('message:enqueued', { id: r.lastInsertRowid, agent: data.agent });
        return r.lastInsertRowid as number;
    } catch (err: any) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return null; // duplicate messageId — already enqueued
        }
        throw err;
    }
}

export function getPendingAgents(): string[] {
    return (getDb().prepare(
        `SELECT DISTINCT COALESCE(agent,'default') as agent FROM messages WHERE status='pending'`
    ).all() as { agent: string }[]).map(r => r.agent);
}

export function claimAllPendingMessages(agentId: string): any[] {
    const d = getDb();
    return d.transaction(() => {
        const rows = d.prepare(
            `SELECT * FROM messages WHERE status='pending' AND (agent=? OR (agent IS NULL AND ?='default')) ORDER BY created_at`
        ).all(agentId, agentId) as any[];
        if (rows.length === 0) return [];
        const now = Date.now();
        const ids = rows.map((r: any) => r.id);
        d.prepare(`UPDATE messages SET status='queued',updated_at=? WHERE id IN (${ids.map(() => '?').join(',')})`).run(now, ...ids);
        return rows.map((r: any) => ({ ...r, status: 'queued' }));
    }).immediate();
}

export function markProcessing(rowId: number): void {
    getDb().prepare(`UPDATE messages SET status='processing',updated_at=? WHERE id=?`).run(Date.now(), rowId);
}

export function completeMessage(rowId: number): void {
    getDb().prepare(`UPDATE messages SET status='completed',updated_at=? WHERE id=?`).run(Date.now(), rowId);
}

export function failMessage(rowId: number, error: string): void {
    const d = getDb();
    const msg = d.prepare('SELECT retry_count FROM messages WHERE id=?').get(rowId) as { retry_count: number } | undefined;
    if (!msg) return;
    const newStatus = msg.retry_count + 1 >= MAX_RETRIES ? 'dead' : 'pending';
    d.prepare(`UPDATE messages SET status=?,retry_count=?,last_error=?,updated_at=? WHERE id=?`)
        .run(newStatus, msg.retry_count + 1, error, Date.now(), rowId);
}

export function getProcessingMessages(): any[] {
    return getDb().prepare(`SELECT * FROM messages WHERE status IN ('queued','processing') ORDER BY updated_at`).all();
}

export function recoverStaleMessages(thresholdMs = 10 * 60 * 1000): number {
    return getDb().prepare(`UPDATE messages SET status='pending',updated_at=? WHERE status IN ('processing','queued') AND updated_at<?`)
        .run(Date.now(), Date.now() - thresholdMs).changes;
}

// ── Responses ───────────────────────────────────────────────────────────────

export function enqueueResponse(data: ResponseJobData): number {
    const r = getDb().prepare(
        `INSERT INTO responses (message_id,channel,sender,sender_id,message,original_message,agent,files,metadata,status,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,'pending',?)`
    ).run(data.messageId, data.channel, data.sender, data.senderId ?? null, data.message,
        data.originalMessage, data.agent ?? null, data.files ? JSON.stringify(data.files) : null,
        data.metadata ? JSON.stringify(data.metadata) : null, Date.now());
    return r.lastInsertRowid as number;
}

export function getResponsesForChannel(channel: string): any[] {
    return getDb().prepare(`SELECT * FROM responses WHERE channel=? AND status='pending' ORDER BY created_at`).all(channel);
}

export function ackResponse(responseId: number): void {
    getDb().prepare(`UPDATE responses SET status='acked',acked_at=? WHERE id=?`).run(Date.now(), responseId);
}

export function getRecentResponses(limit: number): any[] {
    return getDb().prepare(`SELECT * FROM responses ORDER BY created_at DESC LIMIT ?`).all(limit);
}

// ── Queue status ────────────────────────────────────────────────────────────

export function getQueueStatus() {
    const d = getDb();
    const counts = d.prepare(`SELECT status, COUNT(*) as cnt FROM messages GROUP BY status`).all() as { status: string; cnt: number }[];
    const result: any = { pending: 0, queued: 0, processing: 0, completed: 0, dead: 0, responsesPending: 0 };
    for (const row of counts) if (row.status in result) result[row.status] = row.cnt;
    result.responsesPending = (d.prepare(`SELECT COUNT(*) as cnt FROM responses WHERE status='pending'`).get() as { cnt: number }).cnt;
    return result;
}

export function getAgentQueueStatus(): { agent: string; pending: number; queued: number; processing: number }[] {
    return getDb().prepare(
        `SELECT COALESCE(agent,'default') as agent,
                SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) as queued,
                SUM(CASE WHEN status='processing' THEN 1 ELSE 0 END) as processing
         FROM messages WHERE status IN ('pending','queued','processing') GROUP BY agent`
    ).all() as { agent: string; pending: number; queued: number; processing: number }[];
}

export function getDeadMessages(): any[] {
    return getDb().prepare(`SELECT * FROM messages WHERE status='dead' ORDER BY updated_at DESC`).all();
}

export function retryDeadMessage(rowId: number): boolean {
    return getDb().prepare(`UPDATE messages SET status='pending',retry_count=0,updated_at=? WHERE id=? AND status='dead'`).run(Date.now(), rowId).changes > 0;
}

export function deleteDeadMessage(rowId: number): boolean {
    return getDb().prepare(`DELETE FROM messages WHERE id=? AND status='dead'`).run(rowId).changes > 0;
}

export function pruneAckedResponses(olderThanMs = 86400000): number {
    return getDb().prepare(`DELETE FROM responses WHERE status='acked' AND acked_at<?`).run(Date.now() - olderThanMs).changes;
}

export function pruneCompletedMessages(olderThanMs = 86400000): number {
    return getDb().prepare(`DELETE FROM messages WHERE status='completed' AND updated_at<?`).run(Date.now() - olderThanMs).changes;
}

// ── Agent messages (per-agent chat history) ─────────────────────────────────

export function insertAgentMessage(data: {
    agentId: string; role: 'user' | 'assistant';
    channel: string; sender: string; messageId: string; content: string;
}): number {
    return getDb().prepare(
        `INSERT INTO agent_messages (agent_id,role,channel,sender,message_id,content,created_at) VALUES (?,?,?,?,?,?,?)`
    ).run(data.agentId, data.role, data.channel, data.sender, data.messageId, data.content, Date.now()).lastInsertRowid as number;
}

export function getAgentMessages(agentId: string, limit = 100): any[] {
    return getDb().prepare(
        `SELECT * FROM agent_messages WHERE agent_id=? ORDER BY created_at DESC LIMIT ?`
    ).all(agentId, limit);
}

export function getAllAgentMessages(limit = 100): any[] {
    return getDb().prepare(
        `SELECT * FROM agent_messages ORDER BY created_at DESC LIMIT ?`
    ).all(limit);
}

// ── Chat messages ───────────────────────────────────────────────────────────

export function insertChatMessage(teamId: string, fromAgent: string, message: string): number {
    return getDb().prepare(`INSERT INTO chat_messages (team_id,from_agent,message,created_at) VALUES (?,?,?,?)`)
        .run(teamId, fromAgent, message, Date.now()).lastInsertRowid as number;
}

export function getChatMessages(teamId: string, limit = 100): any[] {
    return getDb().prepare(`SELECT * FROM chat_messages WHERE team_id=? ORDER BY created_at DESC LIMIT ?`).all(teamId, limit);
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export function closeQueueDb(): void {
    if (db) { db.close(); db = null; }
}
