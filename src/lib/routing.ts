import path from 'path';
import { AgentConfig, TeamConfig } from './types';
import { log } from './logging';

/**
 * Find the first team that contains the given agent.
 */
export function findTeamForAgent(agentId: string, teams: Record<string, TeamConfig>): { teamId: string; team: TeamConfig } | null {
    for (const [teamId, team] of Object.entries(teams)) {
        if (team.agents.includes(agentId)) {
            return { teamId, team };
        }
    }
    return null;
}

/**
 * Check if a mentioned ID is a valid teammate of the current agent in the given team.
 */
export function isTeammate(
    mentionedId: string,
    currentAgentId: string,
    teamId: string,
    teams: Record<string, TeamConfig>,
    agents: Record<string, AgentConfig>
): boolean {
    const team = teams[teamId];
    if (!team) {
        log('WARN', `isTeammate check failed: Team '${teamId}' not found`);
        return false;
    }

    if (mentionedId === currentAgentId) {
        log('DEBUG', `isTeammate check failed: Self-mention (agent: ${mentionedId})`);
        return false;
    }

    if (!team.agents.includes(mentionedId)) {
        log('WARN', `isTeammate check failed: Agent '${mentionedId}' not in team '${teamId}' (members: ${team.agents.join(', ')})`);
        return false;
    }

    if (!agents[mentionedId]) {
        log('WARN', `isTeammate check failed: Agent '${mentionedId}' not found in agents config`);
        return false;
    }

    return true;
}

/**
 * Extract the first valid @teammate mention from a response text.
 * Returns the teammate agent ID and the rest of the message, or null if no teammate mentioned.
 */
export function extractTeammateMentions(
    response: string,
    currentAgentId: string,
    teamId: string,
    teams: Record<string, TeamConfig>,
    agents: Record<string, AgentConfig>
): { teammateId: string; message: string }[] {
    const results: { teammateId: string; message: string }[] = [];
    const seen = new Set<string>();

    // Tag format: [@agent_id: message] or [@agent1,agent2: message]
    const tagRegex = /\[@([^\]]+?):\s*([\s\S]*?)\]/g;

    // Strip all [@teammate: ...] tags from the full response to get shared context
    const sharedContext = response.replace(tagRegex, '').trim();

    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tagRegex.exec(response)) !== null) {
        const directMessage = tagMatch[2].trim();
        const fullMessage = sharedContext
            ? `${sharedContext}\n\n------\n\nDirected to you:\n${directMessage}`
            : directMessage;

        // Support comma-separated agent IDs: [@coder,reviewer: message]
        const candidateIds = tagMatch[1].toLowerCase().split(',').map(id => id.trim()).filter(Boolean);
        for (const candidateId of candidateIds) {
            if (!seen.has(candidateId) && isTeammate(candidateId, currentAgentId, teamId, teams, agents)) {
                results.push({ teammateId: candidateId, message: fullMessage });
                seen.add(candidateId);
            }
        }
    }
    return results;
}

/**
 * Extract [#team_id: message] chat room broadcast tags from a response.
 * Returns array of { teamId, message } for each valid chat room tag.
 */
export function extractChatRoomMessages(
    response: string,
    currentAgentId: string,
    teams: Record<string, TeamConfig>
): { teamId: string; message: string }[] {
    const results: { teamId: string; message: string }[] = [];
    const tagRegex = /\[#([^\]]+?):\s*([\s\S]*?)\]/g;

    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(response)) !== null) {
        const candidateId = match[1].trim().toLowerCase();
        const message = match[2].trim();

        if (!message) continue;

        // Validate team exists and agent is a member
        const team = teams[candidateId];
        if (team && team.agents.includes(currentAgentId)) {
            results.push({ teamId: candidateId, message });
        }
    }

    return results;
}

/**
 * Get the reset flag path for a specific agent.
 */
export function getAgentResetFlag(agentId: string, workspacePath: string): string {
    return path.join(workspacePath, agentId, 'reset_flag');
}

/**
 * Parse @agent_id or @team_id prefix from a message.
 * Returns { agentId, message, isTeam } where message has the prefix stripped.
 */
export function parseAgentRouting(
    rawMessage: string,
    agents: Record<string, AgentConfig>,
    teams: Record<string, TeamConfig> = {}
): { agentId: string; message: string; isTeam?: boolean } {
    // Match @agent_id at the start of the message
    const match = rawMessage.match(/^@(\S+)\s+([\s\S]*)$/);
    if (match) {
        const candidateId = match[1].toLowerCase();
        const message = match[2];

        // Check agent IDs
        if (agents[candidateId]) {
            return { agentId: candidateId, message };
        }

        // Check team IDs — resolve to leader agent
        if (teams[candidateId]) {
            return { agentId: teams[candidateId].leader_agent, message, isTeam: true };
        }

        // Match by agent name (case-insensitive)
        for (const [id, config] of Object.entries(agents)) {
            if (config.name.toLowerCase() === candidateId) {
                return { agentId: id, message };
            }
        }

        // Match by team name (case-insensitive)
        for (const [, config] of Object.entries(teams)) {
            if (config.name.toLowerCase() === candidateId) {
                return { agentId: config.leader_agent, message, isTeam: true };
            }
        }
    }
    return { agentId: 'default', message: rawMessage };
}
