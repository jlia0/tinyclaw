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

import fs from 'fs';
import path from 'path';
import { MessageData, ResponseData, QueueFile, ChainStep, TeamConfig } from './lib/types';
import {
    QUEUE_INCOMING, QUEUE_OUTGOING, QUEUE_PROCESSING,
    LOG_FILE, RESET_FLAG, EVENTS_DIR, CHATS_DIR,
    getSettings, getAgents, getTeams
} from './lib/config';
import { log, emitEvent } from './lib/logging';
import { parseAgentRouting, findTeamForAgent, getAgentResetFlag, extractTeammateMentions } from './lib/routing';
import { invokeAgent } from './lib/invoke';

// Ensure directories exist
[QUEUE_INCOMING, QUEUE_OUTGOING, QUEUE_PROCESSING, path.dirname(LOG_FILE)].forEach(dir => {
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
                const providerLabel = provider === 'openai' ? 'Codex' : provider === 'opencode' ? 'OpenCode' : 'Claude';
                log('ERROR', `${providerLabel} error (agent: ${agentId}): ${(error as Error).message}`);
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

                            emitEvent('chain_step_start', { teamId: teamContext!.teamId, step: chainSteps.length + 1, agentId: mention.teammateId, agentName: mAgent.name });

                            let mResponse: string;
                            try {
                                const mMessage = `[Message from teammate @${currentAgentId}]:\n${mention.message}`;
                                mResponse = await invokeAgent(mAgent, mention.teammateId, mMessage, workspacePath, mShouldReset, agents, teams);
                            } catch (error) {
                                log('ERROR', `Fan-out error (agent: ${mention.teammateId}): ${(error as Error).message}`);
                                mResponse = "Sorry, I encountered an error processing this request.";
                            }

                            emitEvent('chain_step_done', { teamId: teamContext!.teamId, step: chainSteps.length + 1, agentId: mention.teammateId, responseLength: mResponse.length, responseText: mResponse });
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
