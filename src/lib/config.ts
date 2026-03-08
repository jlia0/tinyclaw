import fs from 'fs';
import path from 'path';
import { jsonrepair } from 'jsonrepair';
import { Settings, AgentConfig, TeamConfig, CLAUDE_MODEL_IDS, CODEX_MODEL_IDS, OPENCODE_MODEL_IDS } from './types';

export const SCRIPT_DIR = path.resolve(__dirname, '../..');
const _localTinyclaw = path.join(SCRIPT_DIR, '.tinyclaw');
export const TINYCLAW_HOME = process.env.TINYCLAW_HOME
    || (fs.existsSync(path.join(_localTinyclaw, 'settings.json'))
        ? _localTinyclaw
        : path.join(require('os').homedir(), '.tinyclaw'));
export const LOG_FILE = path.join(TINYCLAW_HOME, 'logs/queue.log');
export const SETTINGS_FILE = path.join(TINYCLAW_HOME, 'settings.json');
export const CHATS_DIR = path.join(TINYCLAW_HOME, 'chats');
export const FILES_DIR = path.join(TINYCLAW_HOME, 'files');
export const WORKSPACE_DEFAULT_PATH = path.join(require('os').homedir(), 'tinyclaw-workspace');

export function generateId(prefix = ''): string {
    return `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function writeJsonFile(filePath: string, data: unknown): void {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

export function readJsonFile<T>(filePath: string, defaultValue: T): T {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
    } catch {
        return defaultValue;
    }
}

export function getSettings(): Settings {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        let settings: Settings;

        try {
            settings = JSON.parse(settingsData);
        } catch (parseError) {
            // JSON is invalid — attempt auto-fix with jsonrepair
            console.error(`[WARN] settings.json contains invalid JSON: ${(parseError as Error).message}`);

            try {
                const repaired = jsonrepair(settingsData);
                settings = JSON.parse(repaired);

                // Write the fixed JSON back and create a backup
                const backupPath = SETTINGS_FILE + '.bak';
                fs.copyFileSync(SETTINGS_FILE, backupPath);
                writeJsonFile(SETTINGS_FILE, settings);
                console.error(`[WARN] Auto-fixed settings.json (backup: ${backupPath})`);
            } catch {
                console.error(`[ERROR] Could not auto-fix settings.json — returning empty config`);
                return {};
            }
        }

        // Auto-detect provider if not specified
        if (!settings?.models?.provider && settings?.models) {
            if (settings.models.openai)           settings.models.provider = 'openai';
            else if (settings.models.opencode)    settings.models.provider = 'opencode';
            else if (settings.models.kimi)        settings.models.provider = 'kimi';
            else if (settings.models.minimax)     settings.models.provider = 'minimax';
            else if (settings.models.anthropic)   settings.models.provider = 'anthropic';
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
    } else if (provider === 'kimi') {
        model = settings?.models?.kimi?.model || 'kimi2.5';
    } else if (provider === 'minimax') {
        model = settings?.models?.minimax?.model || 'MiniMax-M2.5';
    } else {
        model = settings?.models?.anthropic?.model || 'sonnet';
    }

    // Get workspace path from settings or use default
    const workspacePath = settings?.workspace?.path || WORKSPACE_DEFAULT_PATH;
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

/**
 * Resolve API key for a provider with two-level fallback:
 * 1. Agent-specific apiKey
 * 2. Global provider apiKey from settings
 * 3. Empty string (caller should handle error)
 */
export function resolveApiKey(agent: AgentConfig, settings: Settings): string {
    const provider = agent.provider;

    // 1. Check agent-specific key
    if (agent.apiKey) {
        return agent.apiKey;
    }

    // 2. Check global key from settings
    if (provider === 'kimi') {
        return settings.models?.kimi?.apiKey || '';
    } else if (provider === 'minimax') {
        return settings.models?.minimax?.apiKey || '';
    }

    // 3. No key found (anthropic/openai/opencode don't need this)
    return '';
}

/**
 * Get the base URL for a provider.
 * Kimi and MiniMax use custom endpoints compatible with Claude Code.
 */
export function getProviderBaseUrl(provider: string): string {
    switch (provider) {
        case 'kimi':
            return 'https://api.kimi.com/coding/';
        case 'minimax':
            return 'https://api.minimax.io/anthropic';
        default:
            // Anthropic default (Claude Code handles this)
            return '';
    }
}

