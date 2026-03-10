#!/usr/bin/env node
import * as p from '@clack/prompts';
import fs from 'fs';
import path from 'path';
import { Settings, AgentConfig, ensureAgentDirectory, copyDirSync } from '@tinyclaw/core';
import {
    unwrap, cleanId, validateId, required,
    writeSettings, SETTINGS_FILE, TINYCLAW_HOME, SCRIPT_DIR,
    providerOptions, promptModel,
} from './shared';

const ALL_CHANNELS = ['telegram', 'discord', 'whatsapp'] as const;

const CHANNEL_DISPLAY: Record<string, string> = {
    telegram: 'Telegram',
    discord: 'Discord',
    whatsapp: 'WhatsApp',
};

const CHANNEL_TOKEN_PROMPT: Record<string, string> = {
    discord: 'Enter your Discord bot token',
    telegram: 'Enter your Telegram bot token',
};

const CHANNEL_TOKEN_HELP: Record<string, string> = {
    discord: 'Get one at: https://discord.com/developers/applications',
    telegram: 'Create a bot via @BotFather on Telegram to get a token',
};

async function main() {
    p.intro('TinyClaw - Setup Wizard');

    // --- Channel selection ---
    const enabledChannels = unwrap(await p.multiselect({
        message: 'Which messaging channels do you want to enable?',
        options: ALL_CHANNELS.map(ch => ({
            value: ch,
            label: CHANNEL_DISPLAY[ch],
        })),
        required: true,
    }));

    // --- Collect tokens ---
    const tokens: Record<string, string> = {};
    for (const ch of enabledChannels) {
        if (CHANNEL_TOKEN_PROMPT[ch]) {
            tokens[ch] = unwrap(await p.password({
                message: `${CHANNEL_TOKEN_PROMPT[ch]} (${CHANNEL_TOKEN_HELP[ch]})`,
                validate: required,
            }));
        }
    }

    // --- Provider selection ---
    const provider = unwrap(await p.select({
        message: 'Which AI provider?',
        options: providerOptions(),
    }));

    // --- Model selection ---
    const model = await promptModel(provider as string);

    // --- Heartbeat interval ---
    const heartbeatInput = unwrap(await p.text({
        message: 'Heartbeat interval in seconds',
        placeholder: '3600',
        defaultValue: '3600',
        validate(value) {
            if (value && !/^\d+$/.test(value)) return 'Must be a number.';
        },
    }));
    const heartbeatInterval = parseInt(heartbeatInput || '3600', 10);

    // --- Workspace ---
    const workspaceInput = unwrap(await p.text({
        message: 'Workspace name (where agent directories will be stored)',
        placeholder: 'tinyclaw-workspace',
        defaultValue: 'tinyclaw-workspace',
    }));

    const workspaceName = (workspaceInput || 'tinyclaw-workspace').replace(/ /g, '-').replace(/[^a-zA-Z0-9_/~.-]/g, '');
    let workspacePath: string;
    if (workspaceName.startsWith('/') || workspaceName.startsWith('~')) {
        workspacePath = workspaceName.replace(/^~/, process.env.HOME || '~');
    } else {
        workspacePath = path.join(process.env.HOME || '~', workspaceName);
    }

    // --- Default agent ---
    const defaultAgentInput = unwrap(await p.text({
        message: 'Name your default agent',
        placeholder: 'assistant',
        defaultValue: 'assistant',
    }));
    const defaultAgentId = cleanId(defaultAgentInput || 'assistant') || 'assistant';
    const defaultAgentDisplay = defaultAgentId.charAt(0).toUpperCase() + defaultAgentId.slice(1);

    // --- Build agents map ---
    const agents: Record<string, AgentConfig> = {};
    agents[defaultAgentId] = {
        name: defaultAgentDisplay,
        provider: provider as string,
        model,
        working_directory: path.join(workspacePath, defaultAgentId),
    };

    // --- Additional agents ---
    const addMore = unwrap(await p.confirm({
        message: 'Set up additional agents?',
        initialValue: false,
    }));

    if (addMore) {
        let adding = true;
        while (adding) {
            const agentId = cleanId(unwrap(await p.text({
                message: 'Agent ID (lowercase, no spaces)',
                placeholder: 'coder',
                validate: validateId,
            })));

            const agentName = unwrap(await p.text({
                message: 'Display name',
                placeholder: agentId,
                defaultValue: agentId,
            }));

            const agentProvider = unwrap(await p.select({
                message: 'Provider',
                options: providerOptions(),
            }));

            const agentModel = await promptModel(agentProvider as string);

            agents[agentId] = {
                name: agentName || agentId,
                provider: agentProvider as string,
                model: agentModel,
                working_directory: path.join(workspacePath, agentId),
            };

            p.log.success(`Agent '${agentId}' added`);

            adding = unwrap(await p.confirm({
                message: 'Add another agent?',
                initialValue: false,
            }));
        }
    }

    // --- Build settings ---
    const providerKey = provider as string;
    const settings: Settings = {
        workspace: {
            path: workspacePath,
            name: workspaceName,
        },
        channels: {
            enabled: enabledChannels as string[],
            discord: { bot_token: tokens['discord'] || '' },
            telegram: { bot_token: tokens['telegram'] || '' },
            whatsapp: {},
        },
        agents,
        models: {
            provider: providerKey,
            ...(providerKey === 'anthropic' ? { anthropic: { model } } : {}),
            ...(providerKey === 'openai' ? { openai: { model } } : {}),
            ...(providerKey === 'opencode' ? { opencode: { model } } : {}),
        },
        monitoring: {
            heartbeat_interval: heartbeatInterval,
        },
    };

    // --- Write settings ---
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    writeSettings(settings);
    p.log.success('Configuration saved to ' + SETTINGS_FILE);

    // --- Create workspace and agent directories ---
    fs.mkdirSync(workspacePath, { recursive: true });
    p.log.success(`Created workspace: ${workspacePath}`);

    // Create ~/.tinyclaw with templates
    fs.mkdirSync(path.join(TINYCLAW_HOME, 'logs'), { recursive: true });
    fs.mkdirSync(path.join(TINYCLAW_HOME, 'files'), { recursive: true });

    const templateItems = ['.claude', 'heartbeat.md', 'AGENTS.md'];
    for (const item of templateItems) {
        const srcPath = path.join(SCRIPT_DIR, item);
        const destPath = path.join(TINYCLAW_HOME, item);
        if (fs.existsSync(srcPath)) {
            if (fs.statSync(srcPath).isDirectory()) {
                copyDirSync(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }
    p.log.success('Created ~/.tinyclaw with templates');

    // Create agent directories
    for (const agentId of Object.keys(agents)) {
        ensureAgentDirectory(agents[agentId].working_directory);
        p.log.success(`Created agent directory: ${agents[agentId].working_directory}`);
    }

    p.outro('Setup complete! Run `tinyclaw start` to begin.');
}

main().catch(err => {
    p.log.error(err.message);
    process.exit(1);
});
