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
    security?: {
        require_sender_allowlist?: boolean;
        allowed_senders?: {
            discord?: string[];
            telegram?: string[];
            whatsapp?: string[];
        };
        allow_dangerous_agent_flags?: boolean;
        allow_outbound_file_paths_outside_files_dir?: boolean;
        persist_team_chats?: boolean;
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
