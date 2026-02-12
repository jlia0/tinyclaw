#!/usr/bin/env node
/**
 * Queue Processor - Handles messages from all channels (WhatsApp, Telegram, etc.)
 * Processes one message at a time to avoid race conditions
 *
 * Supports multi-agent routing:
 *   - Messages prefixed with @agent_id are routed to that agent
 *   - Unrouted messages go to the "default" agent
 *   - Each agent has its own provider, model, working directory, and system prompt
 *   - Conversation isolation via per-agent working directories
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const SCRIPT_DIR = path.resolve(__dirname, '..');
const _localTinyclaw = path.join(SCRIPT_DIR, '.tinyclaw');
const TINYCLAW_HOME = fs.existsSync(path.join(_localTinyclaw, 'settings.json'))
    ? _localTinyclaw
    : path.join(require('os').homedir(), '.tinyclaw');
const QUEUE_INCOMING = path.join(TINYCLAW_HOME, 'queue/incoming');
const QUEUE_OUTGOING = path.join(TINYCLAW_HOME, 'queue/outgoing');
const QUEUE_PROCESSING = path.join(TINYCLAW_HOME, 'queue/processing');
const LOG_FILE = path.join(TINYCLAW_HOME, 'logs/queue.log');
const RESET_FLAG = path.join(TINYCLAW_HOME, 'reset_flag');
const SETTINGS_FILE = path.join(TINYCLAW_HOME, 'settings.json');
const EVENTS_DIR = path.join(TINYCLAW_HOME, 'events');

// Model name mapping
const CLAUDE_MODEL_IDS: Record<string, string> = {
    'sonnet': 'claude-sonnet-4-5',
    'opus': 'claude-opus-4-6',
    'claude-sonnet-4-5': 'claude-sonnet-4-5',
    'claude-opus-4-6': 'claude-opus-4-6'
};

const CODEX_MODEL_IDS: Record<string, string> = {
    'gpt-5.2': 'gpt-5.2',
    'gpt-5.3-codex': 'gpt-5.3-codex',
};

interface AgentConfig {
    name: string;
    provider: string;       // 'anthropic' or 'openai'
    model: string;           // e.g. 'sonnet', 'opus', 'gpt-5.3-codex'
    working_directory: string;
}

interface TeamConfig {
    name: string;
    agents: string[];
    leader_agent: string;
}

interface ChainStep {
    agentId: string;
    response: string;
}

interface Settings {
    workspace?: {
        path?: string;
        name?: string;
    };
    channels?: {
        enabled?: string[];
        discord?: { bot_token?: string };
        telegram?: { bot_token?: string };
        whatsapp?: {};
    };
    models?: {
        provider?: string; // 'anthropic' or 'openai'
        anthropic?: {
            model?: string;
        };
        openai?: {
            model?: string;
        };
    };
    agents?: Record<string, AgentConfig>;
    teams?: Record<string, TeamConfig>;
    monitoring?: {
        heartbeat_interval?: number;
    };
}

function getSettings(): Settings {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const settings: Settings = JSON.parse(settingsData);

        // Auto-detect provider if not specified
        if (!settings?.models?.provider) {
            if (settings?.models?.openai) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'openai';
            } else if (settings?.models?.anthropic) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'anthropic';
            }
        }

        return settings;
    } catch {
        return {};
    }
}

/**
 * Build the default agent config from the legacy models section.
 * Used when no agents are configured, for backwards compatibility.
 */
function getDefaultAgentFromModels(settings: Settings): AgentConfig {
    const provider = settings?.models?.provider || 'anthropic';
    let model = '';
    if (provider === 'openai') {
        model = settings?.models?.openai?.model || 'gpt-5.3-codex';
    } else {
        model = settings?.models?.anthropic?.model || 'sonnet';
    }

    // Get workspace path from settings or use default
    const workspacePath = settings?.workspace?.path || path.join(require('os').homedir(), 'tinyclaw-workspace');
    const defaultAgentDir = path.join(workspacePath, 'default');

    // Ensure default agent directory exists with copied configs
    ensureAgentDirectory(defaultAgentDir);

    return {
        name: 'Default',
        provider,
        model,
        working_directory: defaultAgentDir,
    };
}

