import fs from 'fs';
import path from 'path';
import {
    Settings, AgentConfig, TeamConfig, CLAUDE_MODEL_IDS, CODEX_MODEL_IDS,
    NormalizedSandboxConfig, SandboxMode
} from './types';

export const SCRIPT_DIR = path.resolve(__dirname, '../..');
const _localTinyclaw = path.join(SCRIPT_DIR, '.tinyclaw');
export const TINYCLAW_HOME = fs.existsSync(path.join(_localTinyclaw, 'settings.json'))
    ? _localTinyclaw
    : path.join(require('os').homedir(), '.tinyclaw');
export const QUEUE_INCOMING = path.join(TINYCLAW_HOME, 'queue/incoming');
export const QUEUE_OUTGOING = path.join(TINYCLAW_HOME, 'queue/outgoing');
export const QUEUE_PROCESSING = path.join(TINYCLAW_HOME, 'queue/processing');
export const QUEUE_DEAD_LETTER = path.join(TINYCLAW_HOME, 'queue/dead-letter');
export const LOG_FILE = path.join(TINYCLAW_HOME, 'logs/queue.log');
export const RESET_FLAG = path.join(TINYCLAW_HOME, 'reset_flag');
export const SETTINGS_FILE = path.join(TINYCLAW_HOME, 'settings.json');
export const EVENTS_DIR = path.join(TINYCLAW_HOME, 'events');
export const CHATS_DIR = path.join(TINYCLAW_HOME, 'chats');

const DEFAULT_SANDBOX: NormalizedSandboxConfig = {
    mode: 'host',
    timeout_seconds: 600,
    max_attempts: 3,
    max_concurrency: 0,
    env_allowlist: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
    path_mapping_mode: 'mapped',
    docker: {
        image: 'tinyclaw/agent-runner:latest',
        network: 'default',
        memory: '2g',
        cpus: '1.0',
        pids_limit: 256,
    },
    apple: {
        runtime_command: 'apple-container',
        image: 'tinyclaw/agent-runner:latest',
        network: 'default',
        memory: '2g',
        cpus: '1.0',
    },
};

export function getSettings(): Settings {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const settings: Settings = JSON.parse(settingsData);

        // Auto-detect provider if not specified
        if (!settings?.models?.provider) {
            if (settings?.models?.openai) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'openai';
            } else if (settings?.models?.anthropic) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'anthropic';
            }
        }

        return settings;
    } catch {
        return {};
    }
}

/**
 * Build the default agent config from the legacy models section.
 * Used when no agents are configured, for backwards compatibility.
 */
export function getDefaultAgentFromModels(settings: Settings): AgentConfig {
    const provider = settings?.models?.provider || 'anthropic';
    let model = '';
    if (provider === 'openai') {
        model = settings?.models?.openai?.model || 'gpt-5.3-codex';
    } else {
        model = settings?.models?.anthropic?.model || 'sonnet';
    }

    // Get workspace path from settings or use default
    const workspacePath = settings?.workspace?.path || path.join(require('os').homedir(), 'tinyclaw-workspace');
    const defaultAgentDir = path.join(workspacePath, 'default');

    return {
        name: 'Default',
        provider,
        model,
        working_directory: defaultAgentDir,
    };
}

/**
 * Get all configured agents. Falls back to a single "default" agent
 * derived from the legacy models section if no agents are configured.
 */
export function getAgents(settings: Settings): Record<string, AgentConfig> {
    if (settings.agents && Object.keys(settings.agents).length > 0) {
        return settings.agents;
    }
    // Fall back to default agent from models section
    return { default: getDefaultAgentFromModels(settings) };
}

/**
 * Get all configured teams.
 */
export function getTeams(settings: Settings): Record<string, TeamConfig> {
    return settings.teams || {};
}

/**
 * Resolve the model ID for Claude (Anthropic).
 */
export function resolveClaudeModel(model: string): string {
    return CLAUDE_MODEL_IDS[model] || model || '';
}

/**
 * Resolve the model ID for Codex (OpenAI).
 */
export function resolveCodexModel(model: string): string {
    return CODEX_MODEL_IDS[model] || model || '';
}

/**
 * Resolve and normalize sandbox configuration.
 * Per-agent sandbox_mode overrides global settings.sandbox.mode.
 */
export function getSandboxConfig(settings: Settings, agent?: AgentConfig): NormalizedSandboxConfig {
    const configured = settings?.sandbox || {};
    const mode = (agent?.sandbox_mode || configured.mode || DEFAULT_SANDBOX.mode) as SandboxMode;

    const allowlist = Array.isArray(configured.env_allowlist) && configured.env_allowlist.length > 0
        ? configured.env_allowlist
        : DEFAULT_SANDBOX.env_allowlist;

    return {
        mode,
        timeout_seconds: configured.timeout_seconds || DEFAULT_SANDBOX.timeout_seconds,
        max_attempts: configured.max_attempts || DEFAULT_SANDBOX.max_attempts,
        max_concurrency: configured.max_concurrency || DEFAULT_SANDBOX.max_concurrency,
        env_allowlist: allowlist,
        path_mapping_mode: configured.path_mapping_mode || DEFAULT_SANDBOX.path_mapping_mode,
        docker: {
            image: configured.docker?.image || DEFAULT_SANDBOX.docker.image,
            network: configured.docker?.network || DEFAULT_SANDBOX.docker.network,
            memory: configured.docker?.memory || DEFAULT_SANDBOX.docker.memory,
            cpus: configured.docker?.cpus || DEFAULT_SANDBOX.docker.cpus,
            pids_limit: configured.docker?.pids_limit || DEFAULT_SANDBOX.docker.pids_limit,
        },
        apple: {
            runtime_command: configured.apple?.runtime_command || DEFAULT_SANDBOX.apple.runtime_command,
            image: configured.apple?.image || DEFAULT_SANDBOX.apple.image,
            network: configured.apple?.network || DEFAULT_SANDBOX.apple.network,
            memory: configured.apple?.memory || DEFAULT_SANDBOX.apple.memory,
            cpus: configured.apple?.cpus || DEFAULT_SANDBOX.apple.cpus,
        },
    };
}
