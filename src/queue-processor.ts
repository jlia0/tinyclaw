#!/usr/bin/env node
/**
 * Queue Processor - Handles messages from all channels (WhatsApp, Telegram, etc.)
 *
 * Supports multi-agent routing:
 *   - Messages prefixed with @agent_id are routed to that agent
 *   - Unrouted messages go to the "default" agent
 *   - Each agent has its own provider, model, working directory, and system prompt
 *   - Conversation isolation via per-agent working directories
 *
 * Team conversations use queue-based message passing:
 *   - Agent mentions ([@teammate: message]) become new messages in the queue
 *   - Each agent processes messages naturally via its own promise chain
 *   - Conversations complete when all branches resolve (no more pending mentions)
 * 
 * PARALLEL PROCESSING:
 *   - Messages are processed concurrently (not sequentially per agent)
 *   - invokeAgent is fire-and-forget; responses handled asynchronously
 *   - This prevents "freezing" when one message takes a long time
 */

import fs from 'fs';
import path from 'path';
import { MessageData, Conversation, TeamConfig, AgentConfig } from './lib/types';
import {
    LOG_FILE, CHATS_DIR, FILES_DIR, WORKSPACE_DEFAULT_PATH,
    getSettings, getAgents, getTeams
} from './lib/config';
import { log, emitEvent } from './lib/logging';
import { parseAgentRouting, findTeamForAgent, getAgentResetFlag, extractTeammateMentions } from './lib/routing';
import { invokeAgent } from './lib/invoke';
import { loadPlugins, runIncomingHooks, runOutgoingHooks } from './lib/plugins';
import { startApiServer } from './server';
import {
    initQueueDb, claimNextMessage, completeMessage as dbCompleteMessage,
    failMessage, enqueueResponse, getPendingAgents, recoverStaleMessages,
    pruneAckedResponses, pruneCompletedMessages, recoverStaleConversations, getStaleConversations, closeQueueDb, queueEvents, DbMessage,
    // NEW: Conversation persistence functions
    persistConversation, persistResponse, decrementPendingInDb, incrementPendingInDb,
    incrementTotalMessages, markConversationCompleted, loadActiveConversations,
    loadConversationResponses, loadPendingAgents, addPendingAgent, removePendingAgent,
    pruneOldConversations,
    // NEW: Outstanding request tracking
    getRequestsNeedingRetry, getRequestsNeedingEscalation, incrementRequestRetry,
    escalateRequest, acknowledgeRequest, respondToRequest,
    getPendingRequestsForConversation, pruneOldRequests, failRequest,
} from './lib/db';
import { handleLongResponse, collectFiles } from './lib/response';
import {
    conversations, MAX_CONVERSATION_MESSAGES, enqueueInternalMessage, completeConversation,
    withConversationLock,
} from './lib/conversation';
import { startHeartbeat, stopHeartbeat } from './lib/heartbeat';

// Ensure directories exist
[FILES_DIR, path.dirname(LOG_FILE), CHATS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Constants for validation
const MAX_MESSAGE_SIZE = 1024 * 1024; // 1MB - Claude API limit

/**
 * Validate message before sending to agent.
 * Returns error message if invalid, null if valid.
 */
function validateMessage(message: string): string | null {
    if (message.length > MAX_MESSAGE_SIZE) {
        return `Message too large: ${message.length} bytes (max ${MAX_MESSAGE_SIZE} bytes)`;
    }
    return null;
}

/**
 * Handle a simple (non-team) response asynchronously.
 * This function is called when invokeAgent completes, without blocking the queue.
 */
async function handleSimpleResponse(
    dbMsg: DbMessage,
    agentId: string,
    response: string
): Promise<void> {
    try {
        const channel = dbMsg.channel;
        const sender = dbMsg.sender;
        const rawMessage = dbMsg.message;

        let finalResponse = response.trim();

        // Detect files
        const outboundFilesSet = new Set<string>();
        collectFiles(finalResponse, outboundFilesSet);
        const outboundFiles = Array.from(outboundFilesSet);
        if (outboundFiles.length > 0) {
            finalResponse = finalResponse.replace(/\[send_file:\s*[^\]]+\]/g, '').trim();
        }

        // Run outgoing hooks
        const { text: hookedResponse, metadata } = await runOutgoingHooks(
            finalResponse,
            { channel, sender, messageId: dbMsg.message_id, originalMessage: rawMessage }
        );

        // Handle long responses
        const { message: responseMessage, files: allFiles } = handleLongResponse(hookedResponse, outboundFiles);

        // Enqueue response
        enqueueResponse({
            channel,
            sender,
            senderId: dbMsg.sender_id ?? undefined,
            message: responseMessage,
            originalMessage: rawMessage,
            messageId: dbMsg.message_id,
            agent: agentId,
            files: allFiles.length > 0 ? allFiles : undefined,
            metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        });

        log('INFO', `✓ Response ready [${channel}] ${sender} via agent:${agentId} (${finalResponse.length} chars)`);
        await emitEvent('chain_step_done', {
            agentId,
            responseLength: finalResponse.length,
            responseText: finalResponse,
        });
        await emitEvent('response_ready', {
            channel, sender, agentId,
            responseLength: finalResponse.length,
            responseText: finalResponse,
            messageId: dbMsg.message_id
        });

        // Mark message completed
        dbCompleteMessage(dbMsg.id);

    } catch (error) {
        log('ERROR', `Error handling simple response: ${(error as Error).message}`);
        failMessage(dbMsg.id, (error as Error).message);
    }
}