/**
 * Recursively copy directory
 */
function copyDirSync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

/**
 * Ensure agent directory exists with template files copied from TINYCLAW_HOME.
 * Creates directory if it doesn't exist and copies .claude/, heartbeat.md, and AGENTS.md.
 */
function ensureAgentDirectory(agentDir: string): void {
    if (fs.existsSync(agentDir)) {
        return; // Directory already exists
    }

    fs.mkdirSync(agentDir, { recursive: true });

    // Copy .claude directory
    const sourceClaudeDir = path.join(SCRIPT_DIR, '.claude');
    const targetClaudeDir = path.join(agentDir, '.claude');
    if (fs.existsSync(sourceClaudeDir)) {
        copyDirSync(sourceClaudeDir, targetClaudeDir);
    }

    // Copy heartbeat.md
    const sourceHeartbeat = path.join(SCRIPT_DIR, 'heartbeat.md');
    const targetHeartbeat = path.join(agentDir, 'heartbeat.md');
    if (fs.existsSync(sourceHeartbeat)) {
        fs.copyFileSync(sourceHeartbeat, targetHeartbeat);
    }

    // Copy AGENTS.md
    const sourceAgents = path.join(SCRIPT_DIR, 'AGENTS.md');
    const targetAgents = path.join(agentDir, 'AGENTS.md');
    if (fs.existsSync(sourceAgents)) {
        fs.copyFileSync(sourceAgents, targetAgents);
    }

    // Symlink skills directory into .claude/skills
    const sourceSkills = path.join(SCRIPT_DIR, '.agents', 'skills');
    const targetSkills = path.join(agentDir, '.claude', 'skills');
    if (fs.existsSync(sourceSkills) && !fs.existsSync(targetSkills)) {
        fs.mkdirSync(path.join(agentDir, '.claude'), { recursive: true });
        fs.symlinkSync(sourceSkills, targetSkills);
    }
}

/**
 * Get all configured agents. Falls back to a single "default" agent
 * derived from the legacy models section if no agents are configured.
 */
function getAgents(settings: Settings): Record<string, AgentConfig> {
    if (settings.agents && Object.keys(settings.agents).length > 0) {
        return settings.agents;
    }
    // Fall back to default agent from models section
    return { default: getDefaultAgentFromModels(settings) };
}

/**
 * Get all configured teams.
 */
function getTeams(settings: Settings): Record<string, TeamConfig> {
    return settings.teams || {};
}

/**
 * Find the first team that contains the given agent.
 */
function findTeamForAgent(agentId: string, teams: Record<string, TeamConfig>): { teamId: string; team: TeamConfig } | null {
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
function isTeammate(
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
function extractTeammateMentions(
    response: string,
    currentAgentId: string,
    teamId: string,
    teams: Record<string, TeamConfig>,
    agents: Record<string, AgentConfig>
): { teammateId: string; message: string }[] {
    const results: { teammateId: string; message: string }[] = [];
    const seen = new Set<string>();

    // Try tag format first: [@agent_id: message]
    const tagRegex = /\[@(\S+?):\s*([\s\S]*?)\]/g;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tagRegex.exec(response)) !== null) {
        const candidateId = tagMatch[1].toLowerCase();
        if (!seen.has(candidateId) && isTeammate(candidateId, currentAgentId, teamId, teams, agents)) {
            results.push({ teammateId: candidateId, message: tagMatch[2].trim() });
            seen.add(candidateId);
        }
    }
    if (results.length > 0) return results;

    // Fallback: bare @mention (first match only, legacy single-handoff)
    const mentions = response.match(/@(\S+)/g) || [];
    for (const mention of mentions) {
        const candidateId = mention.slice(1).toLowerCase();
        if (isTeammate(candidateId, currentAgentId, teamId, teams, agents)) {
            return [{ teammateId: candidateId, message: response }];
        }
    }
    return [];
}

/**
 * Resolve the model ID for Claude (Anthropic).
 */
