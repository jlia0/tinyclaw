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

import fs from "fs";
import path from "path";
import {
	CHATS_DIR,
	EVENTS_DIR,
	getAgents,
	getSandboxConfig,
	getSettings,
	getTeams,
	LOG_FILE,
	QUEUE_DEAD_LETTER,
	QUEUE_INCOMING,
	QUEUE_OUTGOING,
	QUEUE_PROCESSING,
	RESET_FLAG,
} from "./lib/config";
import { invokeAgent } from "./lib/invoke";
import { emitEvent, log } from "./lib/logging";
import {
	extractTeammateMentions,
	findTeamForAgent,
	getAgentResetFlag,
	parseAgentRouting,
} from "./lib/routing";
import { SandboxInvocationError, type SandboxPathMapping } from "./lib/runner";
import type {
	ChainStep,
	MessageData,
	QueueFile,
	ResponseData,
	TeamConfig,
} from "./lib/types";

// Ensure directories exist
[
	QUEUE_INCOMING,
	QUEUE_OUTGOING,
	QUEUE_PROCESSING,
	QUEUE_DEAD_LETTER,
	path.dirname(LOG_FILE),
].forEach((dir) => {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
});

// Files currently queued in a promise chain — prevents duplicate processing across ticks
const queuedFiles = new Set<string>();

// Recover orphaned files from processing/ on startup (crash recovery)
function recoverOrphanedFiles() {
    for (const f of fs.readdirSync(QUEUE_PROCESSING).filter(f => f.endsWith('.json'))) {
        try {
            fs.renameSync(path.join(QUEUE_PROCESSING, f), path.join(QUEUE_INCOMING, f));
            log('INFO', `Recovered orphaned file: ${f}`);
        } catch (error) {
            log('ERROR', `Failed to recover orphaned file ${f}: ${(error as Error).message}`);
        }
    }
}

const HEARTBEAT_ERROR_DEDUPE_MS = 60_000;
const heartbeatErrorCache = new Map<string, number>();

function shouldLogHeartbeatError(message: string): boolean {
    const now = Date.now();
    const key = message.slice(0, 160);
    const lastSeen = heartbeatErrorCache.get(key) || 0;
    if ((now - lastSeen) < HEARTBEAT_ERROR_DEDUPE_MS) {
        return false;
    }
    heartbeatErrorCache.set(key, now);
    return true;
}

function toSafeErrorMessage(error: unknown): string {
    const text = (error as Error)?.message || String(error || 'Unknown error');
    return text.replace(/(ANTHROPIC_API_KEY|OPENAI_API_KEY)=\S+/g, '$1=[REDACTED]');
}

function resolveSandboxPath(filePath: string, pathMappings: SandboxPathMapping[]): string | null {
    const trimmed = filePath.trim();
    if (!path.isAbsolute(trimmed)) {
        return null;
    }
    if (fs.existsSync(trimmed)) {
        return trimmed;
    }

    for (const mapping of pathMappings) {
        const prefix = mapping.containerPrefix.endsWith(path.sep)
            ? mapping.containerPrefix
            : `${mapping.containerPrefix}${path.sep}`;
        if (trimmed === mapping.containerPrefix || trimmed.startsWith(prefix)) {
            const suffix = trimmed.slice(mapping.containerPrefix.length).replace(/^[\\/]/, '');
            const hostPath = suffix ? path.join(mapping.hostPrefix, suffix) : mapping.hostPrefix;
            if (fs.existsSync(hostPath)) {
                return hostPath;
            }
        }
    }

    return null;
}

function parseOutboundFiles(
    responseText: string,
    pathMappings: SandboxPathMapping[]
): { cleanText: string; files: string[]; missing: string[] } {
    const fileRefRegex = /\[send_file:\s*([^\]]+)\]/g;
    const files = new Set<string>();
    const missing: string[] = [];
    let match: RegExpExecArray | null;

    while (true) {
        match = fileRefRegex.exec(responseText);
        if (!match) break;
        const rawPath = match[1].trim();
        const resolved = resolveSandboxPath(rawPath, pathMappings);
        if (resolved) {
            files.add(resolved);
        } else {
            missing.push(rawPath);
        }
    }

    const cleanText = responseText.replace(fileRefRegex, '').trim();
    return { cleanText, files: Array.from(files), missing };
}

