#!/usr/bin/env node
import * as p from '@clack/prompts';
import fs from 'fs';
import path from 'path';
import { CustomProvider, ensureAgentDirectory } from '@tinyagi/core';
import {
    unwrap, cleanId, validateId, required,
    writeSettings, requireSettings, SCRIPT_DIR,
    providerOptions, promptModel, harnessOptions, printBanner,
} from './shared.ts';

// --- agent add ---

async function agentAdd() {
    const settings = requireSettings();

    printBanner();
    p.intro('Add New Agent');

    const agentId = cleanId(unwrap(await p.text({
        message: "Agent ID (lowercase, no spaces, e.g. 'coder')",
        validate: validateId,
    })));

    if (settings.agents?.[agentId]) {
        p.log.error(`Agent '${agentId}' already exists. Use 'agent remove ${agentId}' first.`);
        process.exit(1);
    }

    const agentName = unwrap(await p.text({
        message: "Display name (e.g. 'Code Assistant')",
        placeholder: agentId,
        defaultValue: agentId,
    }));

    // Provider — check for custom providers
    const customProviders = settings.custom_providers || {};
    const hasCustom = Object.keys(customProviders).length > 0;

    const providerChoice = unwrap(await p.select({
        message: 'Provider',
        options: providerOptions(hasCustom),
    }));

    let agentProvider = providerChoice as string;
    let agentModel = '';

    if (providerChoice === 'custom') {
        const customIds = Object.keys(customProviders);
        const customChoice = unwrap(await p.select({
            message: 'Select custom provider',
            options: customIds.map(id => ({
                value: id,
                label: `${customProviders[id].name} (${id})`,
                hint: `harness: ${customProviders[id].harness}`,
            })),
        })) as string;
        agentProvider = `custom:${customChoice}`;

        const defaultModel = customProviders[customChoice]?.model || '';
        if (defaultModel) {
            agentModel = unwrap(await p.text({
                message: `Model (from provider: '${defaultModel}', enter to keep)`,
                placeholder: defaultModel,
                defaultValue: defaultModel,
            })) || defaultModel;
        } else {
            agentModel = unwrap(await p.text({
                message: 'Enter model name for this custom provider',
                validate: required,
            }));
        }
    } else {
        agentModel = await promptModel(agentProvider);
    }

    const systemPrompt = unwrap(await p.text({
        message: "System prompt (written to AGENTS.md, optional)",
        placeholder: 'optional',
    })) || '';

    const workspacePath = settings.workspace?.path || path.join(process.env.HOME || '~', 'tinyagi-workspace');
    const agentWorkdir = path.join(workspacePath, agentId);

    if (!settings.agents) settings.agents = {};
    settings.agents[agentId] = {
        name: agentName || agentId,
        provider: agentProvider,
        model: agentModel,
        working_directory: agentWorkdir,
    };
    writeSettings(settings);

    ensureAgentDirectory(agentWorkdir);

    if (systemPrompt) {
        fs.writeFileSync(path.join(agentWorkdir, 'AGENTS.md'), systemPrompt, 'utf8');
    }

    p.log.success(`Agent '${agentId}' created!`);
    p.log.info(`Directory: ${agentWorkdir}`);
    p.outro(`Send '@${agentId} <message>' in any channel to use this agent.`);
}

// --- agent remove ---

async function agentRemove(agentId: string) {
    const settings = requireSettings();

    const agent = settings.agents?.[agentId];
    if (!agent) {
        p.log.error(`Agent '${agentId}' not found.`);
        process.exit(1);
    }

    const teams = settings.teams || {};
    const memberTeams = Object.entries(teams)
        .filter(([, t]) => t.agents.includes(agentId))
        .map(([tid, t]) => ({ id: tid, name: t.name }));

    if (memberTeams.length > 0) {
        p.log.warn(`Agent '${agentId}' is in ${memberTeams.length} team(s):`);
        for (const t of memberTeams) {
            p.log.message(`  @${t.id} - ${t.name}`);
        }
        p.log.message('Continuing will remove this agent from those teams.');
    }

    const confirm = unwrap(await p.confirm({
        message: `Remove agent '${agentId}' (${agent.name})?`,
        initialValue: false,
    }));
    if (!confirm) {
        p.log.message('Cancelled.');
        return;
    }

    delete settings.agents![agentId];

    for (const [tid, team] of Object.entries(teams)) {
        if (!team.agents.includes(agentId)) continue;
        const remaining = team.agents.filter(a => a !== agentId);
        if (remaining.length === 0) {
            delete settings.teams![tid];
            p.log.info(`Removed empty team '${tid}'.`);
        } else {
            team.agents = remaining;
            if (team.leader_agent === agentId) {
                team.leader_agent = remaining[0];
                p.log.info(`Team '${tid}' leader reassigned to @${remaining[0]}.`);
            }
        }
    }

    writeSettings(settings);

    const workspacePath = settings.workspace?.path || '';
    const agentDir = path.join(workspacePath, agentId);
    if (fs.existsSync(agentDir)) {
        fs.rmSync(agentDir, { recursive: true, force: true });
    }

    p.log.success(`Agent '${agentId}' removed.`);
}

