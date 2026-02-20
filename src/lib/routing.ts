import path from 'path';
import { AgentConfig, TeamConfig } from './types';

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
    if (!team) return false;
    return (
        mentionedId !== currentAgentId &&
        team.agents.includes(mentionedId) &&
        !!agents[mentionedId]
    );
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

    // TODO: Support cross-team communication — allow agents to mention agents
    // on other teams or use [@team_id: message] to route to another team's leader.

    // Tag format: [@agent_id: message] or [@agent1,agent2: message]
    const tagRegex = /\[@(\S+?):\s*([\s\S]*?)\]/g;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tagRegex.exec(response)) !== null) {
        // Strip all [@teammate: ...] tags from the full response to get shared context
        const sharedContext = response.replace(tagRegex, '').trim();
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
    const match = rawMessage.match(/^@(\S+)\s+([\s\S]*)$/);
    if (match) {
        const candidateId = match[1].toLowerCase();

        // Check agent IDs
        if (agents[candidateId]) {
            return { agentId: candidateId, message: match[2] };
        }

        // Check team IDs — resolve to leader agent
        if (teams[candidateId]) {
            return { agentId: teams[candidateId].leader_agent, message: match[2], isTeam: true };
        }

        // Match by agent name (case-insensitive)
        for (const [id, config] of Object.entries(agents)) {
            if (config.name.toLowerCase() === candidateId) {
                return { agentId: id, message: match[2] };
            }
        }

        // Match by team name (case-insensitive)
        for (const [, config] of Object.entries(teams)) {
            if (config.name.toLowerCase() === candidateId) {
                return { agentId: config.leader_agent, message: match[2], isTeam: true };
            }
        }
    }
    return { agentId: 'default', message: rawMessage };
}
