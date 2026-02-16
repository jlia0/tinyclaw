-- migrate:up
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

-- migrate:down
DROP TABLE IF EXISTS api_rate_limits;
