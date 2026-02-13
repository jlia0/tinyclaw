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

    // Tag format: [@agent_id: message]
    const tagRegex = /\[@(\S+?):\s*([\s\S]*?)\]/g;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tagRegex.exec(response)) !== null) {
        const candidateId = tagMatch[1].toLowerCase();
        if (!seen.has(candidateId) && isTeammate(candidateId, currentAgentId, teamId, teams, agents)) {
            results.push({ teammateId: candidateId, message: tagMatch[2].trim() });
            seen.add(candidateId);
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
 * Detect if message mentions multiple agents (easter egg for future feature).
 * If all mentioned agents are in the same team, returns empty (team chain handles it).
 */
export function detectMultipleAgents(message: string, agents: Record<string, AgentConfig>, teams: Record<string, TeamConfig>): string[] {
    const mentions = message.match(/@(\S+)/g) || [];
    const validAgents: string[] = [];

    for (const mention of mentions) {
        const agentId = mention.slice(1).toLowerCase();
        if (agents[agentId]) {
            validAgents.push(agentId);
        }
    }

    // If multiple agents are all in the same team, don't trigger easter egg
    if (validAgents.length > 1) {
        for (const [, team] of Object.entries(teams)) {
            if (validAgents.every(a => team.agents.includes(a))) {
                return []; // Same team — chain will handle collaboration
            }
        }
    }

    return validAgents;
}

/**
 * Parse @agent_id or @team_id prefix from a message.
 * Returns { agentId, message, isTeam } where message has the prefix stripped.
 * Returns { agentId: 'error', message: '...' } if multiple agents detected (across teams).
 */
export function parseAgentRouting(
    rawMessage: string,
    agents: Record<string, AgentConfig>,
    teams: Record<string, TeamConfig> = {}
): { agentId: string; message: string; isTeam?: boolean } {
    // Easter egg: Check for multiple agent mentions (only for agents NOT in the same team)
    const mentionedAgents = detectMultipleAgents(rawMessage, agents, teams);
    if (mentionedAgents.length > 1) {
        const agentList = mentionedAgents.map(t => `@${t}`).join(', ');
        return {
            agentId: 'error',
            message: `🚀 **Agent-to-Agent Collaboration - Coming Soon!**\n\n` +
                     `You mentioned multiple agents: ${agentList}\n\n` +
                     `Right now, I can only route to one agent at a time. But we're working on something cool:\n\n` +
                     `✨ **Multi-Agent Coordination** - Agents will be able to collaborate on complex tasks!\n` +
                     `✨ **Smart Routing** - Send instructions to multiple agents at once!\n` +
                     `✨ **Agent Handoffs** - One agent can delegate to another!\n\n` +
                     `For now, please send separate messages to each agent:\n` +
                     mentionedAgents.map(t => `• \`@${t} [your message]\``).join('\n') + '\n\n' +
                     `_Stay tuned for updates! 🎉_`
        };
    }

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
