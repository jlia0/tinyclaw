import fs from 'fs';
import path from 'path';
import { Settings, AgentConfig, TeamConfig, CLAUDE_MODEL_IDS, CODEX_MODEL_IDS, OPENCODE_MODEL_IDS } from './types';

export const SCRIPT_DIR = path.resolve(__dirname, '../..');
const _localTinyclaw = path.join(SCRIPT_DIR, '.tinyclaw');
export const TINYCLAW_HOME = fs.existsSync(path.join(_localTinyclaw, 'settings.json'))
    ? _localTinyclaw
    : path.join(require('os').homedir(), '.tinyclaw');
export const QUEUE_INCOMING = path.join(TINYCLAW_HOME, 'queue/incoming');
export const QUEUE_OUTGOING = path.join(TINYCLAW_HOME, 'queue/outgoing');
export const QUEUE_PROCESSING = path.join(TINYCLAW_HOME, 'queue/processing');
export const LOG_FILE = path.join(TINYCLAW_HOME, 'logs/queue.log');
export const RESET_FLAG = path.join(TINYCLAW_HOME, 'reset_flag');
export const SETTINGS_FILE = path.join(TINYCLAW_HOME, 'settings.json');
export const EVENTS_DIR = path.join(TINYCLAW_HOME, 'events');
export const CHATS_DIR = path.join(TINYCLAW_HOME, 'chats');

export function getSettings(): Settings {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const settings: Settings = JSON.parse(settingsData);

        // Auto-detect provider if not specified
        if (!settings?.models?.provider) {
            if (settings?.models?.openai) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'openai';
            } else if (settings?.models?.opencode) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'opencode';
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
    } else if (provider === 'opencode') {
        model = settings?.models?.opencode?.model || 'sonnet';
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
 * Resolve the model ID for OpenCode (passed via --model flag).
 * Falls back to the raw model string from settings if no mapping is found.
 */
export function resolveOpenCodeModel(model: string): string {
    return OPENCODE_MODEL_IDS[model] || model || '';
}
