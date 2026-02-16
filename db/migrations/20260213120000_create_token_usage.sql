-- migrate:up
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

CREATE INDEX idx_token_usage_agent_id ON token_usage(agent_id);
CREATE INDEX idx_token_usage_created_at ON token_usage(created_at);

-- migrate:down
DROP TABLE IF EXISTS token_usage;
