import { AgentConfig, TeamConfig, log } from '@tinyclaw/core';

// ── Bracket-depth tag parser ────────────────────────────────────────────────

export interface BracketTag {
    id: string;       // agent id(s) or team id (raw, before splitting on commas)
    message: string;  // content between colon and closing bracket
    start: number;    // index of opening [
    end: number;      // index after closing ]
}

/**
 * Extract bracket tags with balanced bracket matching.
 * Handles nested brackets in message bodies (e.g., `[@coder: fix arr[0]]`).
 *
 * @param text   The full response text to parse
 * @param prefix '@' for teammate tags, '#' for chat room tags
 */
export function extractBracketTags(text: string, prefix: '@' | '#'): BracketTag[] {
    const results: BracketTag[] = [];
    let i = 0;

    while (i < text.length) {
        // Look for [@ or [#
        if (text[i] === '[' && i + 1 < text.length && text[i + 1] === prefix) {
            const tagStart = i;

            // Find the colon that separates id from message
            const colonIdx = text.indexOf(':', i + 2);
            if (colonIdx === -1) { i++; continue; }

            // Ensure no unbalanced brackets before the colon (id portion should be simple)
            const idPortion = text.substring(i + 2, colonIdx);
            if (idPortion.includes('[') || idPortion.includes(']')) { i++; continue; }

            const id = idPortion.trim();
            if (!id) { i++; continue; }

            // Find the matching ] by counting bracket depth
            let depth = 1;
            let j = colonIdx + 1;
            while (j < text.length && depth > 0) {
                if (text[j] === '[') depth++;
                else if (text[j] === ']') depth--;
                j++;
            }

            if (depth === 0) {
                const message = text.substring(colonIdx + 1, j - 1).trim();
                results.push({ id, message, start: tagStart, end: j });
            }

            i = j;
        } else {
            i++;
        }
    }

    return results;
}

/**
 * Strip all bracket tags of a given prefix from text, returning the remaining text.
 * Used to compute shared context (text outside tags).
 */
export function stripBracketTags(text: string, prefix: '@' | '#'): string {
    const tags = extractBracketTags(text, prefix);
    if (tags.length === 0) return text;

    let result = '';
    let lastEnd = 0;
    for (const tag of tags) {
        result += text.substring(lastEnd, tag.start);
        lastEnd = tag.end;
    }
    result += text.substring(lastEnd);
    return result.trim();
}

/**
 * Convert [@agent: message] tags to readable format (@from → @to: message).
 * Uses bracket-depth parsing to handle nested brackets correctly.
 * When `fromAgent` is provided, formats as `@from → @to: message`.
 */
export function convertTagsToReadable(text: string, fromAgent?: string): string {
    const tags = extractBracketTags(text, '@');
    if (tags.length === 0) return text;

    const prefix = fromAgent ? `@${fromAgent} → ` : '→ ';
    let result = '';
    let lastEnd = 0;
    for (const tag of tags) {
        result += text.substring(lastEnd, tag.start);
        result += `${prefix}@${tag.id}: ${tag.message}`;
        lastEnd = tag.end;
    }
    result += text.substring(lastEnd);
    return result.trim();
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
 * Extract valid @teammate mentions from a response text.
 * Uses bracket-depth parsing to handle nested brackets in message bodies.
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

    const tags = extractBracketTags(response, '@');

    // Strip all [@teammate: ...] tags from the full response to get shared context
    const sharedContext = stripBracketTags(response, '@');

    for (const tag of tags) {
        const directMessage = tag.message;
        const fullMessage = sharedContext
            ? `${sharedContext}\n\n------\n\nDirected to you:\n${directMessage}`
            : directMessage;

        // Support comma-separated agent IDs: [@coder,reviewer: message]
        const candidateIds = tag.id.toLowerCase().split(',').map(id => id.trim()).filter(Boolean);
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
 * Uses bracket-depth parsing to handle nested brackets in message bodies.
 */
export function extractChatRoomMessages(
    response: string,
    currentAgentId: string,
    teams: Record<string, TeamConfig>
): { teamId: string; message: string }[] {
    const results: { teamId: string; message: string }[] = [];
    const tags = extractBracketTags(response, '#');

    for (const tag of tags) {
        const candidateId = tag.id.toLowerCase();
        if (!tag.message) continue;

        // Validate team exists and agent is a member
        const team = teams[candidateId];
        if (team && team.agents.includes(currentAgentId)) {
            results.push({ teamId: candidateId, message: tag.message });
        }
    }

    return results;
}