function writeOutgoingResponse(
    channel: string,
    sender: string,
    message: string,
    originalMessage: string,
    messageId: string,
    agentId?: string,
    files?: string[]
): void {
    const responseData: ResponseData = {
        channel,
        sender,
        message,
        originalMessage,
        timestamp: Date.now(),
        messageId,
        agent: agentId,
        files: files && files.length > 0 ? files : undefined,
    };

    const responseFile = channel === 'heartbeat'
        ? path.join(QUEUE_OUTGOING, `${messageId}.json`)
        : path.join(QUEUE_OUTGOING, `${channel}_${messageId}_${Date.now()}.json`);

    fs.writeFileSync(responseFile, JSON.stringify(responseData, null, 2));
}

function writeDeadLetter(
    processingFile: string,
    payload: MessageData | null,
    errorClass: 'terminal' | 'transient',
    errorMessage: string,
    attempt: number,
    maxAttempts: number
): void {
    const base = path.basename(processingFile, '.json');
    const deadLetterFile = path.join(QUEUE_DEAD_LETTER, `${base}_${Date.now()}.json`);
    const deadLetterData = {
        failedAt: new Date().toISOString(),
        errorClass,
        errorMessage,
        attempt,
        maxAttempts,
        payload,
    };
    fs.writeFileSync(deadLetterFile, JSON.stringify(deadLetterData, null, 2));
    log('ERROR', `Moved message to dead-letter queue: ${path.basename(deadLetterFile)}`);
}

