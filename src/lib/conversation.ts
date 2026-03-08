import fs from 'fs';
import path from 'path';
import { Conversation } from './types';
import { CHATS_DIR, getSettings, getAgents } from './config';
import { emitEvent } from './events';
import { createLogger, excerptText, isDebugEnabled, logError } from './logging';
import { enqueueMessage, enqueueResponse } from './db';
import { handleLongResponse, collectFiles } from './response';

// Active conversations — tracks in-flight team message passing
export const conversations = new Map<string, Conversation>();
const logger = createLogger({ runtime: 'queue', source: 'queue', component: 'conversation' });

export const MAX_CONVERSATION_MESSAGES = 50;

// Per-conversation locks to prevent race conditions
const conversationLocks = new Map<string, Promise<void>>();

/**
 * Execute a function with exclusive access to a conversation.
 * This prevents race conditions when multiple agents complete simultaneously.
 */
export async function withConversationLock<T>(
    convId: string,
    fn: () => Promise<T>
): Promise<T> {
    const currentLock = conversationLocks.get(convId) || Promise.resolve();

    let resolveLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
        resolveLock = resolve;
    });

    const newLock = currentLock.then(async () => {
        try {
            return await fn();
        } finally {
            resolveLock();
        }
    });

    conversationLocks.set(convId, lockPromise);

    newLock.finally(() => {
        if (conversationLocks.get(convId) === lockPromise) {
            conversationLocks.delete(convId);
        }
    });

    return newLock;
}

/**
 * Safely increment the pending counter for a conversation.
 */
export function incrementPending(conv: Conversation, count: number): void {
    conv.pending += count;
    logger.debug({ conversationId: conv.id, context: { pending: conv.pending, increment: count } }, 'Conversation pending incremented');
}

/**
 * Safely decrement the pending counter and check if conversation should complete.
 * Returns true if pending reached 0 and conversation should complete.
 */
export function decrementPending(conv: Conversation): boolean {
    conv.pending--;
    logger.debug({ conversationId: conv.id, context: { pending: conv.pending } }, 'Conversation pending decremented');

    if (conv.pending < 0) {
        logger.warn({ conversationId: conv.id, context: { pending: conv.pending } }, 'Conversation pending went negative, resetting to 0');
        conv.pending = 0;
    }

    return conv.pending === 0;
}

/**
 * Enqueue an internal (agent-to-agent) message into the SQLite queue.
 */
export function enqueueInternalMessage(
    conversationId: string,
    fromAgent: string,
    targetAgent: string,
    message: string,
    originalData: { channel: string; sender: string; senderId?: string | null; messageId: string }
): void {
    const messageId = `internal_${conversationId}_${targetAgent}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    enqueueMessage({
        channel: originalData.channel,
        sender: originalData.sender,
        senderId: originalData.senderId ?? undefined,
        message,
        messageId,
        agent: targetAgent,
        conversationId,
        fromAgent,
    });
    const bindings: Record<string, unknown> = {
        conversationId,
        messageId,
        fromAgent,
        toAgent: targetAgent,
        channel: originalData.channel,
    };
    if (isDebugEnabled(logger)) {
        bindings.excerpt = excerptText(message);
    }
    logger.info(bindings, 'Enqueued internal message');
}

/**
 * Complete a conversation: aggregate responses, write to outgoing queue, save chat history.
 */
export function completeConversation(conv: Conversation): void {
    const settings = getSettings();
    const agents = getAgents(settings);

    logger.info({
        conversationId: conv.id,
        channel: conv.channel,
        sender: conv.sender,
        teamId: conv.teamContext.teamId,
        context: { responseCount: conv.responses.length, totalMessages: conv.totalMessages },
    }, 'Conversation complete');
    emitEvent('team_chain_end', {
        teamId: conv.teamContext.teamId,
        totalSteps: conv.responses.length,
        agents: conv.responses.map(s => s.agentId),
    });

    // Aggregate responses
    let finalResponse: string;
    if (conv.responses.length === 1) {
        finalResponse = conv.responses[0].response;
    } else {
        finalResponse = conv.responses
            .map(step => `@${step.agentId}: ${step.response}`)
            .join('\n\n------\n\n');
    }

    // Save chat history
    try {
        const teamChatsDir = path.join(CHATS_DIR, conv.teamContext.teamId);
        if (!fs.existsSync(teamChatsDir)) {
            fs.mkdirSync(teamChatsDir, { recursive: true });
        }
        const chatLines: string[] = [];
        chatLines.push(`# Team Conversation: ${conv.teamContext.team.name} (@${conv.teamContext.teamId})`);
        chatLines.push(`**Date:** ${new Date().toISOString()}`);
        chatLines.push(`**Channel:** ${conv.channel} | **Sender:** ${conv.sender}`);
        chatLines.push(`**Messages:** ${conv.totalMessages}`);
        chatLines.push('');
        chatLines.push('------');
        chatLines.push('');
        chatLines.push(`## User Message`);
        chatLines.push('');
        chatLines.push(conv.originalMessage);
        chatLines.push('');
        for (let i = 0; i < conv.responses.length; i++) {
            const step = conv.responses[i];
            const stepAgent = agents[step.agentId];
            const stepLabel = stepAgent ? `${stepAgent.name} (@${step.agentId})` : `@${step.agentId}`;
            chatLines.push('------');
            chatLines.push('');
            chatLines.push(`## ${stepLabel}`);
            chatLines.push('');
            chatLines.push(step.response);
            chatLines.push('');
        }
        const now = new Date();
        const dateTime = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
        fs.writeFileSync(path.join(teamChatsDir, `${dateTime}.md`), chatLines.join('\n'));
        logger.info({ conversationId: conv.id, teamId: conv.teamContext.teamId }, 'Chat history saved');
    } catch (e) {
        logError(logger, e, 'Failed to save chat history', { conversationId: conv.id, teamId: conv.teamContext.teamId });
    }

    // Detect file references
    finalResponse = finalResponse.trim();
    const outboundFilesSet = new Set<string>(conv.files);
    collectFiles(finalResponse, outboundFilesSet);
    const outboundFiles = Array.from(outboundFilesSet);

    // Remove [send_file: ...] tags
    if (outboundFiles.length > 0) {
        finalResponse = finalResponse.replace(/\[send_file:\s*[^\]]+\]/g, '').trim();
    }

    // Convert [@agent: ...] tags to readable format instead of stripping them
    finalResponse = finalResponse.replace(/\[@(\S+?):\s*([\s\S]*?)\]/g, '→ @$1: $2').trim();

    // Handle long responses — send as file attachment
    const { message: responseMessage, files: allFiles } = handleLongResponse(finalResponse, outboundFiles);

    // Write to outgoing queue
    enqueueResponse({
        channel: conv.channel,
        sender: conv.sender,
        message: responseMessage,
        originalMessage: conv.originalMessage,
        messageId: conv.messageId,
        conversationId: conv.id,
        files: allFiles.length > 0 ? allFiles : undefined,
    });

    logger.info({
        conversationId: conv.id,
        channel: conv.channel,
        sender: conv.sender,
        messageId: conv.messageId,
        teamId: conv.teamContext.teamId,
        context: { responseLength: finalResponse.length },
    }, 'Team response ready');
    emitEvent('response_ready', { channel: conv.channel, sender: conv.sender, responseLength: finalResponse.length, responseText: finalResponse, messageId: conv.messageId });

    // Clean up
    conversations.delete(conv.id);
}
