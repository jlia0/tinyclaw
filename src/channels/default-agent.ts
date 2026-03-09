/**
 * Per-chat default agent tracking for channel clients.
 *
 * When a user sends `@agent_id message`, the channel client stores that agent
 * as the default for the chat. Subsequent messages without an @-prefix are
 * automatically routed to the stored default agent.
 *
 * Defaults persist in settings.json under `channels.defaults`.
 */

import fs from 'fs';

interface AgentMatchResult {
    tag: string;
    displayName: string;
    isTeam: boolean;
}

function readSettings(settingsFile: string): any {
    try {
        return JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    } catch {
        return {};
    }
}

function getDefaults(settingsFile: string): Record<string, string> {
    return readSettings(settingsFile).channels?.defaults || {};
}

function saveDefault(settingsFile: string, chatKey: string, agentId: string): void {
    try {
        const settings = readSettings(settingsFile);
        if (!settings.channels) settings.channels = {};
        if (!settings.channels.defaults) settings.channels.defaults = {};
        settings.channels.defaults[chatKey] = agentId;
        fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    } catch {
        // Best-effort
    }
}

function deleteDefault(settingsFile: string, chatKey: string): void {
    try {
        const settings = readSettings(settingsFile);
        if (settings.channels?.defaults) {
            delete settings.channels.defaults[chatKey];
            fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
        }
    } catch {
        // Best-effort
    }
}

/**
 * Try to resolve a candidate tag to a valid agent or team.
 */
export function resolveAgentTag(candidateTag: string, settingsFile: string): AgentMatchResult | null {
    const settings = readSettings(settingsFile);
    const agents = settings.agents || {};
    const teams = settings.teams || {};
    const candidate = candidateTag.toLowerCase();

    if (agents[candidate]) {
        return { tag: candidate, displayName: agents[candidate].name, isTeam: false };
    }
    if (teams[candidate]) {
        return { tag: candidate, displayName: teams[candidate].name, isTeam: true };
    }
    for (const [id, config] of Object.entries(agents) as [string, any][]) {
        if (config.name.toLowerCase() === candidate) {
            return { tag: id, displayName: config.name, isTeam: false };
        }
    }
    for (const [id, config] of Object.entries(teams) as [string, any][]) {
        if (config.name.toLowerCase() === candidate) {
            return { tag: id, displayName: config.name, isTeam: true };
        }
    }
    return null;
}

/**
 * Process an incoming message for default-agent logic.
 *
 * - If the message starts with `@tag`, validate and store as default.
 * - If the message is just `@tag` with no body, switch without queuing.
 * - `@default` clears the sticky default.
 * - Messages without `@` get the stored default prepended.
 */
export function applyDefaultAgent(
    chatKey: string,
    messageText: string,
    settingsFile: string,
): { message: string | null; switchNotification: string | null } {
    const atMatch = messageText.match(/^@(\S+)(?:\s+([\s\S]*))?$/);

    if (atMatch) {
        const candidateTag = atMatch[1];
        const body = atMatch[2]?.trim() || '';

        // "@default" clears the sticky default
        if (candidateTag.toLowerCase() === 'default') {
            const defaults = getDefaults(settingsFile);
            const had = chatKey in defaults;
            if (had) deleteDefault(settingsFile, chatKey);
            return {
                message: null,
                switchNotification: had
                    ? 'Cleared default agent. Messages will use default routing.'
                    : 'No default agent was set.',
            };
        }

        const match = resolveAgentTag(candidateTag, settingsFile);
        if (match) {
            const previous = getDefaults(settingsFile)[chatKey];
            const switched = previous !== match.tag;
            if (switched) saveDefault(settingsFile, chatKey, match.tag);

            const kind = match.isTeam ? 'team' : 'agent';
            const notification = switched
                ? `Switched to ${kind} @${match.tag} (${match.displayName}). Future messages will be routed here automatically. Send @default to clear.`
                : null;

            if (!body) {
                return { message: null, switchNotification: notification };
            }
            return { message: messageText, switchNotification: notification };
        }
        // Unrecognized @tag — pass through as-is
        return { message: messageText, switchNotification: null };
    }

    // No @-prefix — apply stored default if any
    const storedDefault = getDefaults(settingsFile)[chatKey];
    if (storedDefault) {
        return { message: `@${storedDefault} ${messageText}`, switchNotification: null };
    }

    return { message: messageText, switchNotification: null };
}