// --- custom provider add ---

async function customProviderAdd() {
    const settings = requireSettings();

    printBanner();
    p.intro('Add Custom Provider');

    const providerId = cleanId(unwrap(await p.text({
        message: "Provider ID (lowercase, no spaces, e.g. 'my-proxy')",
        validate: validateId,
    })));

    if (settings.custom_providers?.[providerId]) {
        p.log.error(`Custom provider '${providerId}' already exists. Use 'provider remove ${providerId}' first.`);
        process.exit(1);
    }

    const providerName = unwrap(await p.text({
        message: "Display name (e.g. 'My OpenRouter Proxy')",
        placeholder: providerId,
        defaultValue: providerId,
    }));

    const harness = unwrap(await p.select({
        message: 'Harness (which CLI to use)',
        options: harnessOptions(),
    })) as 'claude' | 'codex';

    const baseUrl = unwrap(await p.text({
        message: "Base URL (e.g. 'https://proxy.example.com/v1')",
        validate: required,
    }));

    const apiKey = unwrap(await p.password({
        message: 'API Key',
        validate: required,
    }));

    const modelName = unwrap(await p.text({
        message: "Default model name (e.g. 'claude-sonnet-4-6', optional)",
        placeholder: 'optional',
    }));

    if (!settings.custom_providers) settings.custom_providers = {};
    const provider: CustomProvider = {
        name: providerName || providerId,
        harness,
        base_url: baseUrl,
        api_key: apiKey,
    };
    if (modelName) provider.model = modelName;
    settings.custom_providers[providerId] = provider;
    writeSettings(settings);

    p.log.success(`Custom provider '${providerId}' created!`);
    p.outro(`Assign to an agent: tinyagi agent provider <agent_id> custom:${providerId}`);
}

// --- custom provider remove ---

async function customProviderRemove(providerId: string) {
    const settings = requireSettings();

    const provider = settings.custom_providers?.[providerId];
    if (!provider) {
        p.log.error(`Custom provider '${providerId}' not found.`);
        process.exit(1);
    }

    const usingAgents = Object.entries(settings.agents || {})
        .filter(([, a]) => a.provider === `custom:${providerId}`)
        .map(([id]) => id);

    if (usingAgents.length > 0) {
        p.log.warn('The following agents use this custom provider:');
        for (const id of usingAgents) {
            p.log.message(`  @${id}`);
        }
        p.log.message('These agents will fail until their provider is changed.');
    }

    const confirm = unwrap(await p.confirm({
        message: `Remove custom provider '${providerId}' (${provider.name})?`,
        initialValue: false,
    }));
    if (!confirm) {
        p.log.message('Cancelled.');
        return;
    }

    delete settings.custom_providers![providerId];
    writeSettings(settings);
    p.log.success(`Custom provider '${providerId}' removed.`);
}

// --- agent list ---

function agentList() {
    const settings = requireSettings();
    const agents = settings.agents || {};
    const ids = Object.keys(agents);

    if (ids.length === 0) {
        p.log.warn('No agents configured.');
        p.log.message('Using default single-agent mode (from models section).');
        p.log.message('Add an agent with: tinyagi agent add');
        return;
    }

    p.log.info('Configured Agents');
    for (const id of ids) {
        const a = agents[id];
        p.log.message(`  @${id} - ${a.name}`);
        p.log.message(`    Provider:  ${a.provider}/${a.model}`);
        p.log.message(`    Directory: ${a.working_directory}`);
        p.log.message('');
    }
    p.log.message("Usage: Send '@agent_id <message>' in any channel to route to a specific agent.");
}

// --- agent show ---

function agentShow(agentId: string) {
    const settings = requireSettings();
    const agent = settings.agents?.[agentId];

    if (!agent) {
        p.log.error(`Agent '${agentId}' not found.`);
        const ids = Object.keys(settings.agents || {});
        if (ids.length > 0) {
            p.log.message('Available agents:');
            for (const id of ids) p.log.message(`  @${id}`);
        }
        process.exit(1);
    }

    p.log.info(`Agent: @${agentId}`);
    console.log(JSON.stringify(agent, null, 2));
}

// --- agent provider (show/set) ---