function resolveClaudeModel(model: string): string {
    return CLAUDE_MODEL_IDS[model] || model || '';
}

/**
 * Resolve the model ID for Codex (OpenAI).
 */
function resolveCodexModel(model: string): string {
    return CODEX_MODEL_IDS[model] || model || '';
}

/**
 * Get the reset flag path for a specific agent.
 */
function getAgentResetFlag(agentId: string, workspacePath: string): string {
    return path.join(workspacePath, agentId, 'reset_flag');
}


/**
 * Detect if message mentions multiple agents (easter egg for future feature).
 * If all mentioned agents are in the same team, returns empty (team chain handles it).
 */
function detectMultipleAgents(message: string, agents: Record<string, AgentConfig>, teams: Record<string, TeamConfig>): string[] {
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
function parseAgentRouting(
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
        for (const [id, config] of Object.entries(teams)) {
            if (config.name.toLowerCase() === candidateId) {
                return { agentId: config.leader_agent, message: match[2], isTeam: true };
            }
        }
    }
    return { agentId: 'default', message: rawMessage };
}

async function runCommand(command: string, args: string[], cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: cwd || SCRIPT_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
        });

        child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
        });

        child.on('error', (error) => {
            reject(error);
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
                return;
            }

            const errorMessage = stderr.trim() || `Command exited with code ${code}`;
            reject(new Error(errorMessage));
        });
    });
}

// Ensure directories exist
[QUEUE_INCOMING, QUEUE_OUTGOING, QUEUE_PROCESSING, path.dirname(LOG_FILE)].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

interface MessageData {
    channel: string;
    sender: string;
    senderId?: string;
    message: string;
    timestamp: number;
    messageId: string;
    agent?: string; // optional: pre-routed agent id from channel client
    files?: string[];
}

interface ResponseData {
    channel: string;
    sender: string;
    message: string;
    originalMessage: string;
    timestamp: number;
    messageId: string;
    agent?: string; // which agent handled this
    files?: string[];
}

// Logger
function log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(LOG_FILE, logMessage);
}

/**
 * Emit a structured event for the team visualizer TUI.
 * Events are written as JSON files to EVENTS_DIR, watched by the visualizer.
 */
function emitEvent(type: string, data: Record<string, unknown>): void {
    try {
        if (!fs.existsSync(EVENTS_DIR)) {
            fs.mkdirSync(EVENTS_DIR, { recursive: true });
        }
        const event = { type, timestamp: Date.now(), ...data };
        const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
        fs.writeFileSync(path.join(EVENTS_DIR, filename), JSON.stringify(event) + '\n');
    } catch {
        // Visualizer events are best-effort; never break the queue processor
    }
}

/**
 * Update the AGENTS.md in an agent's directory with current teammate info.
 * Replaces content between <!-- TEAMMATES_START --> and <!-- TEAMMATES_END --> markers.
 */