/**
 * Handle a team response asynchronously.
 * Persists response to DB and manages conversation completion.
 */
async function handleTeamResponse(
    dbMsg: DbMessage,
    conv: Conversation,
    agentId: string,
    response: string,
    teams: Record<string, TeamConfig>,
    agents: Record<string, AgentConfig>
): Promise<void> {
    try {
        // Use conversation lock to prevent race conditions when multiple agents finish simultaneously
        // This prevents: lost updates to conv.totalMessages/pending, duplicate conversation completion
        await withConversationLock(conv.id, async () => {
            // Persist response to DB first (for restart recovery)
            persistResponse(conv.id, agentId, response);

            await emitEvent('chain_step_done', {
                agentId,
                responseLength: response.length,
                responseText: response,
            });

            // Update in-memory conversation
            conv.responses.push({ agentId, response });
            conv.totalMessages++;
            conv.pendingAgents.delete(agentId);
            collectFiles(response, conv.files);

            // Update DB counters
            incrementTotalMessages(conv.id);
            removePendingAgent(conv.id, agentId);

            // Check if this response completes outstanding requests
            // (i.e., this agent was asked to do things and is now responding)
            // Use filter() not find() - agent may have been asked multiple things
            const pendingRequests = getPendingRequestsForConversation(conv.id);
            const matchingRequests = pendingRequests.filter(r => r.to_agent === agentId && r.status === 'acked');
            for (const req of matchingRequests) {
                respondToRequest(req.request_id, response);
                log('INFO', `Request ${req.request_id} completed by @${agentId}`);
            }

            // Check for teammate mentions (agent asking other agents to do things)
            const teammateMentions = extractTeammateMentions(
                response, agentId, conv.teamContext.teamId, teams, agents
            );

            if (teammateMentions.length > 0 && conv.totalMessages < conv.maxMessages) {
                // Enqueue internal messages
                incrementPendingInDb(conv.id, teammateMentions.length);
                conv.pending += teammateMentions.length;

                for (const mention of teammateMentions) {
                    conv.pendingAgents.add(mention.teammateId);
                    addPendingAgent(conv.id, mention.teammateId);

                    log('INFO', `@${agentId} → @${mention.teammateId}`);
                    await emitEvent('chain_handoff', {
                        teamId: conv.teamContext.teamId,
                        fromAgent: agentId,
                        toAgent: mention.teammateId
                    });

                    const internalMsg = `[Message from teammate @${agentId} — respond using [@${agentId}: your reply]]:\n${mention.message}`;
                    enqueueInternalMessage(conv.id, agentId, mention.teammateId, internalMsg, {
                        channel: dbMsg.channel,
                        sender: dbMsg.sender,
                        senderId: dbMsg.sender_id ?? undefined,
                        messageId: dbMsg.message_id,
                    });
                }
            } else if (teammateMentions.length > 0) {
                log('WARN', `Conversation ${conv.id} hit max messages (${conv.maxMessages}) — not enqueuing further mentions`);
            }

            // Decrement pending and check completion
            const newPending = decrementPendingInDb(conv.id);
            conv.pending = newPending;

            if (newPending === 0) {
                // Load all responses from DB for completeness
                const dbResponses = loadConversationResponses(conv.id);
                conv.responses = dbResponses.map(r => ({ agentId: r.agent_id, response: r.response }));

                await completeConversation(conv);
                markConversationCompleted(conv.id);
                conversations.delete(conv.id);
            } else {
                // Persist updated conversation state
                persistConversation(conv);
                log('INFO', `Conversation ${conv.id}: ${newPending} branch(es) still pending`);
            }
        });

        // Mark message completed
        dbCompleteMessage(dbMsg.id);

    } catch (error) {
        log('ERROR', `Error handling team response: ${(error as Error).message}`);
        failMessage(dbMsg.id, (error as Error).message);
    }
}