function agentProvider(agentId: string, providerArg?: string, flag?: string, modelArg?: string) {
    const settings = requireSettings();
    const agent = settings.agents?.[agentId];

    if (!agent) {
        p.log.error(`Agent '${agentId}' not found.`);
        const ids = Object.keys(settings.agents || {});
        if (ids.length > 0) {
            p.log.message('Available agents:');
            for (const id of ids) p.log.message(`  @${id}`);
        }
        process.exit(1);
    }

    // Show current provider if no args
    if (!providerArg) {
        p.log.info(`Agent: @${agentId} (${agent.name})`);
        p.log.message(`Provider: ${agent.provider}`);
        if (agent.model) p.log.message(`Model:    ${agent.model}`);
        return;
    }

    const model = (flag === '--model' && modelArg) ? modelArg : undefined;

    switch (providerArg) {
        case 'anthropic':
        case 'openai':
        case 'opencode':
        case 'novita':
            agent.provider = providerArg;
            if (model) agent.model = model;
            break;
        default:
            if (providerArg.startsWith('custom:')) {
                agent.provider = providerArg;
                if (model) agent.model = model;
            } else {
                p.log.error('Usage: tinyagi agent provider <agent_id> {anthropic|openai|opencode|novita|custom:<id>} [--model MODEL]');
                process.exit(1);
            }
    }

    writeSettings(settings);
    p.log.success(`Agent '${agentId}' switched to ${agent.provider}${model ? ` with model: ${model}` : ''}`);
    p.log.message('Note: Changes take effect on next message. Restart is not required.');
}

// --- agent reset ---

function agentReset(agentIds: string[]) {
    const settings = requireSettings();
    const workspacePath = settings.workspace?.path || '';
    let resetCount = 0;

    for (const agentId of agentIds) {
        const agent = settings.agents?.[agentId];
        if (!agent) {
            p.log.error(`Agent '${agentId}' not found.`);
            const ids = Object.keys(settings.agents || {});
            if (ids.length > 0) {
                p.log.message('Available agents:');
                for (const id of ids) p.log.message(`  @${id}`);
            }
            continue;
        }

        const agentDir = path.join(workspacePath, agentId);
        fs.mkdirSync(agentDir, { recursive: true });
        fs.writeFileSync(path.join(agentDir, 'reset_flag'), '');
        p.log.success(`Reset flag set for agent '${agentId}' (${agent.name})`);
        p.log.message(`  The next message to @${agentId} will start a fresh conversation.`);
        resetCount++;
    }

    if (resetCount > 0) {
        p.log.message(`\nReset ${resetCount} agent(s).`);
    }
}

// --- custom provider list ---

function customProviderList() {
    const settings = requireSettings();
    const providers = settings.custom_providers || {};
    const ids = Object.keys(providers);

    if (ids.length === 0) {
        p.log.warn('No custom providers configured.');
        p.log.message('Add one with: tinyagi provider add');
        return;
    }

    p.log.info('Custom Providers');
    for (const id of ids) {
        const prov = providers[id];
        p.log.message(`  ${id} - ${prov.name}`);
        p.log.message(`    Harness:  ${prov.harness}`);
        p.log.message(`    Base URL: ${prov.base_url}`);
        p.log.message(`    Model:    ${prov.model || 'default'}`);
        p.log.message('');
    }
    p.log.message('Usage: Set an agent to use a custom provider with:');
    p.log.message('  tinyagi agent provider <agent_id> custom:<provider_id>');
}

// --- CLI dispatch ---

const command = process.argv[2];
const arg = process.argv[3];

async function run() {
    switch (command) {
        case 'add':
            await agentAdd();
            break;
        case 'remove':
        case 'rm':
            if (!arg) {
                p.log.error('Usage: agent remove <agent_id>');
                process.exit(1);
            }
            await agentRemove(arg);
            break;
        case 'list':
        case 'ls':
            agentList();
            break;
        case 'show':
            if (!arg) {
                p.log.error('Usage: agent show <agent_id>');
                process.exit(1);
            }
            agentShow(arg);
            break;
        case 'provider':
            if (!arg) {
                p.log.error('Usage: agent provider <agent_id> [provider] [--model MODEL]');
                process.exit(1);
            }
            agentProvider(arg, process.argv[4], process.argv[5], process.argv[6]);
            break;
        case 'reset':
            if (!arg) {
                p.log.error('Usage: agent reset <agent_id> [agent_id2 ...]');
                process.exit(1);
            }
            agentReset(process.argv.slice(3));
            break;
        case 'provider-add':
            await customProviderAdd();
            break;
        case 'provider-remove':
        case 'provider-rm':
            if (!arg) {
                p.log.error('Usage: provider remove <provider_id>');
                process.exit(1);
            }
            await customProviderRemove(arg);
            break;
        case 'provider-list':
        case 'provider-ls':
            customProviderList();
            break;
        default:
            p.log.error(`Unknown agent CLI command: ${command}`);
            process.exit(1);
    }
}

run().catch(err => {
    p.log.error(err.message);
    process.exit(1);
});
