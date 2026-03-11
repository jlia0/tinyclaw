import fs from 'fs';
import path from 'path';
import {
    Conversation, MessageJobData, AgentConfig, TeamConfig,
    CHATS_DIR, getSettings, getAgents,
    log, emitEvent,
    collectFiles, findTeamForAgent,
    enqueueMessage, streamResponse,
} from '@tinyclaw/core';
import { convertTagsToReadable, extractTeammateMentions, extractChatRoomMessages } from './routing';

// Active conversations — tracks in-flight team message passing
export const conversations = new Map<string, Conversation>();

export const MAX_CONVERSATION_MESSAGES = 50;

// Per-conversation locks to prevent race conditions
const conversationLocks = new Map<string, Promise<void>>();

export async function withConversationLock<T>(
    convId: string,
    fn: () => Promise<T>
): Promise<T> {
    const currentLock = conversationLocks.get(convId) || Promise.resolve();

    let resolveLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
        resolveLock = resolve;
    });

    const newLock = currentLock.then(async () => {
        try {
            return await fn();
        } finally {
            resolveLock();
        }
    });

    conversationLocks.set(convId, lockPromise);

    newLock.finally(() => {
        if (conversationLocks.get(convId) === lockPromise) {
            conversationLocks.delete(convId);
        }
    });

    return newLock;
}

export function incrementPending(conv: Conversation, count: number): void {
    conv.pending += count;
    log('DEBUG', `Conversation ${conv.id}: pending incremented to ${conv.pending} (+${count})`);
}

export function decrementPending(conv: Conversation): boolean {
    conv.pending--;
    log('DEBUG', `Conversation ${conv.id}: pending decremented to ${conv.pending}`);

    if (conv.pending < 0) {
        log('WARN', `Conversation ${conv.id}: pending went negative (${conv.pending}), resetting to 0`);
        conv.pending = 0;
    }

    return conv.pending === 0;
}

