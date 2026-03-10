import * as p from '@clack/prompts';
import fs from 'fs';
import path from 'path';
import { Settings, SETTINGS_FILE, TINYCLAW_HOME, SCRIPT_DIR } from '@tinyclaw/core';

// Re-export for convenience
export { SETTINGS_FILE, TINYCLAW_HOME, SCRIPT_DIR };

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
    ];
    if (includeCustom) {
        opts.push({ value: 'custom', label: 'Custom Provider' });
    }
    return opts;
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
        { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', hint: 'recommended' },
        { value: 'gpt-5.2', label: 'GPT-5.2' },
        { value: '__custom__', label: 'Custom', hint: 'enter model name' },
    ];
}

export function opencodeModelOptions(): ProviderOption[] {
    return [
        { value: 'opencode/claude-sonnet-4-5', label: 'opencode/claude-sonnet-4-5', hint: 'recommended' },
        { value: 'opencode/claude-opus-4-6', label: 'opencode/claude-opus-4-6' },
        { value: 'opencode/gemini-3-flash', label: 'opencode/gemini-3-flash' },
        { value: 'opencode/gemini-3-pro', label: 'opencode/gemini-3-pro' },
        { value: 'anthropic/claude-sonnet-4-5', label: 'anthropic/claude-sonnet-4-5' },
        { value: 'anthropic/claude-opus-4-6', label: 'anthropic/claude-opus-4-6' },
        { value: 'openai/gpt-5.3-codex', label: 'openai/gpt-5.3-codex' },
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
