import * as p from '@clack/prompts';
import fs from 'fs';
import path from 'path';
import { Settings, SETTINGS_FILE, TINYAGI_HOME, SCRIPT_DIR } from '@tinyagi/core';

// Re-export for convenience
export { SETTINGS_FILE, TINYAGI_HOME, SCRIPT_DIR };

const BANNER = `
  ▀█▀ █ █▄ █ █▄█ █▀█ █▀▀ █
   █  █ █ ▀█  █  █▀█ █▄█ █
`;

/**
 * Print the TinyAGI ASCII banner.
 */
export function printBanner(): void {
    console.log(BANNER);
}

/**
 * Unwrap a clack prompt result: exit on cancel, return typed value.
 */
export function unwrap<T>(value: T | symbol): T {
    if (p.isCancel(value)) {
        p.cancel('Operation cancelled.');
        process.exit(0);
    }
    return value;
}

/**
 * Clean an ID string: lowercase, strip invalid chars.
 */
export function cleanId(input: string): string {
    return input.toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

/**
 * Validate that a string is a non-empty cleaned ID.
 */
export function validateId(value: string | undefined): string | undefined {
    const cleaned = cleanId(value || '');
    if (!cleaned) return 'Invalid ID. Use lowercase letters, numbers, hyphens, or underscores.';
}

/**
 * Validate non-empty input.
 */
export function required(value: string | undefined): string | undefined {
    if (!value?.trim()) return 'This field is required.';
}

/**
 * Read settings.json, returning empty object if missing.
 */
export function readSettings(): Settings {
    try {
        return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    } catch {
        return {};
    }
}

/**
 * Write settings.json atomically.
 */
export function writeSettings(settings: Settings): void {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    const tmp = SETTINGS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');
    fs.renameSync(tmp, SETTINGS_FILE);
}

/**
 * Ensure settings file exists, exit with error if not.
 */
export function requireSettings(): Settings {
    if (!fs.existsSync(SETTINGS_FILE)) {
        p.log.error('No settings file found. Run setup first.');
        process.exit(1);
    }
    return readSettings();
}

// -- Provider/Model option builders --

export interface ProviderOption {
    value: string;
    label: string;
    hint?: string;
}

export function providerOptions(includeCustom = false): ProviderOption[] {
    const opts: ProviderOption[] = [
        { value: 'anthropic', label: 'Anthropic (Claude)', hint: 'recommended' },
        { value: 'openai', label: 'OpenAI (Codex/GPT)' },
        { value: 'opencode', label: 'OpenCode' },
        { value: 'novita', label: 'Novita AI', hint: 'kimi-k2.5, glm-5, minimax-m2.5' },
    ];
    if (includeCustom) {
        opts.push({ value: 'custom', label: 'Custom Provider' });
    }
    return opts;
}

export function novitaModelOptions(): ProviderOption[] {
    return [
        { value: 'moonshotai/kimi-k2.5', label: 'kimi-k2.5', hint: 'recommended, 262k context' },
        { value: 'zai-org/glm-5', label: 'glm-5', hint: '202k context' },
        { value: 'minimax/minimax-m2.5', label: 'minimax-m2.5', hint: '204k context' },
        { value: '__custom__', label: 'Custom', hint: 'enter model name' },
    ];
}

export function anthropicModelOptions(): ProviderOption[] {
    return [
        { value: 'sonnet', label: 'Sonnet', hint: 'fast, recommended' },
        { value: 'opus', label: 'Opus', hint: 'smartest' },
        { value: '__custom__', label: 'Custom', hint: 'enter model name' },
    ];
}

export function openaiModelOptions(): ProviderOption[] {
    return [
        { value: 'gpt-5.4-codex', label: 'GPT-5.4 Codex', hint: 'recommended' },
        { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
        { value: 'gpt-5.4', label: 'GPT-5.4' },
        { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
        { value: 'gpt-5.4-nano', label: 'GPT-5.4 Nano' },
        { value: '__custom__', label: 'Custom', hint: 'enter model name' },
    ];
}

export function opencodeModelOptions(): ProviderOption[] {
    return [
        // Anthropic
        { value: 'opencode/claude-sonnet-4-6', label: 'opencode/claude-sonnet-4-6', hint: 'recommended' },
        { value: 'opencode/claude-opus-4-6', label: 'opencode/claude-opus-4-6' },
        { value: 'anthropic/claude-sonnet-4-6', label: 'anthropic/claude-sonnet-4-6' },
        { value: 'anthropic/claude-opus-4-6', label: 'anthropic/claude-opus-4-6' },
        // OpenAI
        { value: 'openai/gpt-5.4-codex', label: 'openai/gpt-5.4-codex' },
        { value: 'openai/gpt-5.3-codex', label: 'openai/gpt-5.3-codex' },
        { value: 'openai/gpt-5.3-codex-spark', label: 'openai/gpt-5.3-codex-spark' },
        // Google
        { value: 'opencode/gemini-3-flash', label: 'opencode/gemini-3-flash' },
        { value: 'opencode/gemini-3-pro', label: 'opencode/gemini-3-pro' },
        // Chinese models
        { value: 'opencode/glm-5', label: 'opencode/glm-5' },
        { value: 'opencode/kimi-k2.5', label: 'opencode/kimi-k2.5' },
        { value: 'opencode/kimi-k2.5-free', label: 'opencode/kimi-k2.5-free' },
        { value: 'opencode/minimax-m2.5', label: 'opencode/minimax-m2.5' },
        { value: 'opencode/minimax-m2.5-free', label: 'opencode/minimax-m2.5-free' },
        { value: '__custom__', label: 'Custom', hint: 'enter model name' },
    ];
}

/**
 * Prompt for model selection based on provider. Returns model string.
 */
export async function promptModel(provider: string): Promise<string> {
    let options: ProviderOption[];
    let customHint = 'Enter model name';

    if (provider === 'anthropic') {
        options = anthropicModelOptions();
    } else if (provider === 'opencode') {
        options = opencodeModelOptions();
        customHint = 'Enter model name (e.g. provider/model)';
    } else if (provider === 'novita') {
        options = novitaModelOptions();
        customHint = 'Enter model name (e.g. moonshotai/kimi-k2.5)';
    } else {
        options = openaiModelOptions();
    }

    const choice = unwrap(await p.select({
        message: 'Model',
        options,
    }));

    if (choice === '__custom__') {
        return unwrap(await p.text({
            message: customHint,
            validate: required,
        }));
    }

    return choice as string;
}

/**
 * Prompt for harness selection (claude or codex).
 */
export function harnessOptions(): ProviderOption[] {
    return [
        { value: 'claude', label: 'claude (Anthropic CLI)' },
        { value: 'codex', label: 'codex (OpenAI CLI)' },
    ];
}