export function enqueueInternalMessage(
    conversationId: string,
    fromAgent: string,
    targetAgent: string,
    message: string,
    originalData: { channel: string; sender: string; senderId?: string | null; messageId: string }
): void {
    const messageId = `internal_${conversationId}_${targetAgent}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    enqueueMessage({
        channel: originalData.channel,
        sender: originalData.sender,
        senderId: originalData.senderId ?? undefined,
        message,
        messageId,
        agent: targetAgent,
        conversationId,
        fromAgent,
    });
    log('INFO', `Enqueued internal message: @${fromAgent} → @${targetAgent}`);
}

// ── Team Chat Room ───────────────────────────────────────────────────────────

export function postToChatRoom(
    teamId: string,
    fromAgent: string,
    message: string,
    teamAgents: string[],
    originalData: { channel: string; sender: string; senderId?: string | null; messageId: string }
): void {
    const chatMsg = `[Chat room #${teamId} — @${fromAgent}]:\n${message}`;
    // Enqueue for every teammate (except the sender)
    for (const agentId of teamAgents) {
        if (agentId === fromAgent) continue;
        const msgId = `chat_${teamId}_${fromAgent}_${agentId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        enqueueMessage({
            channel: originalData.channel,
            sender: originalData.sender,
            senderId: originalData.senderId ?? undefined,
            message: chatMsg,
            messageId: msgId,
            agent: agentId,
            fromAgent,
        });
    }
    log('DEBUG', `Chat room message: @${fromAgent} → #${teamId} (${teamAgents.length - 1} teammate(s))`);
}

/**
 * Complete a conversation: aggregate responses, write to outgoing queue, save chat history.
 */
export async function completeConversation(conv: Conversation): Promise<void> {
    const settings = getSettings();
    const agents = getAgents(settings);

    log('INFO', `Conversation ${conv.id} complete — ${conv.responses.length} response(s), ${conv.totalMessages} total message(s)`);
    emitEvent('team_chain_end', {
        teamId: conv.teamContext.teamId,
        totalSteps: conv.responses.length,
        agents: conv.responses.map(s => s.agentId),
    });

    // Save chat history
    try {
        const teamChatsDir = path.join(CHATS_DIR, conv.teamContext.teamId);
        if (!fs.existsSync(teamChatsDir)) {
            fs.mkdirSync(teamChatsDir, { recursive: true });
        }
        const chatLines: string[] = [];
        chatLines.push(`# Team Conversation: ${conv.teamContext.team.name} (@${conv.teamContext.teamId})`);
        chatLines.push(`**Date:** ${new Date().toISOString()}`);
        chatLines.push(`**Channel:** ${conv.channel} | **Sender:** ${conv.sender}`);
        chatLines.push(`**Messages:** ${conv.totalMessages}`);
        chatLines.push('');
        chatLines.push('------');
        chatLines.push('');
        chatLines.push(`## User Message`);
        chatLines.push('');
        chatLines.push(conv.originalMessage);
        chatLines.push('');
        for (let i = 0; i < conv.responses.length; i++) {
            const step = conv.responses[i];
            const stepAgent = agents[step.agentId];
            const stepLabel = stepAgent ? `${stepAgent.name} (@${step.agentId})` : `@${step.agentId}`;
            chatLines.push('------');
            chatLines.push('');
            chatLines.push(`## ${stepLabel}`);
            chatLines.push('');
            chatLines.push(step.response);
            chatLines.push('');
        }
        const now = new Date();
        const dateTime = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
        fs.writeFileSync(path.join(teamChatsDir, `${dateTime}.md`), chatLines.join('\n'));
        log('INFO', `Chat history saved`);
    } catch (e) {
        log('ERROR', `Failed to save chat history: ${(e as Error).message}`);
    }

    // Clean up
    conversations.delete(conv.id);
}

// ── Team Orchestration ───────────────────────────────────────────────────────

function resolveTeamContext(
    agentId: string,
    isTeamRouted: boolean,
    data: MessageJobData,
    teams: Record<string, TeamConfig>
): { teamId: string; team: TeamConfig } | null {
    // Internal messages inherit team context from their conversation
    if (data.conversationId) {
        const conv = conversations.get(data.conversationId);
        if (conv) return conv.teamContext;
    }
    // Team-routed: prefer the team where this agent is leader
    if (isTeamRouted) {
        for (const [tid, t] of Object.entries(teams)) {
            if (t.leader_agent === agentId && t.agents.includes(agentId)) {
                return { teamId: tid, team: t };
            }
        }
    }
    return findTeamForAgent(agentId, teams);
}

/**
 * Handle team orchestration for a team-routed or internal message response.
 *
 * Returns `true` if team context was found and the response was handled,
 * or `false` if no team context exists (caller should fall back to direct response).
 */
export async function handleTeamResponse(params: {
    agentId: string;
    response: string;
    isTeamRouted: boolean;
    data: MessageJobData;
    agents: Record<string, AgentConfig>;
    teams: Record<string, TeamConfig>;
}): Promise<boolean> {
    const { agentId, response, isTeamRouted, data, agents, teams } = params;
    const { channel, sender, messageId } = data;
    const isInternal = !!data.conversationId;

    // Extract and post [#team_id: message] chat room broadcasts
    const chatRoomMsgs = extractChatRoomMessages(response, agentId, teams);
    if (chatRoomMsgs.length > 0) {
        log('INFO', `Chat room broadcasts from @${agentId}: ${chatRoomMsgs.map(m => `#${m.teamId}`).join(', ')}`);
    }
    for (const crMsg of chatRoomMsgs) {
        postToChatRoom(crMsg.teamId, agentId, crMsg.message, teams[crMsg.teamId].agents, {
            channel, sender, senderId: data.senderId, messageId,
        });
    }

    const teamContext = resolveTeamContext(agentId, isTeamRouted, data, teams);
    if (!teamContext) {
        log('DEBUG', `No team context for agent ${agentId} — falling back to direct response`);
        return false;
    }
    log('INFO', `Team context resolved: ${teamContext.teamId} (${teamContext.team.name}) for agent ${agentId} [isTeamRouted=${isTeamRouted}, isInternal=${isInternal}]`);

    // Get or create conversation
    let conv: Conversation;
    if (isInternal && data.conversationId && conversations.has(data.conversationId)) {
        conv = conversations.get(data.conversationId)!;
    } else {
        const convId = `${messageId}_${Date.now()}`;
        conv = {
            id: convId,
            channel,
            sender,
            originalMessage: data.message,
            messageId,
            pending: 1,
            responses: [],
            files: new Set(),
            totalMessages: 0,
            maxMessages: MAX_CONVERSATION_MESSAGES,
            teamContext,
            startTime: Date.now(),
            outgoingMentions: new Map(),
            pendingAgents: new Set([agentId]),
        };
        conversations.set(convId, conv);
        log('INFO', `Conversation started: ${convId} (team: ${teamContext.team.name})`);
        emitEvent('team_chain_start', { teamId: teamContext.teamId, teamName: teamContext.team.name, agents: teamContext.team.agents, leader: teamContext.team.leader_agent });
    }

    // Record this agent's response
    conv.responses.push({ agentId, response });
    conv.totalMessages++;
    conv.pendingAgents.delete(agentId);
    collectFiles(response, conv.files);

    // Stream this agent's response to the user immediately
    await streamResponse(response, {
        channel, sender, senderId: data.senderId ?? undefined,
        messageId, originalMessage: data.message, agentId,
        transform: (text) => convertTagsToReadable(text, agentId),
    });

    // Check for teammate mentions — forward to teammates if under message limit
    const teammateMentions = extractTeammateMentions(response, agentId, conv.teamContext.teamId, teams, agents);
    log('INFO', `Conversation ${conv.id}: agent=${agentId}, mentions=${teammateMentions.length}, totalMessages=${conv.totalMessages}, pending=${conv.pending}`);
    if (teammateMentions.length > 0) {
        log('INFO', `Teammate mentions from @${agentId}: ${teammateMentions.map(m => `@${m.teammateId}`).join(', ')}`);
    }

    if (teammateMentions.length > 0 && conv.totalMessages < conv.maxMessages) {
        incrementPending(conv, teammateMentions.length);
        conv.outgoingMentions.set(agentId, teammateMentions.length);

        for (const mention of teammateMentions) {
            conv.pendingAgents.add(mention.teammateId);
            log('INFO', `@${agentId} → @${mention.teammateId}`);
            emitEvent('chain_handoff', { teamId: conv.teamContext.teamId, fromAgent: agentId, toAgent: mention.teammateId });

            const internalMsg = `[Message from teammate @${agentId}]:\n${mention.message}`;
            enqueueInternalMessage(conv.id, agentId, mention.teammateId, internalMsg, {
                channel, sender, senderId: data.senderId, messageId,
            });
        }
    } else if (teammateMentions.length > 0) {
        log('WARN', `Conversation ${conv.id} hit max messages (${conv.maxMessages}) — not enqueuing further mentions`);
    }

    // Decrement pending — if all branches resolved, complete the conversation
    await withConversationLock(conv.id, async () => {
        const shouldComplete = decrementPending(conv);
        if (shouldComplete) {
            completeConversation(conv);
        } else {
            log('INFO', `Conversation ${conv.id}: ${conv.pending} branch(es) still pending`);
        }
    });

    return true;
}

// Clean up old conversations periodically (TTL: 30 min)
setInterval(() => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, conv] of conversations.entries()) {
        if (conv.startTime < cutoff) {
            log('WARN', `Conversation ${id} timed out after 30 min — cleaning up`);
            conversations.delete(id);
        }
    }
}, 30 * 60 * 1000);