function updateAgentTeammates(agentDir: string, agentId: string, agents: Record<string, AgentConfig>, teams: Record<string, TeamConfig>): void {
    const agentsMdPath = path.join(agentDir, 'AGENTS.md');
    if (!fs.existsSync(agentsMdPath)) return;

    let content = fs.readFileSync(agentsMdPath, 'utf8');
    const startMarker = '<!-- TEAMMATES_START -->';
    const endMarker = '<!-- TEAMMATES_END -->';
    const startIdx = content.indexOf(startMarker);
    const endIdx = content.indexOf(endMarker);
    if (startIdx === -1 || endIdx === -1) return;

    // Find teammates from all teams this agent belongs to
    const teammates: { id: string; name: string; model: string }[] = [];
    for (const team of Object.values(teams)) {
        if (!team.agents.includes(agentId)) continue;
        for (const tid of team.agents) {
            if (tid === agentId) continue;
            const agent = agents[tid];
            if (agent && !teammates.some(t => t.id === tid)) {
                teammates.push({ id: tid, name: agent.name, model: agent.model });
            }
        }
    }

    let block = '';
    const self = agents[agentId];
    if (self) {
        block += `\n### You\n\n- \`@${agentId}\` — **${self.name}** (${self.model})\n`;
    }
    if (teammates.length > 0) {
        block += '\n### Your Teammates\n\n';
        for (const t of teammates) {
            block += `- \`@${t.id}\` — **${t.name}** (${t.model})\n`;
        }
    }

    const newContent = content.substring(0, startIdx + startMarker.length) + block + content.substring(endIdx);
    fs.writeFileSync(agentsMdPath, newContent);

    // Also write to .claude/CLAUDE.md
    const claudeDir = path.join(agentDir, '.claude');
    if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
    }
    const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');
    let claudeContent = '';
    if (fs.existsSync(claudeMdPath)) {
        claudeContent = fs.readFileSync(claudeMdPath, 'utf8');
    }
    const cStartIdx = claudeContent.indexOf(startMarker);
    const cEndIdx = claudeContent.indexOf(endMarker);
    if (cStartIdx !== -1 && cEndIdx !== -1) {
        claudeContent = claudeContent.substring(0, cStartIdx + startMarker.length) + block + claudeContent.substring(cEndIdx);
    } else {
        // Append markers + block
        claudeContent = claudeContent.trimEnd() + '\n\n' + startMarker + block + endMarker + '\n';
    }
    fs.writeFileSync(claudeMdPath, claudeContent);
}

/**
 * Invoke a single agent with a message. Contains all Claude/Codex invocation logic.
 * Returns the raw response text.
 */
async function invokeAgent(
    agent: AgentConfig,
    agentId: string,
    message: string,
    workspacePath: string,
    shouldReset: boolean,
    agents: Record<string, AgentConfig> = {},
    teams: Record<string, TeamConfig> = {}
): Promise<string> {
    // Ensure agent directory exists with config files
    const agentDir = path.join(workspacePath, agentId);
    const isNewAgent = !fs.existsSync(agentDir);
    ensureAgentDirectory(agentDir);
    if (isNewAgent) {
        log('INFO', `Initialized agent directory with config files: ${agentDir}`);
    }

    // Update AGENTS.md with current teammate info
    updateAgentTeammates(agentDir, agentId, agents, teams);

    // Resolve working directory
    const workingDir = agent.working_directory
        ? (path.isAbsolute(agent.working_directory)
            ? agent.working_directory
            : path.join(workspacePath, agent.working_directory))
        : agentDir;

    const provider = agent.provider || 'anthropic';

    if (provider === 'openai') {
        log('INFO', `Using Codex CLI (agent: ${agentId})`);

        const shouldResume = !shouldReset;

        if (shouldReset) {
            log('INFO', `🔄 Resetting Codex conversation for agent: ${agentId}`);
        }

        const modelId = resolveCodexModel(agent.model);
        const codexArgs = ['exec'];
        if (shouldResume) {
            codexArgs.push('resume', '--last');
        }
        if (modelId) {
            codexArgs.push('--model', modelId);
        }
        codexArgs.push('--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--json', message);

        const codexOutput = await runCommand('codex', codexArgs, workingDir);

        // Parse JSONL output and extract final agent_message
        let response = '';
        const lines = codexOutput.trim().split('\n');
        for (const line of lines) {
            try {
                const json = JSON.parse(line);
                if (json.type === 'item.completed' && json.item?.type === 'agent_message') {
                    response = json.item.text;
                }
            } catch (e) {
                // Ignore lines that aren't valid JSON
            }
        }

        return response || 'Sorry, I could not generate a response from Codex.';
    } else {
        // Default to Claude (Anthropic)
        log('INFO', `Using Claude provider (agent: ${agentId})`);

        const continueConversation = !shouldReset;

        if (shouldReset) {
            log('INFO', `🔄 Resetting conversation for agent: ${agentId}`);
        }

        const modelId = resolveClaudeModel(agent.model);
        const claudeArgs = ['--dangerously-skip-permissions'];
        if (modelId) {
            claudeArgs.push('--model', modelId);
        }
        if (continueConversation) {
            claudeArgs.push('-c');
        }
        claudeArgs.push('-p', message);

        return await runCommand('claude', claudeArgs, workingDir);
    }
}

