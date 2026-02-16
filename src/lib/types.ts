export interface AgentConfig {
    name: string;
    provider: string;       // provider id (from providers registry)
    model: string;           // provider-specific model name or id
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
        provider?: string; // 'anthropic', 'openai', or 'qoder'
        anthropic?: {
            model?: string;
        };
        openai?: {
            model?: string;
        };
        qoder?: {
            model?: string;
        };
    };
    agents?: Record<string, AgentConfig>;
    teams?: Record<string, TeamConfig>;
    monitoring?: {
        heartbeat_interval?: number;
    };
}

export interface ProviderOutputSelect {
    match?: Record<string, string>;
    field?: string;
}

export interface ProviderOutputConfig {
    type: 'plain' | 'jsonl';
    select?: ProviderOutputSelect;
}

export interface ProviderConfig {
    display_name: string;
    executable: string;
    args: string[];
    conditional_args?: Record<string, string[]>;
    output?: ProviderOutputConfig;
    models?: Record<string, string>;
}

export interface ProviderRegistry {
    version: number;
    providers: Record<string, ProviderConfig>;
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
