#!/usr/bin/env node
import * as p from '@clack/prompts';
import fs from 'fs';
import { Settings, updateAgentTeammates } from '@tinyclaw/core';
import {
    unwrap, cleanId, validateId,
    writeSettings, requireSettings,
} from './shared';

function refreshTeamInfo(settings: Settings) {
    const agents = settings.agents || {};
    const teams = settings.teams || {};
    for (const [agentId, agent] of Object.entries(agents)) {
        if (agent.working_directory && fs.existsSync(agent.working_directory)) {
            updateAgentTeammates(agent.working_directory, agentId, agents, teams);
        }
    }
}

// --- team add ---

async function teamAdd() {
    const settings = requireSettings();
    const agents = settings.agents || {};
    const agentIds = Object.keys(agents);

    if (agentIds.length < 2) {
        p.log.error('You need at least 2 agents to create a team. Add agents with: tinyclaw agent add');
        process.exit(1);
    }

    p.intro('Add New Team');

    const teamId = cleanId(unwrap(await p.text({
        message: "Team ID (lowercase, no spaces, e.g. 'dev')",
        validate(value) {
            const err = validateId(value);
            if (err) return err;
            const id = cleanId(value || '');
            if (settings.teams?.[id]) return `Team '${id}' already exists.`;
            if (settings.agents?.[id]) return `'${id}' is already used as an agent ID.`;
        },
    })));

    const teamName = unwrap(await p.text({
        message: "Display name (e.g. 'Development Team')",
        placeholder: teamId,
        defaultValue: teamId,
    }));

    const selectedAgents = unwrap(await p.multiselect({
        message: 'Select agents for this team',
        options: agentIds.map(id => ({
            value: id,
            label: `@${id} - ${agents[id].name}`,
        })),
        required: true,
    }));

    if (selectedAgents.length < 2) {
        p.log.error('A team requires at least 2 agents.');
        process.exit(1);
    }

    const leader = unwrap(await p.select({
        message: 'Leader agent (receives messages first)',
        options: selectedAgents.map(id => ({
            value: id,
            label: `@${id} - ${agents[id].name}`,
        })),
    })) as string;

    if (!settings.teams) settings.teams = {};
    settings.teams[teamId] = {
        name: teamName || teamId,
        agents: selectedAgents,
        leader_agent: leader,
    };
    writeSettings(settings);

    refreshTeamInfo(settings);

    p.log.success(`Team '${teamId}' created!`);
    p.log.info(`Agents: ${selectedAgents.join(', ')}`);
    p.log.info(`Leader: @${leader}`);
    p.outro(`Send '@${teamId} <message>' in any channel to use this team.`);
}

// --- team remove ---

async function teamRemove(teamId: string) {
    const settings = requireSettings();
    const team = settings.teams?.[teamId];

    if (!team) {
        p.log.error(`Team '${teamId}' not found.`);
        process.exit(1);
    }

    const confirm = unwrap(await p.confirm({
        message: `Remove team '${teamId}' (${team.name})?`,
        initialValue: false,
    }));
    if (!confirm) {
        p.log.message('Cancelled.');
        return;
    }

    delete settings.teams![teamId];
    writeSettings(settings);

    refreshTeamInfo(settings);
    p.log.success(`Team '${teamId}' removed.`);
}

// --- team remove-agent ---

async function teamRemoveAgent(teamId: string, agentId: string) {
    const settings = requireSettings();
    const team = settings.teams?.[teamId];

    if (!team) {
        p.log.error(`Team '${teamId}' not found.`);
        process.exit(1);
    }

    if (!team.agents.includes(agentId)) {
        p.log.warn(`Agent '${agentId}' is not in team '${teamId}'.`);
        return;
    }

    const remaining = team.agents.filter(a => a !== agentId);
    if (remaining.length < 1) {
        p.log.error(`Cannot remove the last agent. Use 'team remove ${teamId}' to remove the whole team.`);
        process.exit(1);
    }

    let newLeader = team.leader_agent;
    if (team.leader_agent === agentId) {
        p.log.warn(`@${agentId} is the current leader.`);
        const agents = settings.agents || {};
        newLeader = unwrap(await p.select({
            message: 'Choose a new leader',
            options: remaining.map(id => ({
                value: id,
                label: `@${id} - ${agents[id]?.name || id}`,
            })),
        })) as string;
    }

    const confirm = unwrap(await p.confirm({
        message: `Remove @${agentId} from team '${teamId}'?`,
        initialValue: false,
    }));
    if (!confirm) {
        p.log.message('Cancelled.');
        return;
    }

    team.agents = remaining;
    team.leader_agent = newLeader;
    writeSettings(settings);

    refreshTeamInfo(settings);

    p.log.success(`Removed @${agentId} from team '${teamId}'.${newLeader !== team.leader_agent ? ` New leader: @${newLeader}.` : ''}`);
}

// --- CLI dispatch ---

const command = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];

async function run() {
    switch (command) {
        case 'add':
            await teamAdd();
            break;
        case 'remove':
        case 'rm':
            if (!arg1) {
                p.log.error('Usage: team remove <team_id>');
                process.exit(1);
            }
            await teamRemove(arg1);
            break;
        case 'remove-agent':
            if (!arg1 || !arg2) {
                p.log.error('Usage: team remove-agent <team_id> <agent_id>');
                process.exit(1);
            }
            await teamRemoveAgent(arg1, arg2);
            break;
        default:
            p.log.error(`Unknown team CLI command: ${command}`);
            process.exit(1);
    }
}

run().catch(err => {
    p.log.error(err.message);
    process.exit(1);
});