// Process a single message
async function processMessage(messageFile: string): Promise<void> {
    const processingFile = path.join(QUEUE_PROCESSING, path.basename(messageFile));

    try {
        // Move to processing to mark as in-progress
        fs.renameSync(messageFile, processingFile);

        // Read message
        const messageData: MessageData = JSON.parse(fs.readFileSync(processingFile, 'utf8'));
        const { channel, sender, message: rawMessage, timestamp, messageId } = messageData;

        log('INFO', `Processing [${channel}] from ${sender}: ${rawMessage.substring(0, 50)}...`);
        emitEvent('message_received', { channel, sender, message: rawMessage.substring(0, 120), messageId });

        // Get settings, agents, and teams
        const settings = getSettings();
        const agents = getAgents(settings);
        const teams = getTeams(settings);

        // Get workspace path from settings
        const workspacePath = settings?.workspace?.path || path.join(require('os').homedir(), 'tinyclaw-workspace');

        // Route message to agent (or team)
        let agentId: string;
        let message: string;
        let isTeamRouted = false;

        if (messageData.agent && agents[messageData.agent]) {
            // Pre-routed by channel client
            agentId = messageData.agent;
            message = rawMessage;
        } else {
            // Parse @agent or @team prefix
            const routing = parseAgentRouting(rawMessage, agents, teams);
            agentId = routing.agentId;
            message = routing.message;
            isTeamRouted = !!routing.isTeam;
        }

        // Easter egg: Handle multiple agent mentions
        if (agentId === 'error') {
            log('INFO', `Multiple agents detected, sending easter egg message`);

            // Send error message directly as response
            const responseFile = path.join(QUEUE_OUTGOING, path.basename(processingFile));
            const responseData: ResponseData = {
                channel,
                sender,
                message: message, // Contains the easter egg message
                originalMessage: rawMessage,
                timestamp: Date.now(),
                messageId,
            };

            fs.writeFileSync(responseFile, JSON.stringify(responseData, null, 2));
            fs.unlinkSync(processingFile);
            log('INFO', `✓ Easter egg sent to ${sender}`);
            return;
        }

        // Fall back to default if agent not found
        if (!agents[agentId]) {
            agentId = 'default';
            message = rawMessage;
        }

        // Final fallback: use first available agent if no default
        if (!agents[agentId]) {
            agentId = Object.keys(agents)[0];
        }

        const agent = agents[agentId];
        log('INFO', `Routing to agent: ${agent.name} (${agentId}) [${agent.provider}/${agent.model}]`);
        emitEvent('agent_routed', { agentId, agentName: agent.name, provider: agent.provider, model: agent.model, isTeamRouted });

        // Determine team context
        // If routed via @team_id, use that team. Otherwise check if agent belongs to a team.
        let teamContext: { teamId: string; team: TeamConfig } | null = null;
        if (isTeamRouted) {
            // Find which team was targeted — the agent was resolved from a team's leader
            for (const [tid, t] of Object.entries(teams)) {
                if (t.leader_agent === agentId && t.agents.includes(agentId)) {
                    teamContext = { teamId: tid, team: t };
                    break;
                }
            }
        }
        if (!teamContext) {
            // Check if the directly-addressed agent belongs to a team
            teamContext = findTeamForAgent(agentId, teams);
        }

        // Check for reset (per-agent or global)
        const agentResetFlag = getAgentResetFlag(agentId, workspacePath);
        const shouldReset = fs.existsSync(RESET_FLAG) || fs.existsSync(agentResetFlag);

        if (shouldReset) {
            // Clean up both flags
            if (fs.existsSync(RESET_FLAG)) fs.unlinkSync(RESET_FLAG);
            if (fs.existsSync(agentResetFlag)) fs.unlinkSync(agentResetFlag);
        }

        let finalResponse: string;
        const allFiles = new Set<string>();

        if (!teamContext) {
            // No team context — single agent invocation (backward compatible)
            try {
                finalResponse = await invokeAgent(agent, agentId, message, workspacePath, shouldReset, agents, teams);
            } catch (error) {
                const provider = agent.provider || 'anthropic';
                log('ERROR', `${provider === 'openai' ? 'Codex' : 'Claude'} error (agent: ${agentId}): ${(error as Error).message}`);
                finalResponse = "Sorry, I encountered an error processing your request. Please check the queue logs.";
            }
        } else {
            // Team context — chain execution
            log('INFO', `Team context: ${teamContext.team.name} (@${teamContext.teamId})`);
            emitEvent('team_chain_start', { teamId: teamContext.teamId, teamName: teamContext.team.name, agents: teamContext.team.agents, leader: teamContext.team.leader_agent });

            const chainSteps: ChainStep[] = [];
            let currentAgentId = agentId;
            let currentMessage = message;

            // Chain loop — continues until agent responds without mentioning a teammate
            while (true) {
                const currentAgent = agents[currentAgentId];
                if (!currentAgent) {
                    log('ERROR', `Agent ${currentAgentId} not found during chain execution`);
                    break;
                }

                log('INFO', `Chain step ${chainSteps.length + 1}: invoking @${currentAgentId}`);
                emitEvent('chain_step_start', { teamId: teamContext.teamId, step: chainSteps.length + 1, agentId: currentAgentId, agentName: currentAgent.name });

                // Determine if this specific agent needs reset
                const currentResetFlag = getAgentResetFlag(currentAgentId, workspacePath);
                const currentShouldReset = chainSteps.length === 0
                    ? shouldReset
                    : fs.existsSync(currentResetFlag);

                if (currentShouldReset && fs.existsSync(currentResetFlag)) {
                    fs.unlinkSync(currentResetFlag);
                }

                let stepResponse: string;
                try {
                    stepResponse = await invokeAgent(currentAgent, currentAgentId, currentMessage, workspacePath, currentShouldReset, agents, teams);
                } catch (error) {
                    const provider = currentAgent.provider || 'anthropic';
                    log('ERROR', `${provider === 'openai' ? 'Codex' : 'Claude'} error (agent: ${currentAgentId}): ${(error as Error).message}`);
                    stepResponse = "Sorry, I encountered an error processing this request.";
                }

                chainSteps.push({ agentId: currentAgentId, response: stepResponse });
                emitEvent('chain_step_done', { teamId: teamContext.teamId, step: chainSteps.length, agentId: currentAgentId, responseLength: stepResponse.length, responseText: stepResponse });

                // Collect files from this step
                const stepFileRegex = /\[send_file:\s*([^\]]+)\]/g;
                let stepFileMatch: RegExpExecArray | null;
                while ((stepFileMatch = stepFileRegex.exec(stepResponse)) !== null) {
                    const filePath = stepFileMatch[1].trim();
                    if (fs.existsSync(filePath)) {
                        allFiles.add(filePath);
                    }
                }

                // Check if response mentions teammates
                const teammateMentions = extractTeammateMentions(
                    stepResponse, currentAgentId, teamContext.teamId, teams, agents
                );

                if (teammateMentions.length === 0) {
                    // No teammate mentioned — chain ends naturally
                    log('INFO', `Chain ended after ${chainSteps.length} step(s) — no teammate mentioned`);
                    emitEvent('team_chain_end', { teamId: teamContext.teamId, totalSteps: chainSteps.length, agents: chainSteps.map(s => s.agentId) });
                    break;
                }

                if (teammateMentions.length === 1) {
                    // Single handoff — sequential chain (existing behavior)
                    const mention = teammateMentions[0];
                    log('INFO', `@${currentAgentId} mentioned @${mention.teammateId} — continuing chain`);
                    emitEvent('chain_handoff', { teamId: teamContext.teamId, fromAgent: currentAgentId, toAgent: mention.teammateId, step: chainSteps.length });
                    currentAgentId = mention.teammateId;
                    currentMessage = `[Message from teammate @${chainSteps[chainSteps.length - 1].agentId}]:\n${mention.message}`;
                } else {
                    // Fan-out — invoke multiple teammates in parallel
                    log('INFO', `@${currentAgentId} mentioned ${teammateMentions.length} teammates — fan-out`);
                    for (const mention of teammateMentions) {
                        emitEvent('chain_handoff', { teamId: teamContext.teamId, fromAgent: currentAgentId, toAgent: mention.teammateId, step: chainSteps.length });
                    }

                    const fanOutResults = await Promise.all(
                        teammateMentions.map(async (mention) => {
                            const mAgent = agents[mention.teammateId];
                            if (!mAgent) return { agentId: mention.teammateId, response: `Error: agent ${mention.teammateId} not found` };

                            const mResetFlag = getAgentResetFlag(mention.teammateId, workspacePath);
                            const mShouldReset = fs.existsSync(mResetFlag);
                            if (mShouldReset) fs.unlinkSync(mResetFlag);

                            emitEvent('chain_step_start', { teamId: teamContext.teamId, step: chainSteps.length + 1, agentId: mention.teammateId, agentName: mAgent.name });

                            let mResponse: string;
                            try {
                                const mMessage = `[Message from teammate @${currentAgentId}]:\n${mention.message}`;
                                mResponse = await invokeAgent(mAgent, mention.teammateId, mMessage, workspacePath, mShouldReset, agents, teams);
                            } catch (error) {
                                log('ERROR', `Fan-out error (agent: ${mention.teammateId}): ${(error as Error).message}`);
                                mResponse = "Sorry, I encountered an error processing this request.";
                            }

                            emitEvent('chain_step_done', { teamId: teamContext.teamId, step: chainSteps.length + 1, agentId: mention.teammateId, responseLength: mResponse.length, responseText: mResponse });
                            return { agentId: mention.teammateId, response: mResponse };
                        })
                    );

                    for (const result of fanOutResults) {
                        chainSteps.push(result);

                        // Collect files from fan-out responses
                        const fanFileRegex = /\[send_file:\s*([^\]]+)\]/g;
                        let fanFileMatch: RegExpExecArray | null;
                        while ((fanFileMatch = fanFileRegex.exec(result.response)) !== null) {
                            const filePath = fanFileMatch[1].trim();
                            if (fs.existsSync(filePath)) allFiles.add(filePath);
                        }
                    }

                    log('INFO', `Fan-out complete — ${fanOutResults.length} responses collected`);
                    emitEvent('team_chain_end', { teamId: teamContext.teamId, totalSteps: chainSteps.length, agents: chainSteps.map(s => s.agentId) });
                    break;
                }
            }

            // Aggregate responses
            if (chainSteps.length === 1) {
                finalResponse = chainSteps[0].response;
            } else {
                finalResponse = chainSteps
                    .map(step => `@${step.agentId}: ${step.response}`)
                    .join('\n\n---\n\n');
            }
        }

        // Detect file references in the response: [send_file: /path/to/file]
        finalResponse = finalResponse.trim();
        const outboundFilesSet = new Set<string>(allFiles);
        const fileRefRegex = /\[send_file:\s*([^\]]+)\]/g;
        let fileMatch: RegExpExecArray | null;
        while ((fileMatch = fileRefRegex.exec(finalResponse)) !== null) {
            const filePath = fileMatch[1].trim();
            if (fs.existsSync(filePath)) {
                outboundFilesSet.add(filePath);
            }
        }
        const outboundFiles = Array.from(outboundFilesSet);

        // Remove the [send_file: ...] tags from the response text
        if (outboundFiles.length > 0) {
            finalResponse = finalResponse.replace(fileRefRegex, '').trim();
        }

        // Limit response length after tags are parsed and removed
        if (finalResponse.length > 4000) {
            finalResponse = finalResponse.substring(0, 3900) + '\n\n[Response truncated...]';
        }

        // Write response to outgoing queue
        const responseData: ResponseData = {
            channel,
            sender,
            message: finalResponse,
            originalMessage: rawMessage,
            timestamp: Date.now(),
            messageId,
            agent: agentId,
            files: outboundFiles.length > 0 ? outboundFiles : undefined,
        };

        // For heartbeat messages, write to a separate location (they handle their own responses)
        const responseFile = channel === 'heartbeat'
            ? path.join(QUEUE_OUTGOING, `${messageId}.json`)
            : path.join(QUEUE_OUTGOING, `${channel}_${messageId}_${Date.now()}.json`);

        fs.writeFileSync(responseFile, JSON.stringify(responseData, null, 2));

        log('INFO', `✓ Response ready [${channel}] ${sender} via agent:${agentId} (${finalResponse.length} chars)`);
        emitEvent('response_ready', { channel, sender, agentId, responseLength: finalResponse.length, responseText: finalResponse, messageId });

        // Clean up processing file
        fs.unlinkSync(processingFile);

    } catch (error) {
        log('ERROR', `Processing error: ${(error as Error).message}`);

        // Move back to incoming for retry
        if (fs.existsSync(processingFile)) {
            try {
                fs.renameSync(processingFile, messageFile);
            } catch (e) {
                log('ERROR', `Failed to move file back: ${(e as Error).message}`);
            }
        }
    }
}

