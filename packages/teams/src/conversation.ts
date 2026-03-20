import {
    MessageJobData, AgentConfig, TeamConfig,
    log, emitEvent,
    findTeamForAgent, insertChatMessage,
    enqueueMessage, streamResponse, genId,
} from '@tinyagi/core';
import { convertTagsToReadable, extractTeammateMentions, extractChatRoomMessages } from './routing';

// ── Team Chat Room ───────────────────────────────────────────────────────────

export function postToChatRoom(
    teamId: string,
    fromAgent: string,
    message: string,
    teamAgents: string[],
    originalData: { channel: string; sender: string; senderId?: string | null; messageId: string }
): number {
    const chatMsg = `[Chat room #${teamId} — @${fromAgent}]:\n${message}`;
    const id = insertChatMessage(teamId, fromAgent, message);
    for (const agentId of teamAgents) {
        if (agentId === fromAgent) continue;
        enqueueMessage({
            channel: 'chatroom',
            sender: originalData.sender,
            senderId: originalData.senderId ?? undefined,
            message: chatMsg,
            messageId: genId('chat'),
            agent: agentId,
            fromAgent,
        });
    }
    return id;
}

// ── Team Orchestration ───────────────────────────────────────────────────────

function resolveTeamContext(
    agentId: string,
    isTeamRouted: boolean,
    teams: Record<string, TeamConfig>
): { teamId: string; team: TeamConfig } | null {
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
 * Handle team orchestration for a response. Stateless — no conversation tracking.
 *
 * 1. Post chat room broadcasts
 * 2. Resolve team context
 * 3. Stream response to user
 * 4. Extract teammate mentions → enqueue as flat DMs
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

    const teamContext = resolveTeamContext(agentId, isTeamRouted, teams);
    if (!teamContext) {
        log('DEBUG', `No team context for agent ${agentId} — falling back to direct response`);
        return false;
    }

    // Stream this agent's response to the user immediately
    await streamResponse(response, {
        channel, sender, senderId: data.senderId ?? undefined,
        messageId, originalMessage: data.message, agentId,
        transform: (text) => convertTagsToReadable(text, agentId),
    });

    // Extract teammate mentions and enqueue as flat DMs
    const teammateMentions = extractTeammateMentions(response, agentId, teamContext.teamId, teams, agents);
    if (teammateMentions.length > 0) {
        log('INFO', `@${agentId} → ${teammateMentions.map(m => `@${m.teammateId}`).join(', ')}`);
        for (const mention of teammateMentions) {
            emitEvent('agent:mention', { teamId: teamContext.teamId, fromAgent: agentId, toAgent: mention.teammateId });

            const internalMsg = `[Message from teammate @${agentId}]:\n${mention.message}`;
            enqueueMessage({
                channel,
                sender,
                senderId: data.senderId ?? undefined,
                message: internalMsg,
                messageId: genId('internal'),
                agent: mention.teammateId,
                fromAgent: agentId,
            });
        }
    }

    return true;
}
