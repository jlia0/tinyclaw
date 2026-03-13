#!/usr/bin/env node
import * as p from '@clack/prompts';
import { readSettings, writeSettings, requireSettings } from './shared.ts';

// --- provider show ---

function providerShow() {
    const settings = requireSettings();
    const provider = settings.models?.provider || 'anthropic';
    const modelSection = provider === 'openai' ? settings.models?.openai : settings.models?.anthropic;
    const model = modelSection?.model || '';

    if (model) {
        p.log.info(`Global default: ${provider}/${model}`);
    } else {
        p.log.info(`Global default: ${provider}`);
    }

    const agents = settings.agents || {};
    const agentIds = Object.keys(agents);
    if (agentIds.length > 0) {
        p.log.message('');
        p.log.message('Per-agent models:');
        for (const id of agentIds) {
            p.log.message(`  @${id}: ${agents[id].provider}/${agents[id].model}`);
        }
    }
}

// --- provider set ---

function providerSet(providerName: string, args: string[]) {
    const settings = requireSettings();

    // Parse flags
    let modelArg = '';
    let authTokenArg = '';
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--model' && args[i + 1]) {
            modelArg = args[++i];
        } else if (args[i] === '--auth-token' && args[i + 1]) {
            authTokenArg = args[++i];
        }
    }

    if (providerName !== 'anthropic' && providerName !== 'openai') {
        p.log.error('Usage: provider {anthropic|openai} [--model MODEL] [--auth-token TOKEN]');
        process.exit(1);
    }

    const oldProvider = settings.models?.provider || 'anthropic';

    if (!settings.models) settings.models = { provider: providerName };
    settings.models.provider = providerName;

    if (modelArg) {
        if (!settings.models[providerName]) settings.models[providerName] = {};
        (settings.models as any)[providerName].model = modelArg;

        // Propagate to agents matching old provider
        const agents = settings.agents || {};
        let updatedCount = 0;
        for (const [, agent] of Object.entries(agents)) {
            if (agent.provider === oldProvider) {
                agent.provider = providerName;
                agent.model = modelArg;
                updatedCount++;
            }
        }

        p.log.success(`Switched to ${providerName === 'anthropic' ? 'Anthropic' : 'OpenAI/Codex'} provider with model: ${modelArg}`);
        if (updatedCount > 0) {
            p.log.message(`  Updated ${updatedCount} agent(s) from ${oldProvider} to ${providerName}/${modelArg}`);
        }
    } else {
        p.log.success(`Switched to ${providerName === 'anthropic' ? 'Anthropic' : 'OpenAI/Codex'} provider`);
        if (providerName === 'openai') {
            p.log.message("Use 'tinyagi model {gpt-5.3-codex|gpt-5.2}' to set the model.");
            p.log.message("Note: Make sure you have the 'codex' CLI installed.");
        } else {
            p.log.message("Use 'tinyagi model {sonnet|opus}' to set the model.");
        }
    }

    if (authTokenArg) {
        if (!settings.models[providerName]) settings.models[providerName] = {};
        (settings.models as any)[providerName].auth_token = authTokenArg;
        p.log.success(`${providerName === 'anthropic' ? 'Anthropic' : 'OpenAI'} auth token saved`);
    }

    writeSettings(settings);
}

// --- model show ---

function modelShow() {
    const settings = requireSettings();
    const provider = settings.models?.provider || 'anthropic';
    const modelSection = provider === 'openai' ? settings.models?.openai : settings.models?.anthropic;
    const model = modelSection?.model || '';

    if (model) {
        p.log.info(`Global default: ${provider}/${model}`);
    } else {
        p.log.error('No model configured');
        process.exit(1);
    }

    const agents = settings.agents || {};
    const agentIds = Object.keys(agents);
    if (agentIds.length > 0) {
        p.log.message('');
        p.log.message('Per-agent models:');
        for (const id of agentIds) {
            p.log.message(`  @${id}: ${agents[id].provider}/${agents[id].model}`);
        }
    }
}

// --- model set ---

function modelSet(modelName: string) {
    const settings = requireSettings();

    // Determine provider from model name
    const anthropicModels = ['sonnet', 'opus'];
    const openaiModels = ['gpt-5.2', 'gpt-5.3-codex'];

    let targetProvider: string;
    if (anthropicModels.includes(modelName)) {
        targetProvider = 'anthropic';
    } else if (openaiModels.includes(modelName)) {
        targetProvider = 'openai';
    } else {
        p.log.error('Usage: model {sonnet|opus|gpt-5.2|gpt-5.3-codex}');
        p.log.message('');
        p.log.message('Anthropic models: sonnet, opus');
        p.log.message('OpenAI models: gpt-5.2, gpt-5.3-codex');
        process.exit(1);
    }

    if (!settings.models) settings.models = { provider: targetProvider };
    const models = settings.models as Record<string, any>;
    if (!models[targetProvider]) models[targetProvider] = {};
    models[targetProvider].model = modelName;

    // Propagate to agents matching the provider
    const agents = settings.agents || {};
    let updatedCount = 0;
    for (const [, agent] of Object.entries(agents)) {
        if (agent.provider === targetProvider) {
            agent.model = modelName;
            updatedCount++;
        }
    }

    writeSettings(settings);

    p.log.success(`Model switched to: ${modelName}`);
    if (updatedCount > 0) {
        p.log.message(`  Updated ${updatedCount} ${targetProvider} agent(s)`);
    }
    p.log.message('');
    p.log.message('Note: Changes take effect on next message.');
}

// --- CLI dispatch ---

const command = process.argv[2];
const args = process.argv.slice(3);

switch (command) {
    case 'show':
    case undefined:
        providerShow();
        break;
    case 'anthropic':
    case 'openai':
        providerSet(command, args);
        break;
    case 'model':
        if (!args[0]) {
            modelShow();
        } else {
            modelSet(args[0]);
        }
        break;
    default:
        p.log.error(`Unknown provider command: ${command}`);
        p.log.message('Usage: provider {show|anthropic|openai} [--model MODEL] [--auth-token TOKEN]');
        p.log.message('       provider model [name]');
        process.exit(1);
}
