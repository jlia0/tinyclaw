#!/usr/bin/env node
/**
 * TinyClaw Queue Processor — Entry point.
 *
 * Initializes the SQLite queue, starts the API server, processes messages,
 * and manages lifecycle. This is the only file that should be run directly.
 */

import fs from 'fs';
import path from 'path';
import {
    MessageJobData,
    getSettings, getAgents, getTeams, LOG_FILE, CHATS_DIR, FILES_DIR,
    log, emitEvent,
    parseAgentRouting, getAgentResetFlag,
    invokeAgent,
    loadPlugins, runIncomingHooks,
    streamResponse,
    initQueueDb, getPendingAgents, claimAllPendingMessages,
    completeMessage, failMessage,
    recoverStaleMessages, pruneAckedResponses, pruneCompletedMessages,
    closeQueueDb, queueEvents,
} from '@tinyclaw/core';
import { startApiServer } from '@tinyclaw/server';
import {
    conversations,
    handleTeamResponse,
    groupChatroomMessages,
} from '@tinyclaw/teams';

// Ensure directories exist
[FILES_DIR, path.dirname(LOG_FILE), CHATS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// ── Message Processing ──────────────────────────────────────────────────────

async function processMessage(dbMsg: any): Promise<void> {
    const data: MessageJobData = {
        channel: dbMsg.channel,
        sender: dbMsg.sender,
        senderId: dbMsg.sender_id,
        message: dbMsg.message,
        messageId: dbMsg.message_id,
        agent: dbMsg.agent ?? undefined,
        files: dbMsg.files ? JSON.parse(dbMsg.files) : undefined,
        conversationId: dbMsg.conversation_id ?? undefined,
        fromAgent: dbMsg.from_agent ?? undefined,
    };

    const { channel, sender, message: rawMessage, messageId, agent: preRoutedAgent } = data;
    const isInternal = !!data.conversationId;

    log('INFO', `Processing [${isInternal ? 'internal' : channel}] ${isInternal ? `@${data.fromAgent}→@${preRoutedAgent}` : `from ${sender}`}: ${rawMessage.substring(0, 50)}...`);
    if (!isInternal) {
        emitEvent('message_received', { channel, sender, message: rawMessage.substring(0, 120), messageId });
    }

    const settings = getSettings();
    const agents = getAgents(settings);
    const teams = getTeams(settings);
    const workspacePath = settings?.workspace?.path || path.join(require('os').homedir(), 'tinyclaw-workspace');

    // ── Route message to agent ──────────────────────────────────────────────
    let agentId: string;
    let message: string;
    let isTeamRouted = false;

    if (preRoutedAgent && agents[preRoutedAgent]) {
        agentId = preRoutedAgent;
        message = rawMessage;
    } else {
        const routing = parseAgentRouting(rawMessage, agents, teams);
        agentId = routing.agentId;
        message = routing.message;
        isTeamRouted = !!routing.isTeam;
    }

    if (!agents[agentId]) {
        agentId = 'default';
        message = rawMessage;
    }
    if (!agents[agentId]) {
        agentId = Object.keys(agents)[0];
    }

    const agent = agents[agentId];
    log('INFO', `Routing to agent: ${agent.name} (${agentId}) [${agent.provider}/${agent.model}]`);
    if (!isInternal) {
        emitEvent('agent_routed', { agentId, agentName: agent.name, provider: agent.provider, model: agent.model, isTeamRouted });
    }

    // ── Invoke agent ────────────────────────────────────────────────────────
    const agentResetFlag = getAgentResetFlag(agentId, workspacePath);
    const shouldReset = fs.existsSync(agentResetFlag);
    if (shouldReset) {
        fs.unlinkSync(agentResetFlag);
    }

    ({ text: message } = await runIncomingHooks(message, { channel, sender, messageId, originalMessage: rawMessage }));

    emitEvent('chain_step_start', { agentId, agentName: agent.name, fromAgent: data.fromAgent || null });
    let response: string;
    try {
        response = await invokeAgent(agent, agentId, message, workspacePath, shouldReset, agents, teams);
    } catch (error) {
        const provider = agent.provider || 'anthropic';
        const providerLabel = provider === 'openai' ? 'Codex' : provider === 'opencode' ? 'OpenCode' : 'Claude';
        log('ERROR', `${providerLabel} error (agent: ${agentId}): ${(error as Error).message}`);
        response = "Sorry, I encountered an error processing your request. Please check the queue logs.";
    }
    emitEvent('chain_step_done', { agentId, agentName: agent.name, responseLength: response.length, responseText: response });

    // ── Response routing ────────────────────────────────────────────────────
    // Always try team orchestration first — handles team-routed, internal,
    // AND direct messages to agents that belong to a team.

    const handled = await handleTeamResponse({
        agentId, response, isTeamRouted, data, agents, teams,
    });
    if (!handled) {
        await sendDirectResponse(response, {
            channel, sender, senderId: data.senderId,
            messageId, originalMessage: rawMessage, agentId,
        });
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function sendDirectResponse(
    response: string,
    ctx: { channel: string; sender: string; senderId?: string | null; messageId: string; originalMessage: string; agentId: string }
): Promise<void> {
    await streamResponse(response, {
        channel: ctx.channel,
        sender: ctx.sender,
        senderId: ctx.senderId ?? undefined,
        messageId: ctx.messageId,
        originalMessage: ctx.originalMessage,
        agentId: ctx.agentId,
    });
}

// ── Queue Processing ────────────────────────────────────────────────────────

const agentChains = new Map<string, Promise<void>>();

async function processQueue(): Promise<void> {
    const pendingAgents = getPendingAgents();
    if (pendingAgents.length === 0) return;

    for (const agentId of pendingAgents) {
        const messages = claimAllPendingMessages(agentId);
        if (messages.length === 0) continue;

        const currentChain = agentChains.get(agentId) || Promise.resolve();
        const newChain = currentChain.then(async () => {
            const { messages: groupedMessages, messageIds } = groupChatroomMessages(messages);
            for (let i = 0; i < groupedMessages.length; i++) {
                const msg = groupedMessages[i];
                const ids = messageIds[i];
                try {
                    await processMessage(msg);
                    for (const id of ids) {
                        completeMessage(id);
                    }
                } catch (error) {
                    log('ERROR', `Failed to process message ${msg.id}: ${(error as Error).message}`);
                    for (const id of ids) {
                        failMessage(id, (error as Error).message);
                    }
                }
            }
        });
        agentChains.set(agentId, newChain);
        newChain.finally(() => {
            if (agentChains.get(agentId) === newChain) {
                agentChains.delete(agentId);
            }
        });
    }
}

function logAgentConfig(): void {
    const settings = getSettings();
    const agents = getAgents(settings);
    const teams = getTeams(settings);

    const agentCount = Object.keys(agents).length;
    log('INFO', `Loaded ${agentCount} agent(s):`);
    for (const [id, agent] of Object.entries(agents)) {
        log('INFO', `  ${id}: ${agent.name} [${agent.provider}/${agent.model}] cwd=${agent.working_directory}`);
    }

    const teamCount = Object.keys(teams).length;
    if (teamCount > 0) {
        log('INFO', `Loaded ${teamCount} team(s):`);
        for (const [id, team] of Object.entries(teams)) {
            log('INFO', `  ${id}: ${team.name} [agents: ${team.agents.join(', ')}] leader=${team.leader_agent}`);
        }
    }
}

// ─── Start ──────────────────────────────────────────────────────────────────

initQueueDb();

const apiServer = startApiServer(conversations);

// Event-driven: process queue when a new message arrives
queueEvents.on('message:enqueued', () => processQueue());

// Also poll periodically in case events are missed
const pollInterval = setInterval(() => processQueue(), 5000);

// Periodic maintenance
const maintenanceInterval = setInterval(() => {
    const recovered = recoverStaleMessages();
    if (recovered > 0) log('INFO', `Recovered ${recovered} stale message(s)`);
    pruneAckedResponses();
    pruneCompletedMessages();
}, 60 * 1000);

// Load plugins
(async () => {
    await loadPlugins();
})();

log('INFO', 'Queue processor started (SQLite)');
logAgentConfig();
emitEvent('processor_start', { agents: Object.keys(getAgents(getSettings())), teams: Object.keys(getTeams(getSettings())) });

// Graceful shutdown
function shutdown(): void {
    log('INFO', 'Shutting down queue processor...');
    clearInterval(pollInterval);
    clearInterval(maintenanceInterval);
    apiServer.close();
    closeQueueDb();
    process.exit(0);
}

process.on('SIGINT', () => { shutdown(); });
process.on('SIGTERM', () => { shutdown(); });