/**
 * Handle an error from invokeAgent in a team context.
 * Still need to decrement pending and maybe complete the conversation.
 */
async function handleTeamError(
    dbMsg: DbMessage,
    conv: Conversation,
    agentId: string,
    error: Error
): Promise<void> {
    log('ERROR', `Agent ${agentId} error in conversation ${conv.id}: ${error.message}`);

    try {
        // Use conversation lock to prevent race conditions (same reason as handleTeamResponse)
        await withConversationLock(conv.id, async () => {
            // Record error as response
            const errorResponse = `Error: ${error.message}`;
            persistResponse(conv.id, agentId, errorResponse);
            conv.responses.push({ agentId, response: errorResponse });

            // Update counters
            removePendingAgent(conv.id, agentId);
            conv.pendingAgents.delete(agentId);

            // Mark outstanding requests as failed (both acked and pending)
            const pendingRequests = getPendingRequestsForConversation(conv.id);
            const matchingRequests = pendingRequests.filter(r => r.to_agent === agentId && (r.status === 'acked' || r.status === 'pending'));
            for (const req of matchingRequests) {
                failRequest(req.request_id, error.message);
            }

            // Decrement and check completion
            const newPending = decrementPendingInDb(conv.id);
            conv.pending = newPending;

            if (newPending === 0) {
                const dbResponses = loadConversationResponses(conv.id);
                conv.responses = dbResponses.map(r => ({ agentId: r.agent_id, response: r.response }));

                await completeConversation(conv);
                markConversationCompleted(conv.id);
                conversations.delete(conv.id);
            } else {
                persistConversation(conv);
            }
        });

        dbCompleteMessage(dbMsg.id);

    } catch (e) {
        log('ERROR', `Error in handleTeamError: ${(e as Error).message}`);
        failMessage(dbMsg.id, (e as Error).message);
    }
}

/**
 * Create a new conversation for team processing.
 */
function createNewConversation(
    dbMsg: DbMessage,
    teamContext: { teamId: string; team: TeamConfig }
): Conversation {
    const convId = `${dbMsg.message_id}_${Date.now()}`;
    return {
        id: convId,
        channel: dbMsg.channel,
        sender: dbMsg.sender,
        originalMessage: dbMsg.message,
        messageId: dbMsg.message_id,
        pending: 1,
        responses: [],
        files: new Set(),
        totalMessages: 0,
        maxMessages: MAX_CONVERSATION_MESSAGES,
        teamContext,
        startTime: Date.now(),
        outgoingMentions: new Map(),
        pendingAgents: new Set(),
    };
}