interface QueueFile {
    name: string;
    path: string;
    time: number;
}

// Per-agent processing chains - ensures messages to same agent are sequential
const agentProcessingChains = new Map<string, Promise<void>>();

/**
 * Peek at a message file to determine which agent it's routed to.
 * Also resolves team IDs to their leader agent.
 */
function peekAgentId(filePath: string): string {
    try {
        const messageData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const settings = getSettings();
        const agents = getAgents(settings);
        const teams = getTeams(settings);

        // Check for pre-routed agent
        if (messageData.agent && agents[messageData.agent]) {
            return messageData.agent;
        }

        // Parse @agent_id or @team_id prefix
        const routing = parseAgentRouting(messageData.message || '', agents, teams);
        return routing.agentId || 'default';
    } catch {
        return 'default';
    }
}

// Main processing loop
async function processQueue(): Promise<void> {
    try {
        // Get all files from incoming queue, sorted by timestamp
        const files: QueueFile[] = fs.readdirSync(QUEUE_INCOMING)
            .filter(f => f.endsWith('.json'))
            .map(f => ({
                name: f,
                path: path.join(QUEUE_INCOMING, f),
                time: fs.statSync(path.join(QUEUE_INCOMING, f)).mtimeMs
            }))
            .sort((a, b) => a.time - b.time);

        if (files.length > 0) {
            log('DEBUG', `Found ${files.length} message(s) in queue`);

            // Process messages in parallel by agent (sequential within each agent)
            for (const file of files) {
                // Determine target agent
                const agentId = peekAgentId(file.path);

                // Get or create promise chain for this agent
                const currentChain = agentProcessingChains.get(agentId) || Promise.resolve();

                // Chain this message to the agent's promise
                const newChain = currentChain
                    .then(() => processMessage(file.path))
                    .catch(error => {
                        log('ERROR', `Error processing message for agent ${agentId}: ${error.message}`);
                    });

                // Update the chain
                agentProcessingChains.set(agentId, newChain);

                // Clean up completed chains to avoid memory leaks
                newChain.finally(() => {
                    if (agentProcessingChains.get(agentId) === newChain) {
                        agentProcessingChains.delete(agentId);
                    }
                });
            }
        }
    } catch (error) {
        log('ERROR', `Queue processing error: ${(error as Error).message}`);
    }
}

// Log agent and team configuration on startup
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

// Ensure events dir exists
if (!fs.existsSync(EVENTS_DIR)) {
    fs.mkdirSync(EVENTS_DIR, { recursive: true });
}

// Main loop
log('INFO', 'Queue processor started');
log('INFO', `Watching: ${QUEUE_INCOMING}`);
logAgentConfig();
emitEvent('processor_start', { agents: Object.keys(getAgents(getSettings())), teams: Object.keys(getTeams(getSettings())) });

// Process queue every 1 second
setInterval(processQueue, 1000);

// Graceful shutdown
process.on('SIGINT', () => {
    log('INFO', 'Shutting down queue processor...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('INFO', 'Shutting down queue processor...');
    process.exit(0);
});
