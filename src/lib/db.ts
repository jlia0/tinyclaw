import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { DB_PATH, SCRIPT_DIR } from './config';
import { log } from './logging';

let db: Database.Database | null = null;

/**
 * Check whether dbmate is installed on the system.
 */
function isDbmateInstalled(): boolean {
    try {
        execSync('command -v dbmate', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Run dbmate migrations against the database.
 */
function runDbmateMigrations(): void {
    const migrationsDir = path.join(SCRIPT_DIR, 'db', 'migrations');
    if (!fs.existsSync(migrationsDir)) {
        log('WARN', `Migrations directory not found: ${migrationsDir}`);
        return;
    }

    try {
        execSync(
            `DATABASE_URL="sqlite:${DB_PATH}" dbmate --migrations-dir "${migrationsDir}" --no-dump-schema up`,
            { stdio: 'ignore' }
        );
        log('INFO', 'Database migrations applied via dbmate');
    } catch (e) {
        log('WARN', `dbmate migration failed: ${(e as Error).message}`);
    }
}

/**
 * Create the table and indexes directly via SQL (fallback when dbmate is not available).
 */
function createSchemaFallback(database: Database.Database): void {
    database.exec(`
        CREATE TABLE IF NOT EXISTS token_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            agent_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            message_char_count INTEGER NOT NULL,
            estimated_input_tokens INTEGER NOT NULL,
            response_char_count INTEGER,
            estimated_output_tokens INTEGER,
            duration_ms INTEGER
        );
    `);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_token_usage_agent_id ON token_usage(agent_id);`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_token_usage_created_at ON token_usage(created_at);`);

    database.exec(`
        CREATE TABLE IF NOT EXISTS api_rate_limits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            checked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            agent_id TEXT NOT NULL DEFAULT '',
            model TEXT NOT NULL,
            requests_limit INTEGER,
            requests_remaining INTEGER,
            requests_reset TEXT,
            input_tokens_limit INTEGER,
            input_tokens_remaining INTEGER,
            input_tokens_reset TEXT,
            output_tokens_limit INTEGER,
            output_tokens_remaining INTEGER,
            output_tokens_reset TEXT,
            inferred_tier TEXT
        );
    `);

    log('INFO', 'Database schema created via fallback (dbmate not available)');
}

export function getDb(): Database.Database {
    if (db) return db;

    const isNew = !fs.existsSync(DB_PATH);

    // Ensure parent directory exists
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    if (isNew) {
        log('INFO', `Creating new database: ${DB_PATH}`);

        if (isDbmateInstalled()) {
            // Let dbmate create the file and apply migrations
            runDbmateMigrations();

            // Open the file dbmate just created (or create it if migration had no effect)
            db = new Database(DB_PATH);
        } else {
            // Create the file via better-sqlite3 and apply schema manually
            db = new Database(DB_PATH);
            createSchemaFallback(db);
        }
    } else {
        // DB already exists — open it, then try to apply any pending migrations
        db = new Database(DB_PATH);

        if (isDbmateInstalled()) {
            runDbmateMigrations();
        } else {
            // Ensure schema exists (idempotent thanks to IF NOT EXISTS)
            createSchemaFallback(db);
        }
    }

    db.pragma('journal_mode = WAL');
    return db;
}

export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

export interface TokenUsageRecord {
    agentId: string;
    provider: string;
    model: string;
    messageCharCount: number;
    estimatedInputTokens: number;
}

export function insertTokenUsage(record: TokenUsageRecord): number {
    const stmt = getDb().prepare(`
        INSERT INTO token_usage (agent_id, provider, model, message_char_count, estimated_input_tokens)
        VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
        record.agentId,
        record.provider,
        record.model,
        record.messageCharCount,
        record.estimatedInputTokens
    );
    return Number(result.lastInsertRowid);
}

export function updateTokenUsageResponse(
    rowId: number,
    responseCharCount: number,
    estimatedOutputTokens: number,
    durationMs: number
): void {
    const stmt = getDb().prepare(`
        UPDATE token_usage
        SET response_char_count = ?, estimated_output_tokens = ?, duration_ms = ?
        WHERE id = ?
    `);
    stmt.run(responseCharCount, estimatedOutputTokens, durationMs, rowId);
}

export interface RateLimitRecord {
    agentId: string;
    model: string;
    requestsLimit: number | null;
    requestsRemaining: number | null;
    requestsReset: string | null;
    inputTokensLimit: number | null;
    inputTokensRemaining: number | null;
    inputTokensReset: string | null;
    outputTokensLimit: number | null;
    outputTokensRemaining: number | null;
    outputTokensReset: string | null;
    inferredTier: string | null;
}

export function insertRateLimitCheck(record: RateLimitRecord): number {
    const stmt = getDb().prepare(`
        INSERT INTO api_rate_limits (
            agent_id, model, requests_limit, requests_remaining, requests_reset,
            input_tokens_limit, input_tokens_remaining, input_tokens_reset,
            output_tokens_limit, output_tokens_remaining, output_tokens_reset,
            inferred_tier
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
        record.agentId,
        record.model,
        record.requestsLimit,
        record.requestsRemaining,
        record.requestsReset,
        record.inputTokensLimit,
        record.inputTokensRemaining,
        record.inputTokensReset,
        record.outputTokensLimit,
        record.outputTokensRemaining,
        record.outputTokensReset,
        record.inferredTier
    );
    return Number(result.lastInsertRowid);
}

export function closeDb(): void {
    if (db) {
        db.close();
        db = null;
    }
}