// Process a single message from the DB
async function processMessage(dbMsg: DbMessage): Promise<void> {
    try {
        const channel = dbMsg.channel;
        const sender = dbMsg.sender;
        const rawMessage = dbMsg.message;
        const messageId = dbMsg.message_id;
        const isInternal = !!dbMsg.conversation_id;
        const files: string[] = dbMsg.files ? JSON.parse(dbMsg.files) : [];

        // Build a MessageData-like object for compatibility
        const messageData: MessageData = {
            channel,
            sender,
            senderId: dbMsg.sender_id ?? undefined,
            message: rawMessage,
            timestamp: dbMsg.created_at,
            messageId,
            agent: dbMsg.agent ?? undefined,
            files: files.length > 0 ? files : undefined,
            conversationId: dbMsg.conversation_id ?? undefined,
            fromAgent: dbMsg.from_agent ?? undefined,
        };

        log('INFO', `Processing [${isInternal ? 'internal' : channel}] ${isInternal ? `@${dbMsg.from_agent}→@${dbMsg.agent}` : `from ${sender}`}: ${rawMessage.substring(0, 50)}...`);
        if (!isInternal) {
            emitEvent('message_received', { channel, sender, message: rawMessage.substring(0, 120), messageId }).catch(err => log('ERROR', `emitEvent error: ${(err as Error).message}`));
        }

        // Get settings, agents, and teams
        const settings = getSettings();
        const agents = getAgents(settings);
        const teams = getTeams(settings);

        // Get workspace path from settings
        const workspacePath = settings?.workspace?.path || WORKSPACE_DEFAULT_PATH;

        // Route message to agent (or team)
        let agentId: string;
        let message: string;
        let isTeamRouted = false;

        if (messageData.agent && agents[messageData.agent]) {
            // Pre-routed (by channel client or internal message)
            agentId = messageData.agent;
            message = rawMessage;
        } else {
            // Parse @agent or @team prefix
            const routing = parseAgentRouting(rawMessage, agents, teams);
            agentId = routing.agentId;
            message = routing.message;
            isTeamRouted = !!routing.isTeam;
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
        
        // Extract and acknowledge request_id if present (for agent handoff tracking)
        const requestMatch = message.match(/^\[REQUEST:([^\]]+)\]\n?/);
        if (requestMatch) {
            const requestId = requestMatch[1];
            if (acknowledgeRequest(requestId)) {
                log('INFO', `Request ${requestId} acknowledged by @${agentId}`);
            }
            // Remove request prefix from message before sending to agent
            message = message.replace(requestMatch[0], '');
        }
        
        log('INFO', `Routing to agent: ${agent.name} (${agentId}) [${agent.provider}/${agent.model}]`);
        if (!isInternal) {
            emitEvent('agent_routed', { agentId, agentName: agent.name, provider: agent.provider, model: agent.model, isTeamRouted }).catch(err => log('ERROR', `emitEvent error: ${(err as Error).message}`));
        }

        // Determine team context
        let teamContext: { teamId: string; team: TeamConfig } | null = null;
        if (isInternal) {
            // Internal messages inherit team context from their conversation
            const conv = conversations.get(messageData.conversationId!);
            if (conv) teamContext = conv.teamContext;
        } else {
            if (isTeamRouted) {
                for (const [tid, t] of Object.entries(teams)) {
                    if (t.leader_agent === agentId && t.agents.includes(agentId)) {
                        teamContext = { teamId: tid, team: t };
                        break;
                    }
                }
            }
            if (!teamContext) {
                teamContext = findTeamForAgent(agentId, teams);
            }
        }

        // Check for per-agent reset
        const agentResetFlag = getAgentResetFlag(agentId, workspacePath);
        const shouldReset = fs.existsSync(agentResetFlag);

        if (shouldReset) {
            fs.unlinkSync(agentResetFlag);
        }

        // For internal messages: append pending response indicator so the agent
        // knows other teammates are still processing and won't re-mention them.
        if (isInternal && messageData.conversationId) {
            const conv = conversations.get(messageData.conversationId);
            if (conv) {
                // Count agents that have been enqueued but haven't responded yet, excluding this agent
                const respondedAgents = new Set(conv.responses.map(r => r.agentId));
                const othersPending = [...conv.pendingAgents].filter(a => a !== agentId && !respondedAgents.has(a)).length;
                if (othersPending > 0) {
                    message += `\n\n------\n\n[${othersPending} other teammate response(s) are still being processed and will be delivered when ready. Do not re-mention teammates who haven't responded yet.]`;
                }
            }
        }

        // Run incoming hooks
        ({ text: message } = await runIncomingHooks(message, { channel, sender, messageId, originalMessage: rawMessage }));

        // Validate message size before invoking agent (applies to both team and non-team paths)
        const validationError = validateMessage(message);
        if (validationError) {
            log('ERROR', `Message validation failed: ${validationError}`);
            failMessage(dbMsg.id, validationError);
            return;
        }

        // Invoke agent
        await emitEvent('chain_step_start', { agentId, agentName: agent.name, fromAgent: messageData.fromAgent || null });

        // --- No team context: simple response to user ---
        if (!teamContext) {

            // Fire-and-forget: don't await invokeAgentSerial
            invokeAgentSerial(agent, agentId, message, workspacePath, shouldReset, agents, teams)
                .then(response => {
                    return handleSimpleResponse(dbMsg, agentId, response);
                })
                .catch(error => {
                    const provider = agent.provider || 'anthropic';
                    const providerLabel = provider === 'openai' ? 'Codex' : provider === 'opencode' ? 'OpenCode' : 'Claude';
                    log('ERROR', `${providerLabel} error (agent: ${agentId}): ${(error as Error).message}`);
                    return handleSimpleResponse(dbMsg, agentId, "Sorry, I encountered an error processing your request. Please check the queue logs.");
                });

            // Return immediately - don't block queue
            return;
        }

        // --- Team context: conversation-based message passing ---

        // Get or create conversation
        let conv: Conversation;
        if (isInternal && messageData.conversationId && conversations.has(messageData.conversationId)) {
            conv = conversations.get(messageData.conversationId)!;
        } else if (isInternal && messageData.conversationId) {
            // Try to load from DB (restart recovery case)
            const dbConv = loadActiveConversations().find(c => c.id === messageData.conversationId);
            if (dbConv) {
                const team = teams[dbConv.team_id];
                if (team) {
                    conv = {
                        id: dbConv.id,
                        channel: dbConv.channel,
                        sender: dbConv.sender,
                        originalMessage: dbConv.original_message,
                        messageId: dbConv.message_id,
                        pending: dbConv.pending_count,
                        responses: loadConversationResponses(dbConv.id).map(r => ({ agentId: r.agent_id, response: r.response })),
                        files: new Set(),
                        totalMessages: dbConv.total_messages,
                        maxMessages: dbConv.max_messages,
                        teamContext: { teamId: dbConv.team_id, team },
                        startTime: dbConv.start_time,
                        outgoingMentions: new Map(),
                        pendingAgents: new Set(loadPendingAgents(dbConv.id)),
                    };
                    conversations.set(conv.id, conv);
                } else {
                    log('ERROR', `Team ${dbConv.team_id} not found for conversation ${dbConv.id}`);
                    failMessage(dbMsg.id, 'Team not found');
                    return;
                }
            } else {
                log('ERROR', `Conversation ${messageData.conversationId} not found`);
                failMessage(dbMsg.id, 'Conversation not found');
                return;
            }
        } else {
            // New conversation
            conv = createNewConversation(dbMsg, teamContext);
            conversations.set(conv.id, conv);
            persistConversation(conv);  // Persist immediately
            log('INFO', `Conversation started: ${conv.id} (team: ${teamContext.team.name})`);
            await emitEvent('team_chain_start', { teamId: teamContext.teamId, teamName: teamContext.team.name, agents: teamContext.team.agents, leader: teamContext.team.leader_agent });
        }

        // Fire-and-forget: don't await invokeAgentSerial
        invokeAgentSerial(agent, agentId, message, workspacePath, shouldReset, agents, teams)
            .then(response => {
                return handleTeamResponse(dbMsg, conv, agentId, response, teams, agents);
            })
            .catch(error => {
                return handleTeamError(dbMsg, conv, agentId, error as Error);
            });

        // Return immediately - don't block queue

    } catch (error) {
        log('ERROR', `Processing error: ${(error as Error).message}`);
        failMessage(dbMsg.id, (error as Error).message);
    }
}

