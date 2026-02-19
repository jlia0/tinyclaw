export interface AgentConfig {
    name: string;
    provider: string;       // 'anthropic' or 'openai'
    model: string;           // e.g. 'sonnet', 'opus', 'gpt-5.3-codex'
    working_directory: string;
}

export interface TeamConfig {
    name: string;
    agents: string[];
    leader_agent: string;
}

export interface ChainStep {
    agentId: string;
    response: string;
}

export interface Settings {
    workspace?: {
        path?: string;
        name?: string;
    };
    channels?: {
        enabled?: string[];
        discord?: { bot_token?: string };
        telegram?: { bot_token?: string };
        whatsapp?: {};
    };
    models?: {
        provider?: string; // 'anthropic' or 'openai'
        anthropic?: {
            model?: string;
        };
        openai?: {
            model?: string;
        };
    };
    agents?: Record<string, AgentConfig>;
    teams?: Record<string, TeamConfig>;
    monitoring?: {
        heartbeat_interval?: number;
    };
    memory?: {
        enabled?: boolean;
        rerank?: {
            enabled?: boolean;
            answer_signal_patterns?: string[];
            low_confidence_patterns?: string[];
            answer_signal_bonus?: number;
            low_confidence_penalty?: number;
            code_pattern_bonus?: number;
            term_hit_bonus?: number;
        };
        retention?: {
            enabled?: boolean;
            retain_days?: number;
            max_turn_files_per_agent?: number;
            cleanup_interval_seconds?: number;
        };
        qmd?: {
            enabled?: boolean;
            command?: string;
            top_k?: number;
            min_score?: number;
            max_chars?: number;
            update_interval_seconds?: number;
            embed_interval_seconds?: number;
            use_semantic_search?: boolean;
            disable_query_expansion?: boolean;
            allow_unsafe_vsearch?: boolean;
            quick_precheck_enabled?: boolean;
            precheck_timeout_ms?: number;
            search_timeout_ms?: number;
            vector_search_timeout_ms?: number;
            debug_logging?: boolean;
        };
    };
}

export interface MessageData {
    channel: string;
    sender: string;
    senderId?: string;
    message: string;
    timestamp: number;
    messageId: string;
    agent?: string; // optional: pre-routed agent id from channel client
    files?: string[];
}

export interface ResponseData {
    channel: string;
    sender: string;
    message: string;
    originalMessage: string;
    timestamp: number;
    messageId: string;
    agent?: string; // which agent handled this
    files?: string[];
}

export interface QueueFile {
    name: string;
    path: string;
    time: number;
}

// Model name mapping
export const CLAUDE_MODEL_IDS: Record<string, string> = {
    'sonnet': 'claude-sonnet-4-5',
    'opus': 'claude-opus-4-6',
    'claude-sonnet-4-5': 'claude-sonnet-4-5',
    'claude-opus-4-6': 'claude-opus-4-6'
};

export const CODEX_MODEL_IDS: Record<string, string> = {
    'gpt-5.2': 'gpt-5.2',
    'gpt-5.3-codex': 'gpt-5.3-codex',
};
