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

    // Build case-insensitive agent lookup map
    const agentIdMap = new Map<string, string>();
    for (const id of Object.keys(agents)) {
        agentIdMap.set(id.toLowerCase(), id);
    }

    // Tag format: [@agent_id: message] or [@agent1,agent2: message]
    // Improved regex: better handling of content with brackets
    const tagRegex = /\[@([^\]]+?):\s*([\s\S]*?)\]/g;

    // Strip all [@teammate: ...] tags from the full response to get shared context
    const sharedContext = response.replace(tagRegex, '').trim();

    let tagMatch: RegExpExecArray | null;
    let matchCount = 0;

    while ((tagMatch = tagRegex.exec(response)) !== null) {
        matchCount++;
        const rawAgentList = tagMatch[1];
        const directMessage = tagMatch[2].trim();

        log('DEBUG', `Found mention tag #${matchCount}: "[@${rawAgentList}: ...]" from @${currentAgentId}`);

        const fullMessage = sharedContext
            ? `${sharedContext}\n\n------\n\nDirected to you:\n${directMessage}`
            : directMessage;

        // Support comma-separated agent IDs: [@coder,reviewer: message]
        const rawCandidateIds = rawAgentList.split(',').map(id => id.trim()).filter(Boolean);

        for (const rawCandidateId of rawCandidateIds) {
            // Case-insensitive lookup
            const candidateId = agentIdMap.get(rawCandidateId.toLowerCase()) || rawCandidateId;

            if (seen.has(candidateId)) {
                log('WARN', `Duplicate mention of @${candidateId} from @${currentAgentId} ignored`);
                continue;
            }

            if (isTeammate(candidateId, currentAgentId, teamId, teams, agents)) {
                results.push({ teammateId: candidateId, message: fullMessage });
                seen.add(candidateId);
                log('INFO', `Valid mention: @${currentAgentId} → @${candidateId}`);
            }
        }
    }

    // Log summary
    if (matchCount === 0) {
        log('DEBUG', `No mention tags found in response from @${currentAgentId}`);
    } else if (results.length === 0) {
        log('WARN', `Found ${matchCount} mention tag(s) from @${currentAgentId} but none were valid`);
        log('DEBUG', `Response snippet: "${response.substring(0, 200)}..."`);
    } else {
        log('DEBUG', `Extracted ${results.length} valid mention(s) from ${matchCount} tag(s) for @${currentAgentId}`);
    }

    return results;
}

/**
 * Validates that an agent response is properly formatted.
 * Returns validation result with any errors found.
 */
export function validateAgentResponse(
    response: string,
    agentId: string,
    teamId: string,
    teams: Record<string, TeamConfig>,
    agents: Record<string, AgentConfig>
): { valid: boolean; errors: string[]; mentions: string[] } {
    const errors: string[] = [];
    const mentions: string[] = [];

    // Check for potentially malformed mention tags
    const openBrackets = (response.match(/\[@/g) || []).length;
    const closeBrackets = (response.match(/\]/g) || []).length;

    if (openBrackets !== closeBrackets) {
        errors.push(`Mismatched brackets: ${openBrackets} opening, ${closeBrackets} closing`);
    }

    // Build case-insensitive agent lookup
    const agentIdMap = new Map<string, string>();
    for (const id of Object.keys(agents)) {
        agentIdMap.set(id.toLowerCase(), id);
    }

    // Extract and validate mentions
    const tagRegex = /\[@([^\]]+?):/g;
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(response)) !== null) {
        const rawList = match[1];
        const ids = rawList.split(',').map(id => id.trim()).filter(Boolean);

        for (const rawId of ids) {
            const normalizedId = rawId.toLowerCase();
            const actualId = agentIdMap.get(normalizedId);

            if (!actualId) {
                errors.push(`Unknown agent: @${rawId}`);
            } else {
                mentions.push(actualId);
            }
        }
    }

    return { valid: errors.length === 0, errors, mentions };
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
    // Strip [channel/sender]: prefix added by the messages API route
    const stripped = rawMessage.replace(/^\[[^\]]*\]:\s*/, '');
    const match = stripped.match(/^@(\S+)\s+([\s\S]*)$/);
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
