export interface CustomProvider {
    name: string;
    harness: 'claude' | 'codex';  // which CLI to invoke
    base_url: string;
    api_key: string;
    model?: string;               // model name to pass to the CLI
}

export interface AgentConfig {
    name: string;
    provider: string;       // 'anthropic', 'openai', 'opencode', or 'custom:<provider_id>'
    model: string;           // e.g. 'sonnet', 'opus', 'gpt-5.3-codex'
    working_directory: string;
    system_prompt?: string;
    prompt_file?: string;
    heartbeat?: {
        enabled?: boolean;
        interval?: number;
    };
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
        defaults?: Record<string, { agentId: string }>;
    };
    models?: {
        provider?: string; // 'anthropic', 'openai', or 'opencode'
        anthropic?: {
            model?: string;
            auth_token?: string;
        };
        openai?: {
            model?: string;
            auth_token?: string;
        };
        opencode?: {
            model?: string;
        };
    };
    agents?: Record<string, AgentConfig>;
    custom_providers?: Record<string, CustomProvider>;
    teams?: Record<string, TeamConfig>;
    monitoring?: {
        heartbeat_interval?: number;
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
    // Internal message fields (agent-to-agent)
    conversationId?: string; // links to parent conversation
    fromAgent?: string;      // which agent sent this internal message
}

export interface Conversation {
    id: string;
    channel: string;
    sender: string;
    originalMessage: string;
    messageId: string;
    pending: number;
    responses: ChainStep[];
    files: Set<string>;
    totalMessages: number;
    maxMessages: number;
    teamContext: { teamId: string; team: TeamConfig };
    startTime: number;
    // Track how many mentions each agent sent out (for inbox draining)
    outgoingMentions: Map<string, number>;
    // Track agents that have been enqueued but haven't finished responding
    pendingAgents: Set<string>;
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
    metadata?: Record<string, unknown>;
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

// OpenCode model IDs in provider/model format (passed via --model / -m flag).
// Falls back to the raw model string from settings if no mapping is found.
export const OPENCODE_MODEL_IDS: Record<string, string> = {
    'opencode/claude-opus-4-6': 'opencode/claude-opus-4-6',
    'opencode/claude-sonnet-4-5': 'opencode/claude-sonnet-4-5',
    'opencode/gemini-3-flash': 'opencode/gemini-3-flash',
    'opencode/gemini-3-pro': 'opencode/gemini-3-pro',
    'opencode/glm-5': 'opencode/glm-5',
    'opencode/kimi-k2.5': 'opencode/kimi-k2.5',
    'opencode/kimi-k2.5-free': 'opencode/kimi-k2.5-free',
    'opencode/minimax-m2.5': 'opencode/minimax-m2.5',
    'opencode/minimax-m2.5-free': 'opencode/minimax-m2.5-free',
    'anthropic/claude-opus-4-6': 'anthropic/claude-opus-4-6',
    'anthropic/claude-sonnet-4-5': 'anthropic/claude-sonnet-4-5',
    'openai/gpt-5.2': 'openai/gpt-5.2',
    'openai/gpt-5.3-codex': 'openai/gpt-5.3-codex',
    'openai/gpt-5.3-codex-spark': 'openai/gpt-5.3-codex-spark',
    // Shorthand aliases
    'sonnet': 'opencode/claude-sonnet-4-5',
    'opus': 'opencode/claude-opus-4-6',
};

// Queue job data types
export interface MessageJobData {
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

export interface ResponseJobData {
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