// Process a single message
async function processMessage(messageFile: string): Promise<void> {
    const processingFile = path.join(QUEUE_PROCESSING, path.basename(messageFile));
    let messageData: MessageData | null = null;
    let settings = getSettings();
    let agentIdForError: string | undefined;
    let rawMessageForError = '';
    let senderForError = '';
    let channelForError = '';
    let messageIdForError = '';

    try {
        // Move to processing to mark as in-progress
        fs.renameSync(messageFile, processingFile);

        // Read message
        const parsedMessageData: MessageData = JSON.parse(fs.readFileSync(processingFile, 'utf8'));
        messageData = parsedMessageData;
        const { channel, sender, message: rawMessage, timestamp, messageId } = parsedMessageData;
        rawMessageForError = rawMessage;
        senderForError = sender;
        channelForError = channel;
        messageIdForError = messageId;

        if (!parsedMessageData.firstSeenAt) {
            parsedMessageData.firstSeenAt = timestamp || Date.now();
        }
        if (!parsedMessageData.attempt) {
            parsedMessageData.attempt = 0;
        }

        log('INFO', `Processing [${channel}] from ${sender}: ${rawMessage.substring(0, 50)}...`);
        emitEvent('message_received', { channel, sender, message: rawMessage.substring(0, 120), messageId });

        // Get settings, agents, and teams
        settings = getSettings();
        const agents = getAgents(settings);
        const teams = getTeams(settings);

        // Get workspace path from settings
        const workspacePath = settings?.workspace?.path || path.join(require('os').homedir(), 'tinyclaw-workspace');

        // Route message to agent (or team)
        let agentId: string;
        let message: string;
        let isTeamRouted = false;

        if (parsedMessageData.agent && agents[parsedMessageData.agent]) {
            // Pre-routed by channel client
            agentId = parsedMessageData.agent;
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
            writeOutgoingResponse(channel, sender, message, rawMessage, messageId);
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
        agentIdForError = agentId;

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

        let finalResponse = '';
        const allPathMappings: SandboxPathMapping[] = [];

        if (!teamContext) {
            // No team context — single agent invocation (backward compatible)
            const result = await invokeAgent(agent, agentId, message, workspacePath, shouldReset, agents, teams, settings);
            finalResponse = result.response;
            allPathMappings.push(...result.pathMappings);
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

                const stepResult = await invokeAgent(
                    currentAgent,
                    currentAgentId,
                    currentMessage,
                    workspacePath,
                    currentShouldReset,
                    agents,
                    teams,
                    settings
                );
                const stepResponse = stepResult.response;
                allPathMappings.push(...stepResult.pathMappings);

                chainSteps.push({ agentId: currentAgentId, response: stepResponse });
                emitEvent('chain_step_done', { teamId: teamContext.teamId, step: chainSteps.length, agentId: currentAgentId, responseLength: stepResponse.length, responseText: stepResponse });

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

                            emitEvent('chain_step_start', { teamId: teamContext!.teamId, step: chainSteps.length + 1, agentId: mention.teammateId, agentName: mAgent.name });

                            const mMessage = `[Message from teammate @${currentAgentId}]:\n${mention.message}`;
                            const mResult = await invokeAgent(
                                mAgent,
                                mention.teammateId,
                                mMessage,
                                workspacePath,
                                mShouldReset,
                                agents,
                                teams,
                                settings
                            );
                            const mResponse = mResult.response;
                            allPathMappings.push(...mResult.pathMappings);

                            emitEvent('chain_step_done', { teamId: teamContext!.teamId, step: chainSteps.length + 1, agentId: mention.teammateId, responseLength: mResponse.length, responseText: mResponse });
                            return { agentId: mention.teammateId, response: mResponse };
                        })
                    );

                    for (const result of fanOutResults) {
                        chainSteps.push(result);
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

            // Write chain chat history to .tinyclaw/chats
            try {
                const teamChatsDir = path.join(CHATS_DIR, teamContext.teamId);
                if (!fs.existsSync(teamChatsDir)) {
                    fs.mkdirSync(teamChatsDir, { recursive: true });
                }
                const chatLines: string[] = [];
                chatLines.push(`# Team Chain: ${teamContext.team.name} (@${teamContext.teamId})`);
                chatLines.push(`**Date:** ${new Date().toISOString()}`);
                chatLines.push(`**Channel:** ${channel} | **Sender:** ${sender}`);
                chatLines.push(`**Steps:** ${chainSteps.length}`);
                chatLines.push('');
                chatLines.push('---');
                chatLines.push('');
                chatLines.push(`## User Message`);
                chatLines.push('');
                chatLines.push(rawMessage);
                chatLines.push('');
                for (let i = 0; i < chainSteps.length; i++) {
                    const step = chainSteps[i];
                    const stepAgent = agents[step.agentId];
                    const stepLabel = stepAgent ? `${stepAgent.name} (@${step.agentId})` : `@${step.agentId}`;
                    chatLines.push('---');
                    chatLines.push('');
                    chatLines.push(`## Step ${i + 1}: ${stepLabel}`);
                    chatLines.push('');
                    chatLines.push(step.response);
                    chatLines.push('');
                }
                const now = new Date();
                const dateTime = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
                const chatFilename = `${dateTime}.md`;
                fs.writeFileSync(path.join(teamChatsDir, chatFilename), chatLines.join('\n'));
                log('INFO', `Chain chat history saved to ${chatFilename}`);
            } catch (e) {
                log('ERROR', `Failed to save chain chat history: ${(e as Error).message}`);
            }
        }

        // Detect file references in the response: [send_file: /path/to/file]
        finalResponse = finalResponse.trim();
        const parsedFiles = parseOutboundFiles(finalResponse, allPathMappings);
        finalResponse = parsedFiles.cleanText;
        if (parsedFiles.missing.length > 0) {
            const shown = parsedFiles.missing.slice(0, 3).map(f => `- ${f}`).join('\n');
            finalResponse = `${finalResponse}\n\n[Warning: Some files could not be found for attachment]\n${shown}`.trim();
        }

        // Limit response length after tags are parsed and removed
        if (finalResponse.length > 4000) {
            finalResponse = finalResponse.substring(0, 3900) + '\n\n[Response truncated...]';
        }

        writeOutgoingResponse(
            channel,
            sender,
            finalResponse,
            rawMessage,
            messageId,
            agentId,
            parsedFiles.files
        );

        log('INFO', `✓ Response ready [${channel}] ${sender} via agent:${agentId} (${finalResponse.length} chars)`);
        emitEvent('response_ready', { channel, sender, agentId, responseLength: finalResponse.length, responseText: finalResponse, messageId });

        // Clean up processing file
        fs.unlinkSync(processingFile);

    } catch (error) {
        const safeError = toSafeErrorMessage(error);
        const errorClass = error instanceof SandboxInvocationError ? error.classification : 'transient';
        const shouldLog = channelForError !== 'heartbeat' || shouldLogHeartbeatError(`${errorClass}:${safeError}`);
        if (shouldLog) {
            log('ERROR', `Processing error [${errorClass}]: ${safeError}`);
        }

        const maxAttempts = getSandboxConfig(settings).max_attempts;
        const attempt = (messageData?.attempt || 0) + 1;
        const terminal = errorClass === 'terminal';
        const exceededRetries = attempt >= maxAttempts;

        // Retry transient errors up to max attempts.
        if (!terminal && !exceededRetries && messageData && fs.existsSync(processingFile)) {
            try {
                messageData.attempt = attempt;
                messageData.errorClass = 'transient';
                if (!messageData.firstSeenAt) messageData.firstSeenAt = Date.now();
                fs.writeFileSync(processingFile, JSON.stringify(messageData, null, 2));
                fs.renameSync(processingFile, messageFile);
                log('WARN', `Retry scheduled for ${path.basename(messageFile)} (${attempt}/${maxAttempts})`);
                return;
            } catch (e) {
                log('ERROR', `Failed to schedule retry: ${(e as Error).message}`);
            }
        }

        // Terminal failures and max retry exhaustion are dead-lettered.
        writeDeadLetter(
            processingFile,
            messageData,
            terminal ? 'terminal' : 'transient',
            safeError,
            attempt,
            maxAttempts
        );

        const userMessage = error instanceof SandboxInvocationError
            ? error.userMessage
            : (terminal
                ? 'Sandbox execution failed due to a configuration error. Run "tinyclaw sandbox doctor".'
                : 'Sorry, I encountered repeated execution failures and moved this message to the dead-letter queue.');

        if (messageData && channelForError && senderForError && messageIdForError) {
            try {
                writeOutgoingResponse(
                    channelForError,
                    senderForError,
                    userMessage,
                    rawMessageForError || messageData.message,
                    messageIdForError,
                    agentIdForError
                );
                emitEvent('response_ready', {
                    channel: channelForError,
                    sender: senderForError,
                    agentId: agentIdForError,
                    responseLength: userMessage.length,
                    responseText: userMessage,
                    messageId: messageIdForError,
                });
            } catch (writeErr) {
                log('ERROR', `Failed to write terminal error response: ${(writeErr as Error).message}`);
            }
        }

        if (fs.existsSync(processingFile)) {
            fs.unlinkSync(processingFile);
        }
    }
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
                // Skip files already queued in a promise chain
                if (queuedFiles.has(file.name)) continue;
                queuedFiles.add(file.name);

                // Determine target agent
                const agentId = peekAgentId(file.path);

                // Get or create promise chain for this agent
                const currentChain = agentProcessingChains.get(agentId) || Promise.resolve();

                // Chain this message to the agent's promise
                const newChain = currentChain
                    .then(() => processMessage(file.path))
                    .catch(error => {
                        log('ERROR', `Error processing message for agent ${agentId}: ${error.message}`);
                    })
                    .finally(() => {
                        queuedFiles.delete(file.name);
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
recoverOrphanedFiles();
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