// REMOVED: agentProcessingChains - no longer needed with parallel processing
// Previously this enforced sequential processing per agent, causing "freezes"
// when one message took a long time.

// Per-agent invocation lock to prevent concurrent `claude -c` corruption
// Each agent can only have one invokeAgent call at a time, but responses
// are still handled asynchronously (parallel response processing)
const agentInvocationLocks = new Map<string, Promise<unknown>>();

function invokeAgentSerial(
    agent: AgentConfig,
    agentId: string,
    message: string,
    workspacePath: string,
    shouldReset: boolean,
    agents: Record<string, AgentConfig>,
    teams: Record<string, TeamConfig>
): Promise<string> {
    const prev = agentInvocationLocks.get(agentId) ?? Promise.resolve();
    const next = prev
        .then(() => invokeAgent(agent, agentId, message, workspacePath, shouldReset, agents, teams))
        .catch(e => { throw e; });
    // Store the chain (catch to prevent unhandled rejection from breaking the lock)
    agentInvocationLocks.set(agentId, next.catch(() => {}));
    return next;
}

// Main processing loop
async function processQueue(): Promise<void> {
    try {
        // Get all agents with pending messages
        const pendingAgents = getPendingAgents();

        if (pendingAgents.length === 0) return;

        for (const agentId of pendingAgents) {
            // Claim next message for this agent
            const dbMsg = claimNextMessage(agentId);
            if (!dbMsg) continue;

            // Process immediately - don't chain promises
            // Fire-and-forget, errors handled in processMessage
            processMessage(dbMsg).catch(error => {
                log('ERROR', `Error processing message for agent ${agentId}: ${error.message}`);
            });
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

// ─── Start ──────────────────────────────────────────────────────────────────

// Initialize SQLite queue
initQueueDb();

// Recover stale messages from previous crash
const recovered = recoverStaleMessages();
if (recovered > 0) {
    log('INFO', `Recovered ${recovered} stale message(s) from previous session`);
}

// Recover stale conversations that are stuck in 'active' state
const staleConvDetails = getStaleConversations();
if (staleConvDetails.length > 0) {
    log('WARN', `🔴 CRASH RECOVERY: ${staleConvDetails.length} conversation(s) stuck for 10+ min, marking completed (DATA LOSS RISK)`);
    staleConvDetails.forEach(conv => {
        log('WARN', `  - Team ${conv.teamId}, Conv ${conv.id}: stuck for ${(conv.duration / 60000).toFixed(1)} min`);
        emitEvent('crash_recovery', {
            conversationId: conv.id,
            teamId: conv.teamId,
            stuckForMs: conv.duration,
            recoveredAt: new Date().toISOString(),
        }).catch(err => log('ERROR', `emitEvent error: ${(err as Error).message}`));
    });
}
const staleConvs = recoverStaleConversations();

// Start heartbeat monitoring
startHeartbeat();

// NEW: Recover active conversations from DB
async function recoverConversations(): Promise<void> {
    const activeConvs = loadActiveConversations();
    if (activeConvs.length === 0) return;

    log('INFO', `Recovering ${activeConvs.length} active conversation(s) from DB`);

    const settings = getSettings();
    const teams = getTeams(settings);

    for (const dbConv of activeConvs) {
        try {
            const team = teams[dbConv.team_id];
            if (!team) {
                log('WARN', `Team ${dbConv.team_id} not found for conversation ${dbConv.id}, marking error`);
                markConversationCompleted(dbConv.id);  // Mark as completed to clear it
                continue;
            }

            const conv: Conversation = {
                id: dbConv.id,
                channel: dbConv.channel,
                sender: dbConv.sender,
                originalMessage: dbConv.original_message,
                messageId: dbConv.message_id,
                pending: dbConv.pending_count,
                responses: loadConversationResponses(dbConv.id).map(r => ({ agentId: r.agent_id, response: r.response })),
                files: new Set(),
                totalMessages: dbConv.total_messages,
                maxMessages: dbConv.max_messages,
                teamContext: { teamId: dbConv.team_id, team },
                startTime: dbConv.start_time,
                outgoingMentions: new Map(),
                pendingAgents: new Set(loadPendingAgents(dbConv.id)),
            };

            conversations.set(conv.id, conv);

            if (conv.pending === 0) {
                log('INFO', `Conversation ${conv.id} has no pending branches, completing`);
                await completeConversation(conv);
                markConversationCompleted(conv.id);
                conversations.delete(conv.id);
            } else {
                log('INFO', `Conversation ${conv.id} recovered with ${conv.pending} pending branch(es)`);
            }
        } catch (e) {
            log('ERROR', `Failed to recover conversation ${dbConv.id}: ${(e as Error).message}`);
        }
    }
}

// Start the API server (passes conversations for queue status reporting)
const apiServer = startApiServer(conversations);

// Load plugins and recover conversations (async IIFE to avoid top-level await)
(async () => {
    await recoverConversations();
    await loadPlugins();
    
    // Register event listener AFTER recovery completes to prevent race
    queueEvents.on('message:enqueued', () => processQueue());
    
    log('INFO', 'Queue processor started (SQLite-backed, parallel processing)');
    logAgentConfig();
    await emitEvent('processor_start', { agents: Object.keys(getAgents(getSettings())), teams: Object.keys(getTeams(getSettings())) });
})();

// Check outstanding request timeouts (ACK and response deadlines)
async function checkRequestTimeouts(): Promise<void> {
    // Find requests that need retry (no ACK within deadline)
    const needsRetry = getRequestsNeedingRetry();
    for (const req of needsRetry) {
        log('WARN', `Request ${req.request_id} to @${req.to_agent} not acknowledged, retry ${req.retry_count + 1}/${req.max_retries}`);
        
        // Increment retry and extend deadline
        const newDeadline = Date.now() + 5000; // 5 more seconds
        incrementRequestRetry(req.request_id, newDeadline);
        
        // Could resend message here if needed
        // For now, just log and extend deadline
    }
    
    // Find requests that need escalation (acked but no response within deadline)
    const needsEscalation = getRequestsNeedingEscalation();
    for (const req of needsEscalation) {
        log('ERROR', `Request ${req.request_id} to @${req.to_agent} timed out after ACK - no response received`);
        
        // Calculate timeout duration, fallback to created_at if acked_at is null (defensive)
        const timeoutMs = req.acked_at != null 
            ? req.response_deadline - req.acked_at 
            : req.response_deadline - req.created_at;
        
        escalateRequest(req.request_id, `No response within ${timeoutMs}ms`);
        
        emitEvent('request_escalated', {
            requestId: req.request_id,
            conversationId: req.conversation_id,
            fromAgent: req.from_agent,
            toAgent: req.to_agent,
            reason: 'response_timeout',
        }).catch(err => log('ERROR', `emitEvent error: ${(err as Error).message}`));
    }
}

// Periodic maintenance (every 5 minutes)
setInterval(() => {
    const msgCount = recoverStaleMessages();
    if (msgCount > 0) log('INFO', `Recovered ${msgCount} stale message(s)`);

    const convStaleDetails = getStaleConversations();
    if (convStaleDetails.length > 0) {
        log('WARN', `🔴 PERIODIC RECOVERY: ${convStaleDetails.length} conversation(s) marked completed (POSSIBLE DATA LOSS)`);
        convStaleDetails.forEach(conv => {
            emitEvent('crash_recovery', {
                conversationId: conv.id,
                teamId: conv.teamId,
                stuckForMs: conv.duration,
                source: 'periodic',
            }).catch(err => log('ERROR', `emitEvent error: ${(err as Error).message}`));
        });
    }
    const convCount = recoverStaleConversations();
}, 5 * 60 * 1000); // every 5 min

// Prune old requests hourly (consistent with other prune functions)
setInterval(() => {
    const prunedRequests = pruneOldRequests();
    if (prunedRequests > 0) log('INFO', `Pruned ${prunedRequests} old request(s)`);
}, 60 * 60 * 1000); // every 1 hour

// Check request timeouts more frequently (every 30 seconds)
setInterval(() => {
    checkRequestTimeouts().catch(err => {
        log('ERROR', `Error checking request timeouts: ${err.message}`);
    });
}, 30 * 1000); // every 30 seconds

setInterval(() => {
    // Clean up old conversations (TTL: 30 min)
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, conv] of conversations.entries()) {
        if (conv.startTime < cutoff) {
            log('WARN', `Conversation ${id} timed out after 30 min — cleaning up`);
            conversations.delete(id);
        }
    }
}, 30 * 60 * 1000); // every 30 min

setInterval(() => {
    const pruned = pruneAckedResponses();
    if (pruned > 0) log('INFO', `Pruned ${pruned} acked response(s)`);
}, 60 * 60 * 1000); // every 1 hr

setInterval(() => {
    const pruned = pruneCompletedMessages();
    if (pruned > 0) log('INFO', `Pruned ${pruned} completed message(s)`);
}, 60 * 60 * 1000); // every 1 hr

// NEW: Prune old conversations
setInterval(() => {
    const pruned = pruneOldConversations();
    if (pruned > 0) log('INFO', `Pruned ${pruned} old conversation(s)`);
}, 60 * 60 * 1000); // every 1 hr

// Graceful shutdown
process.on('SIGINT', () => {
    log('INFO', 'Shutting down queue processor...');
    stopHeartbeat();
    closeQueueDb();
    apiServer.close();
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('INFO', 'Shutting down queue processor...');
    stopHeartbeat();
    closeQueueDb();
    apiServer.close();
    process.exit(0);
});
