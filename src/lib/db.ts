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
import { log } from './logging';

// ── Types ────────────────────────────────────────────────────────────────────

export interface DbConversation {
    id: string;
    channel: string;
    sender: string;
    original_message: string;
    message_id: string;
    team_id: string;
    team_name: string;
    status: 'active' | 'completing' | 'completed' | 'error';
    pending_count: number;
    total_messages: number;
    max_messages: number;
    start_time: number;
    updated_at: number;
}

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
    next_retry_at: number | null;  // NEW: For exponential backoff
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
    files?: string[];
    metadata?: Record<string, unknown>;
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
            claimed_by TEXT,
            next_retry_at INTEGER
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

    // Migrate: add next_retry_at column to messages if missing
    const msgCols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
    if (!msgCols.some(c => c.name === 'next_retry_at')) {
        db.exec('ALTER TABLE messages ADD COLUMN next_retry_at INTEGER');
    }

    // NEW: Conversation persistence tables for restart recovery
    // These tables store conversation state that was previously only in memory,
    // allowing the system to recover active conversations after a crash or restart.
    db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            channel TEXT NOT NULL,
            sender TEXT NOT NULL,
            original_message TEXT NOT NULL,
            message_id TEXT NOT NULL,
            team_id TEXT NOT NULL,
            team_name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            pending_count INTEGER NOT NULL DEFAULT 0,
            total_messages INTEGER NOT NULL DEFAULT 0,
            max_messages INTEGER NOT NULL DEFAULT 50,
            start_time INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS conversation_responses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            response TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS conversation_pending_agents (
            conversation_id TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            enqueued_at INTEGER NOT NULL,
            PRIMARY KEY (conversation_id, agent_id),
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
        CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at);
        CREATE INDEX IF NOT EXISTS idx_conv_responses_conv ON conversation_responses(conversation_id);
    `);

    // NEW: Outstanding requests table for agent handoff tracking
    // This implements the primitive request-reply pattern with timeouts:
    // - When agent A asks agent B to do something, create a request record
    // - Agent B must ACK (acknowledge receipt) within timeout
    // - Agent B must RESPOND with result within timeout
    // - If timeouts expire, escalate or retry
    db.exec(`
        CREATE TABLE IF NOT EXISTS outstanding_requests (
            request_id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            from_agent TEXT NOT NULL,
            to_agent TEXT NOT NULL,
            task TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            ack_deadline INTEGER NOT NULL,
            response_deadline INTEGER NOT NULL,
            retry_count INTEGER NOT NULL DEFAULT 0,
            max_retries INTEGER NOT NULL DEFAULT 5,
            created_at INTEGER NOT NULL,
            acked_at INTEGER,
            responded_at INTEGER,
            response TEXT,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_requests_status ON outstanding_requests(status);
        CREATE INDEX IF NOT EXISTS idx_requests_conversation ON outstanding_requests(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_requests_to_agent ON outstanding_requests(to_agent);
        CREATE INDEX IF NOT EXISTS idx_requests_deadlines ON outstanding_requests(ack_deadline, response_deadline);
    `);
    // Verify database integrity on startup
    try {
        const result = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
        if (result?.integrity_check !== 'ok') {
            log('ERROR', `Database integrity check failed: ${result?.integrity_check}`);
        } else {
            log('DEBUG', 'Database integrity check passed');
        }
    } catch (error) {
        log('WARN', `Database check failed: ${(error as Error).message}`);
    }
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
 * Respects next_retry_at for exponential backoff.
 */
export function claimNextMessage(agentId: string): DbMessage | null {
    const d = getDb();
    const claim = d.transaction(() => {
        const row = d.prepare(`
            SELECT * FROM messages
            WHERE status = 'pending' AND (agent = ? OR (agent IS NULL AND ? = 'default'))
              AND (next_retry_at IS NULL OR next_retry_at <= ?)
            ORDER BY 
                CASE WHEN next_retry_at IS NULL THEN 0 ELSE 1 END,
                next_retry_at ASC,
                created_at ASC
            LIMIT 1
        `).get(agentId, agentId, Date.now()) as DbMessage | undefined;

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

    if (newCount >= MAX_RETRIES) {
        // Mark as dead - no more retries
        d.prepare(`
            UPDATE messages SET status = 'dead', retry_count = ?, last_error = ?, 
                              claimed_by = NULL, updated_at = ?, next_retry_at = NULL
            WHERE id = ?
        `).run(newCount, error, Date.now(), rowId);
    } else {
        // Exponential backoff with jitter
        // Backoff: 100ms, 200ms, 400ms, 800ms... capped at 30 seconds
        const backoffMs = Math.min(100 * Math.pow(2, newCount - 1), 30000);
        // Add jitter (0-100ms) to prevent thundering herd
        const jitter = Math.floor(Math.random() * 100);
        const nextRetryAt = Date.now() + backoffMs + jitter;

        d.prepare(`
            UPDATE messages SET status = 'pending', retry_count = ?, last_error = ?, 
                              claimed_by = NULL, updated_at = ?, next_retry_at = ?
            WHERE id = ?
        `).run(newCount, error, Date.now(), nextRetryAt, rowId);

        log('DEBUG', `Message ${rowId} failed, retry ${newCount}/${MAX_RETRIES} in ${backoffMs + jitter}ms`);
    }
}

// ── Responses (outgoing queue) ───────────────────────────────────────────────

import { signalChannel } from './signals';

export function enqueueResponse(data: EnqueueResponseData): number {
    const d = getDb();
    const now = Date.now();
    const result = d.prepare(`
        INSERT INTO responses (message_id, channel, sender, sender_id, message, original_message, agent, files, metadata, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
        data.messageId,
        data.channel,
        data.sender,
        data.senderId ?? null,
        data.message,
        data.originalMessage,
        data.agent ?? null,
        data.files ? JSON.stringify(data.files) : null,
        data.metadata ? JSON.stringify(data.metadata) : null,
        now,
    );
    
    // Signal channel client that response is ready (push notification)
    signalChannel(data.channel);
    
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

// ── Conversation Persistence ─────────────────────────────────────────────────

/**
 * Persist a conversation to the database.
 * Uses INSERT OR REPLACE for atomic upsert.
 * 
 * This ensures conversation state survives restarts. Previously, conversations
 * were only stored in memory (Map), meaning a crash would lose all active
 * team conversation state.
 */
export function persistConversation(conv: {
    id: string;
    channel: string;
    sender: string;
    originalMessage: string;
    messageId: string;
    teamContext: { teamId: string; team: { name: string } };
    pending: number;
    totalMessages: number;
    maxMessages: number;
    startTime: number;
    pendingAgents: Set<string>;
}): void {
    const d = getDb();
    const now = Date.now();

    d.prepare(`
        INSERT OR REPLACE INTO conversations 
        (id, channel, sender, original_message, message_id, team_id, team_name,
         status, pending_count, total_messages, max_messages, start_time, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        conv.id,
        conv.channel,
        conv.sender,
        conv.originalMessage,
        conv.messageId,
        conv.teamContext.teamId,
        conv.teamContext.team.name,
        'active',
        conv.pending,
        conv.totalMessages,
        conv.maxMessages,
        conv.startTime,
        now
    );

    // Sync pending agents - delete existing then insert current
    d.prepare(`DELETE FROM conversation_pending_agents WHERE conversation_id = ?`).run(conv.id);
    for (const agentId of conv.pendingAgents) {
        d.prepare(`
            INSERT INTO conversation_pending_agents (conversation_id, agent_id, enqueued_at)
            VALUES (?, ?, ?)
        `).run(conv.id, agentId, now);
    }
}

/**
 * Persist a response to a conversation.
 * This allows reconstruction of conversation history after restart.
 */
export function persistResponse(conversationId: string, agentId: string, response: string): void {
    getDb().prepare(`
        INSERT INTO conversation_responses (conversation_id, agent_id, response, created_at)
        VALUES (?, ?, ?, ?)
    `).run(conversationId, agentId, response, Date.now());
}

/**
 * Atomically decrement the pending counter for a conversation.
 * Uses a transaction with BEGIN IMMEDIATE to prevent race conditions.
 * 
 * Returns the new pending count. If 0, the conversation should be completed.
 */
export function decrementPendingInDb(conversationId: string): number {
    const d = getDb();

    const update = d.transaction(() => {
        const row = d.prepare(`
            SELECT pending_count FROM conversations WHERE id = ?
        `).get(conversationId) as { pending_count: number } | undefined;

        if (!row) return 0;

        const newCount = Math.max(0, row.pending_count - 1);

        d.prepare(`
            UPDATE conversations 
            SET pending_count = ?, updated_at = ?
            WHERE id = ?
        `).run(newCount, Date.now(), conversationId);

        return newCount;
    });

    return update.immediate();
}

/**
 * Increment the pending counter for a conversation.
 * Used when new agent mentions are enqueued.
 */
export function incrementPendingInDb(conversationId: string, count: number): void {
    getDb().prepare(`
        UPDATE conversations 
        SET pending_count = pending_count + ?, updated_at = ?
        WHERE id = ?
    `).run(count, Date.now(), conversationId);
}

/**
 * Increment the total_messages counter for a conversation.
 */
export function incrementTotalMessages(conversationId: string): void {
    getDb().prepare(`
        UPDATE conversations 
        SET total_messages = total_messages + 1, updated_at = ?
        WHERE id = ?
    `).run(Date.now(), conversationId);
}

/**
 * Mark a conversation as completed.
 */
export function markConversationCompleted(conversationId: string): void {
    getDb().prepare(`
        UPDATE conversations 
        SET status = 'completed', updated_at = ?
        WHERE id = ?
    `).run(Date.now(), conversationId);
}

/**
 * Add a pending agent to a conversation.
 */
export function addPendingAgent(conversationId: string, agentId: string): void {
    getDb().prepare(`
        INSERT OR IGNORE INTO conversation_pending_agents (conversation_id, agent_id, enqueued_at)
        VALUES (?, ?, ?)
    `).run(conversationId, agentId, Date.now());
}

/**
 * Remove a pending agent from a conversation.
 */
export function removePendingAgent(conversationId: string, agentId: string): void {
    getDb().prepare(`
        DELETE FROM conversation_pending_agents 
        WHERE conversation_id = ? AND agent_id = ?
    `).run(conversationId, agentId);
}

/**
 * Load all active conversations from the database.
 * Used on startup to recover conversations after a restart.
 */
export function loadActiveConversations(): DbConversation[] {
    return getDb().prepare(`
        SELECT * FROM conversations WHERE status = 'active'
    `).all() as DbConversation[];
}

/**
 * Load responses for a conversation.
 */
export function loadConversationResponses(conversationId: string): Array<{ agent_id: string; response: string }> {
    return getDb().prepare(`
        SELECT agent_id, response FROM conversation_responses
        WHERE conversation_id = ?
        ORDER BY created_at ASC
    `).all(conversationId) as Array<{ agent_id: string; response: string }>;
}

/**
 * Load pending agents for a conversation.
 */
export function loadPendingAgents(conversationId: string): string[] {
    const rows = getDb().prepare(`
        SELECT agent_id FROM conversation_pending_agents WHERE conversation_id = ?
    `).all(conversationId) as Array<{ agent_id: string }>;
    return rows.map(r => r.agent_id);
}

/**
 * Recover stale conversations that are stuck in 'active' state.
 *
 * Conversations can be stuck if:
 * - queue-processor crashes during agent processing
 * - Network failure prevents agent response from being saved
 * - Bug causes agent to not complete properly
 *
 * This marks conversations as 'completed' if they haven't been updated
 * in a long time (e.g., 30 minutes), allowing them to be pruned and
 * preventing memory leaks.
 *
 * IMPORTANT:
 * - Does NOT emit team_chain_end event (this is artificial recovery, not natural completion)
 * - Does NOT update updated_at (keeps original timestamp for timely pruning)
 * - Visualizer will NOT show these as completed (they're orphaned conversations)
 * - Use this for crash recovery only - legitimate work may lose responses
 *
 * Returns number of conversations recovered.
 */
export function recoverStaleConversations(stalethresholdMs = 10 * 60 * 1000): number {
    const cutoff = Date.now() - stalethresholdMs;
    const result = getDb().prepare(`
        UPDATE conversations
        SET status = 'completed'
        WHERE status = 'active' AND updated_at < ?
    `).run(cutoff);
    return result.changes;
}

/**
 * Get details of stale conversations for crash recovery logging.
 * Returns conversations that haven't been updated in the specified time.
 */
export function getStaleConversations(staleThresholdMs = 10 * 60 * 1000): Array<{
    id: string;
    teamId: string;
    duration: number;
}> {
    const cutoff = Date.now() - staleThresholdMs;
    const rows = getDb().prepare(`
        SELECT id, team_id, (? - updated_at) as duration_ms
        FROM conversations
        WHERE status = 'active' AND updated_at < ?
    `).all(Date.now(), cutoff) as Array<{ id: string; team_id: string; duration_ms: number }>;

    return rows.map(row => ({
        id: row.id,
        teamId: row.team_id,
        duration: row.duration_ms,
    }));
}

/**
 * Clean up old completed conversations.
 * Similar to pruneCompletedMessages, but for conversations.
 */
export function pruneOldConversations(olderThanMs = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs;
    const result = getDb().prepare(`
        DELETE FROM conversations
        WHERE status = 'completed' AND updated_at < ?
    `).run(cutoff);
    return result.changes;
}

// ── Outstanding Requests (Agent Handoff Tracking) ────────────────────────────

export interface OutstandingRequest {
    request_id: string;
    conversation_id: string;
    from_agent: string;
    to_agent: string;
    task: string;
    status: 'pending' | 'acked' | 'responded' | 'failed' | 'escalated';
    ack_deadline: number;
    response_deadline: number;
    retry_count: number;
    max_retries: number;
    created_at: number;
    acked_at: number | null;
    responded_at: number | null;
    response: string | null;
}

/**
 * Create a new outstanding request when agent A asks agent B to do something.
 * This establishes accountability with timeouts.
 */
export function createOutstandingRequest(
    conversationId: string,
    fromAgent: string,
    toAgent: string,
    task: string,
    ackTimeoutMs = 5000,      // 5 seconds to acknowledge
    responseTimeoutMs = 300000 // 5 minutes to respond
): string {
    const d = getDb();
    const now = Date.now();
    const requestId = `req_${conversationId}_${toAgent}_${now}_${Math.random().toString(36).slice(2, 6)}`;

    d.prepare(`
        INSERT INTO outstanding_requests 
        (request_id, conversation_id, from_agent, to_agent, task, status, 
         ack_deadline, response_deadline, retry_count, max_retries, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, 0, 5, ?)
    `).run(
        requestId,
        conversationId,
        fromAgent,
        toAgent,
        task,
        now + ackTimeoutMs,
        now + responseTimeoutMs,
        now
    );

    log('DEBUG', `Created outstanding request ${requestId}: ${fromAgent} -> ${toAgent}`);
    return requestId;
}

/**
 * Acknowledge receipt of a request.
 * Called when agent B receives the message from agent A.
 */
export function acknowledgeRequest(requestId: string): boolean {
    const d = getDb();
    const now = Date.now();

    const result = d.prepare(`
        UPDATE outstanding_requests 
        SET status = 'acked', acked_at = ?
        WHERE request_id = ? AND status = 'pending'
    `).run(now, requestId);

    if (result.changes > 0) {
        log('DEBUG', `Request ${requestId} acknowledged`);
        return true;
    }
    // Log if request was already acked or not found, but don't reject due to deadline
    // The timeout checker handles expired requests
    const existing = d.prepare(`SELECT status FROM outstanding_requests WHERE request_id = ?`).get(requestId) as { status: string } | undefined;
    if (existing?.status === 'acked') {
        log('DEBUG', `Request ${requestId} already acknowledged`);
        return true;
    }
    return false;
}

/**
 * Record response to a request.
 * Called when agent B completes the task and responds.
 */
export function respondToRequest(requestId: string, response: string): boolean {
    const d = getDb();
    const now = Date.now();

    const result = d.prepare(`
        UPDATE outstanding_requests 
        SET status = 'responded', responded_at = ?, response = ?
        WHERE request_id = ? AND status IN ('pending', 'acked')
    `).run(now, response, requestId);

    if (result.changes > 0) {
        log('DEBUG', `Request ${requestId} responded`);
        return true;
    }
    // Log if request was already responded or not found
    const existing = d.prepare(`SELECT status FROM outstanding_requests WHERE request_id = ?`).get(requestId) as { status: string } | undefined;
    if (existing?.status === 'responded') {
        log('DEBUG', `Request ${requestId} already responded`);
        return true;
    }
    return false;
}

/**
 * Mark request as failed (permanent failure, no more retries).
 */
export function failRequest(requestId: string, reason: string): void {
    getDb().prepare(`
        UPDATE outstanding_requests 
        SET status = 'failed', response = ?
        WHERE request_id = ?
    `).run(reason, requestId);

    log('WARN', `Request ${requestId} failed: ${reason}`);
}

/**
 * Mark request as escalated to human.
 */
export function escalateRequest(requestId: string, reason: string): void {
    getDb().prepare(`
        UPDATE outstanding_requests 
        SET status = 'escalated', response = ?
        WHERE request_id = ?
    `).run(reason, requestId);

    log('WARN', `Request ${requestId} escalated: ${reason}`);
}

/**
 * Get all pending requests that need ACK but haven't been acked and deadline expired.
 */
export function getRequestsNeedingRetry(): OutstandingRequest[] {
    const now = Date.now();
    return getDb().prepare(`
        SELECT * FROM outstanding_requests
        WHERE status = 'pending' AND ack_deadline < ? AND retry_count < max_retries
    `).all(now) as OutstandingRequest[];
}

/**
 * Get all acked requests that haven't been responded and deadline expired.
 */
export function getRequestsNeedingEscalation(): OutstandingRequest[] {
    const now = Date.now();
    return getDb().prepare(`
        SELECT * FROM outstanding_requests
        WHERE status = 'acked' AND response_deadline < ?
    `).all(now) as OutstandingRequest[];
}

/**
 * Increment retry count for a request.
 */
export function incrementRequestRetry(requestId: string, newDeadline: number): void {
    getDb().prepare(`
        UPDATE outstanding_requests 
        SET retry_count = retry_count + 1, ack_deadline = ?, status = 'pending'
        WHERE request_id = ?
    `).run(newDeadline, requestId);

    log('DEBUG', `Request ${requestId} retry incremented`);
}

/**
 * Get request by ID.
 */
export function getRequest(requestId: string): OutstandingRequest | null {
    const row = getDb().prepare(`
        SELECT * FROM outstanding_requests WHERE request_id = ?
    `).get(requestId) as OutstandingRequest | undefined;
    return row || null;
}

/**
 * Get all pending requests for a conversation.
 * Ordered by creation time (FIFO) so find() gets oldest first.
 */
export function getPendingRequestsForConversation(conversationId: string): OutstandingRequest[] {
    return getDb().prepare(`
        SELECT * FROM outstanding_requests 
        WHERE conversation_id = ? AND status IN ('pending', 'acked')
        ORDER BY created_at ASC
    `).all(conversationId) as OutstandingRequest[];
}

/**
 * Clean up old completed/failed requests.
 */
export function pruneOldRequests(olderThanMs = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs;
    const result = getDb().prepare(`
        DELETE FROM outstanding_requests 
        WHERE status IN ('responded', 'failed', 'escalated') AND created_at < ?
    `).run(cutoff);
    return result.changes;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

export function closeQueueDb(): void {
    if (db) {
        db.close();
        db = null;
    }
}
