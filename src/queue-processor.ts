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
 */

import fs from 'fs';
import path from 'path';
import { MessageData, ResponseData, QueueFile, ChainStep, Conversation, TeamConfig } from './lib/types';
import {
    QUEUE_INCOMING, QUEUE_OUTGOING, QUEUE_PROCESSING,
    LOG_FILE, EVENTS_DIR, CHATS_DIR, FILES_DIR,
    getSettings, getAgents, getTeams
} from './lib/config';
import { log, emitEvent } from './lib/logging';
import { parseAgentRouting, findTeamForAgent, getAgentResetFlag, extractTeammateMentions } from './lib/routing';
import { invokeAgent, runCommand } from './lib/invoke';
import { jsonrepair } from 'jsonrepair';
import {
    SessionTurn,
    parseSessionTurns,
    buildPrefetchBlock,
    parseOpenVikingSearchHits,
    summarizeOpenVikingSearchHitDistribution,
    buildOpenVikingSearchPrefetchBlock,
    OpenVikingSearchHitDistribution,
} from './lib/openviking-prefetch';
import {
    buildOpenVikingSessionMapKey,
    getOpenVikingSessionId,
    upsertOpenVikingSessionId,
    deleteOpenVikingSessionId,
    OpenVikingSessionMapKey,
} from './lib/openviking-session-map';
import { ensureAgentDirectory } from './lib/agent-setup';

/** Parse JSON with automatic repair for malformed content (e.g. bad escapes). */
function safeParseJSON<T = unknown>(raw: string, label?: string): T {
    try {
        return JSON.parse(raw);
    } catch {
        log('WARN', `Invalid JSON${label ? ` in ${label}` : ''}, attempting auto-repair`);
        return JSON.parse(jsonrepair(raw));
    }
}

// Ensure directories exist
[QUEUE_INCOMING, QUEUE_OUTGOING, QUEUE_PROCESSING, FILES_DIR, path.dirname(LOG_FILE)].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Files currently queued in a promise chain — prevents duplicate processing across ticks
const queuedFiles = new Set<string>();

// Active conversations — tracks in-flight team message passing
const conversations = new Map<string, Conversation>();

const MAX_CONVERSATION_MESSAGES = 50;
const LONG_RESPONSE_THRESHOLD = 4000;
const OPENVIKING_AUTOSYNC_FALLBACK_ENABLED = process.env.TINYCLAW_OPENVIKING_AUTOSYNC !== '0';
const OPENVIKING_PREFETCH_ENABLED = process.env.TINYCLAW_OPENVIKING_PREFETCH !== '0';
const OPENVIKING_SESSION_NATIVE_ENABLED = process.env.TINYCLAW_OPENVIKING_SESSION_NATIVE === '1';
const OPENVIKING_SEARCH_NATIVE_ENABLED = process.env.TINYCLAW_OPENVIKING_SEARCH_NATIVE === '1';
const OPENVIKING_PREFETCH_TIMEOUT_MS = Number(process.env.TINYCLAW_OPENVIKING_PREFETCH_TIMEOUT_MS || 5000);
const OPENVIKING_COMMIT_TIMEOUT_MS = Number(process.env.TINYCLAW_OPENVIKING_COMMIT_TIMEOUT_MS || 15000);
const OPENVIKING_PREFETCH_MAX_CHARS = Number(process.env.TINYCLAW_OPENVIKING_PREFETCH_MAX_CHARS || 2800);
const OPENVIKING_PREFETCH_MAX_TURNS = Number(process.env.TINYCLAW_OPENVIKING_PREFETCH_MAX_TURNS || 4);
const OPENVIKING_PREFETCH_MAX_HITS = Number(process.env.TINYCLAW_OPENVIKING_PREFETCH_MAX_HITS || 8);
const OPENVIKING_SEARCH_SCORE_THRESHOLD = process.env.TINYCLAW_OPENVIKING_SEARCH_SCORE_THRESHOLD;
const OPENVIKING_SESSION_ROOT = '/tinyclaw/sessions';
const OPENVIKING_NATIVE_PREFETCH_DUMP_FILE = path.join(path.dirname(LOG_FILE), 'prefetch_dump_native_latest.txt');
const openVikingSyncChains = new Map<string, Promise<void>>();

type OpenVikingPrefetchSource = 'search_native' | 'legacy_markdown' | 'none';

type OpenVikingPrefetchResult = {
    block: string;
    source: OpenVikingPrefetchSource;
    diagnostics: string[];
    fallbackReason?: string;
    distribution?: OpenVikingSearchHitDistribution;
};

type OpenVikingLegacyPrefetchResult = {
    block: string;
    diagnostics: string[];
};

function writeNativePrefetchDump(
    agentId: string,
    query: string,
    sessionId: string | undefined,
    prefetch: OpenVikingPrefetchResult
): void {
    if (prefetch.source !== 'search_native' || !prefetch.block) return;
    const lines: string[] = [
        '# OpenViking Native Prefetch Dump (latest)',
        '',
        `- captured_at: ${new Date().toISOString()}`,
        `- agent_id: ${agentId}`,
        `- session_id: ${sessionId || 'none'}`,
        `- source: ${prefetch.source}`,
        `- distribution: ${maybeDistributionSummary(prefetch.distribution)}`,
        `- diagnostics: ${prefetch.diagnostics.join(' | ') || 'none'}`,
        '',
        '## Query',
        '',
        query,
        '',
        '## Injected Block',
        '',
        prefetch.block,
        '',
    ];
    fs.writeFileSync(OPENVIKING_NATIVE_PREFETCH_DUMP_FILE, lines.join('\n'), 'utf8');
}

function stripInjectedOpenVikingContext(text: string): string {
    const withEndMarker = /\n*------\n*\n*\[OpenViking Retrieved Context\][\s\S]*?\[End OpenViking Context\]\s*/g;
    const withoutEndMarker = /\n*------\n*\n*\[OpenViking Retrieved Context\][\s\S]*$/g;
    return text
        .replace(withEndMarker, '\n')
        .replace(withoutEndMarker, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function getOpenVikingToolPath(workspacePath: string, agentId: string): string | null {
    const toolPath = path.join(workspacePath, agentId, '.tinyclaw', 'tools', 'openviking', 'openviking-tool.js');
    if (!fs.existsSync(toolPath)) return null;
    return toolPath;
}

function getOpenVikingRuntimeDir(workspacePath: string, agentId: string): string {
    return path.join(workspacePath, agentId, '.tinyclaw', 'runtime', 'openviking');
}

function getActiveSessionFile(workspacePath: string, agentId: string): string {
    return path.join(getOpenVikingRuntimeDir(workspacePath, agentId), 'active-session.md');
}

function ensureActiveSessionFile(workspacePath: string, agentId: string): string {
    const runtimeDir = getOpenVikingRuntimeDir(workspacePath, agentId);
    const sessionFile = getActiveSessionFile(workspacePath, agentId);
    if (!fs.existsSync(runtimeDir)) {
        fs.mkdirSync(runtimeDir, { recursive: true });
    }
    if (!fs.existsSync(sessionFile)) {
        const header = [
            `# TinyClaw Session (@${agentId})`,
            '',
            `- started_at: ${new Date().toISOString()}`,
            ''
        ].join('\n');
        fs.writeFileSync(sessionFile, header);
    }
    return sessionFile;
}

function enqueueOpenVikingSync(agentId: string, task: () => Promise<void>): void {
    const current = openVikingSyncChains.get(agentId) || Promise.resolve();
    const next = current
        .then(task)
        .catch((error) => {
            log('WARN', `OpenViking sync failed for @${agentId}: ${(error as Error).message}`);
        });
    openVikingSyncChains.set(agentId, next);
    next.finally(() => {
        if (openVikingSyncChains.get(agentId) === next) {
            openVikingSyncChains.delete(agentId);
        }
    });
}

async function writeSessionFileToOpenViking(
    workspacePath: string,
    agentId: string,
    localFile: string,
    targetPath: string
): Promise<void> {
    if (!OPENVIKING_AUTOSYNC_FALLBACK_ENABLED) return;
    const toolPath = getOpenVikingToolPath(workspacePath, agentId);
    if (!toolPath) return;
    await runCommand('node', [toolPath, 'write-file', targetPath, localFile], path.join(workspacePath, agentId));
}

async function finalizeOpenVikingSession(workspacePath: string, agentId: string): Promise<void> {
    const sessionFile = getActiveSessionFile(workspacePath, agentId);
    if (!fs.existsSync(sessionFile)) return;

    const currentContent = fs.readFileSync(sessionFile, 'utf8').trim();
    if (!currentContent) return;

    const endedAt = new Date().toISOString();
    const sessionCloseNote = `\n\n- ended_at: ${endedAt}\n`;
    fs.appendFileSync(sessionFile, sessionCloseNote);

    const safeTimestamp = endedAt.replace(/[:.]/g, '-');
    await writeSessionFileToOpenViking(
        workspacePath,
        agentId,
        sessionFile,
        `${OPENVIKING_SESSION_ROOT}/${agentId}/closed/${safeTimestamp}.md`
    );

    fs.rmSync(sessionFile, { force: true });
}

async function appendTurnAndSyncOpenViking(
    workspacePath: string,
    agentId: string,
    messageId: string,
    userMessage: string,
    assistantResponse: string,
    isInternal: boolean
): Promise<void> {
    const sessionFile = ensureActiveSessionFile(workspacePath, agentId);
    const turnTime = new Date().toISOString();
    const injectedMarker = '[OpenViking Retrieved Context]';
    if (userMessage.includes(injectedMarker) || assistantResponse.includes(injectedMarker)) {
        log(
            'WARN',
            `OpenViking writeback guard hit for @${agentId} message_id=${messageId}: injected context marker detected before sync`
        );
    }
    const cleanUserMessage = stripInjectedOpenVikingContext(userMessage);
    const cleanAssistantResponse = stripInjectedOpenVikingContext(assistantResponse);
    const turnBlock = [
        '------',
        '',
        `## Turn ${turnTime}`,
        '',
        `- message_id: ${messageId}`,
        `- source: ${isInternal ? 'internal' : 'external'}`,
        '',
        '### User',
        '',
        cleanUserMessage,
        '',
        '### Assistant',
        '',
        cleanAssistantResponse,
        ''
    ].join('\n');
    fs.appendFileSync(sessionFile, turnBlock);

    await writeSessionFileToOpenViking(
        workspacePath,
        agentId,
        sessionFile,
        `${OPENVIKING_SESSION_ROOT}/${agentId}/active.md`
    );
}

function resolveSessionMapKey(messageData: MessageData, agentId: string): OpenVikingSessionMapKey {
    const senderId = messageData.senderId || messageData.sender || 'unknown-sender';
    return buildOpenVikingSessionMapKey(messageData.channel, senderId, agentId);
}

function maybeDistributionSummary(distribution?: OpenVikingSearchHitDistribution): string {
    if (!distribution) return 'memory=0,resource=0,skill=0';
    return `memory=${distribution.memory},resource=${distribution.resource},skill=${distribution.skill}`;
}

async function runOpenVikingToolJson(
    workspacePath: string,
    agentId: string,
    args: string[],
    timeoutMs: number = OPENVIKING_PREFETCH_TIMEOUT_MS
): Promise<unknown> {
    const toolPath = getOpenVikingToolPath(workspacePath, agentId);
    if (!toolPath) {
        throw new Error(`OpenViking tool missing for @${agentId}`);
    }
    const commandArgs = args.includes('--json') ? args : [...args, '--json'];
    const output = await runCommand(
        'node',
        [toolPath, ...commandArgs],
        path.join(workspacePath, agentId),
        timeoutMs
    );
    const trimmed = output.trim();
    if (!trimmed) return {};
    return safeParseJSON(trimmed, `openviking-tool:${args[0] || 'unknown'}`);
}

function extractOpenVikingSessionId(payload: unknown): string {
    const root = (payload && typeof payload === 'object' && !Array.isArray(payload))
        ? payload as Record<string, unknown>
        : {};
    const resultNode = (root.result && typeof root.result === 'object' && !Array.isArray(root.result))
        ? root.result as Record<string, unknown>
        : {};
    const dataNode = (root.data && typeof root.data === 'object' && !Array.isArray(root.data))
        ? root.data as Record<string, unknown>
        : {};

    const candidates = [
        root.id, root.session_id, root.sessionId,
        resultNode.id, resultNode.session_id, resultNode.sessionId,
        dataNode.id, dataNode.session_id, dataNode.sessionId,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim();
        }
    }
    return '';
}

async function ensureOpenVikingNativeSession(
    workspacePath: string,
    agentId: string,
    sessionKey: OpenVikingSessionMapKey
): Promise<{ sessionId: string; isNew: boolean }> {
    const existingSessionId = getOpenVikingSessionId(sessionKey);
    if (existingSessionId) {
        return { sessionId: existingSessionId, isNew: false };
    }

    const created = await runOpenVikingToolJson(
        workspacePath,
        agentId,
        [
            'session-create',
            '--agent-id', sessionKey.agentId,
            '--channel', sessionKey.channel,
            '--sender-id', sessionKey.senderId,
        ],
        OPENVIKING_PREFETCH_TIMEOUT_MS
    );
    const createdSessionId = extractOpenVikingSessionId(created);
    if (!createdSessionId) {
        throw new Error('OpenViking session create returned no session id');
    }
    upsertOpenVikingSessionId(sessionKey, createdSessionId);
    return { sessionId: createdSessionId, isNew: true };
}

async function appendNativeOpenVikingSessionMessage(
    workspacePath: string,
    agentId: string,
    sessionId: string,
    role: 'user' | 'assistant',
    content: string
): Promise<void> {
    const sanitizedContent = stripInjectedOpenVikingContext(content);
    const startedAt = Date.now();
    await runOpenVikingToolJson(
        workspacePath,
        agentId,
        ['session-message', sessionId, role, sanitizedContent],
        OPENVIKING_PREFETCH_TIMEOUT_MS
    );
    const elapsedMs = Date.now() - startedAt;
    log('INFO', `OpenViking session write success for @${agentId}: session_id=${sessionId} role=${role} elapsed_ms=${elapsedMs}`);
}

async function commitNativeOpenVikingSession(
    workspacePath: string,
    agentId: string,
    sessionId: string
): Promise<void> {
    const startedAt = Date.now();
    await runOpenVikingToolJson(
        workspacePath,
        agentId,
        ['session-commit', sessionId],
        OPENVIKING_COMMIT_TIMEOUT_MS
    );
    const elapsedMs = Date.now() - startedAt;
    log('INFO', `OpenViking session commit success for @${agentId}: session_id=${sessionId} elapsed_ms=${elapsedMs}`);
}

async function fetchLegacyOpenVikingPrefetchContext(
    workspacePath: string,
    agentId: string,
    query: string
): Promise<OpenVikingLegacyPrefetchResult> {
    const toolPath = getOpenVikingToolPath(workspacePath, agentId);
    if (!toolPath) return { block: '', diagnostics: ['tool_missing'] };

    const readTargets = [
        `${OPENVIKING_SESSION_ROOT}/${agentId}/active.md`,
        `${OPENVIKING_SESSION_ROOT}/${agentId}/closed`,
    ];

    const allTurns: SessionTurn[] = [];
    const diagnostics: string[] = [];
    const workdir = path.join(workspacePath, agentId);
    const searchLimit = Math.max(OPENVIKING_PREFETCH_MAX_TURNS * 6, 12);
    const candidateUris: Array<{ uri: string; score: number }> = [];

    // Prefer OpenViking semantic retrieval chain.
    for (const target of readTargets) {
        try {
            const found = await runCommand(
                'node',
                [toolPath, 'find-uris', query, target, '--limit', String(searchLimit)],
                workdir,
                OPENVIKING_PREFETCH_TIMEOUT_MS
            );
            const lines = found
                .trim()
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line && !line.startsWith('[openviking-tool]'));
            let matched = 0;
            for (const line of lines) {
                const tabIdx = line.indexOf('\t');
                if (tabIdx <= 0) continue;
                const score = Number(line.slice(0, tabIdx));
                const uri = line.slice(tabIdx + 1).trim();
                if (!uri) continue;
                matched += 1;
                candidateUris.push({ uri, score: Number.isFinite(score) ? score : 0 });
            }
            diagnostics.push(`${target}:find=${matched}`);
        } catch {
            diagnostics.push(`${target}:find_error`);
        }
    }

    const rankedUris: string[] = [];
    const seenUris = new Set<string>();
    for (const candidate of candidateUris) {
        if (seenUris.has(candidate.uri)) continue;
        seenUris.add(candidate.uri);
        rankedUris.push(candidate.uri);
        if (rankedUris.length >= searchLimit) break;
    }
    diagnostics.push(`find_total=${rankedUris.length}`);

    for (const uri of rankedUris) {
        try {
            const output = await runCommand(
                'node',
                [toolPath, 'read', uri],
                workdir,
                OPENVIKING_PREFETCH_TIMEOUT_MS
            );
            const content = output.trim();
            if (!content || content.startsWith('[openviking-tool]')) continue;
            const parsed = parseSessionTurns(content);
            if (parsed.length > 0) {
                allTurns.push(...parsed);
            }
        } catch {
            // Best-effort: ignore individual read failures.
        }
    }

    // Fallback to legacy full-read path if semantic retrieval returns nothing.
    if (!allTurns.length) {
        for (const target of readTargets) {
            try {
                const output = await runCommand(
                    'node',
                    [toolPath, 'read', target],
                    workdir,
                    OPENVIKING_PREFETCH_TIMEOUT_MS
                );
                const content = output.trim();
                if (!content || content.startsWith('[openviking-tool]')) {
                    diagnostics.push(`${target}:fallback_empty`);
                    continue;
                }
                const parsed = parseSessionTurns(content);
                diagnostics.push(`${target}:fallback_chars=${content.length},turns=${parsed.length}`);
                allTurns.push(...parsed);
            } catch {
                diagnostics.push(`${target}:fallback_error`);
            }
        }
    }

    const dedup = new Map<string, SessionTurn>();
    for (const turn of allTurns) {
        const key = turn.messageId
            ? `${turn.messageId}|${turn.timestamp}`
            : `${turn.timestamp}|${turn.user}|${turn.assistant}`;
        dedup.set(key, turn);
    }
    const turns = Array.from(dedup.values());
    if (!turns.length) {
        return { block: '', diagnostics };
    }

    const selected = turns.slice(0, OPENVIKING_PREFETCH_MAX_TURNS);
    return {
        block: buildPrefetchBlock(selected, OPENVIKING_PREFETCH_MAX_CHARS),
        diagnostics,
    };
}

async function fetchOpenVikingPrefetchContext(
    workspacePath: string,
    agentId: string,
    query: string,
    sessionId?: string
): Promise<OpenVikingPrefetchResult> {
    if (!OPENVIKING_PREFETCH_ENABLED) {
        return { block: '', source: 'none', diagnostics: ['prefetch_disabled'] };
    }

    const toolPath = getOpenVikingToolPath(workspacePath, agentId);
    if (!toolPath) {
        return { block: '', source: 'none', diagnostics: ['tool_missing'] };
    }

    const diagnostics: string[] = [];
    if (OPENVIKING_SEARCH_NATIVE_ENABLED) {
        try {
            const searchLimit = Math.max(OPENVIKING_PREFETCH_MAX_HITS * 2, 12);
            const args = [
                'search',
                query,
                '--limit', String(searchLimit),
            ];
            if (OPENVIKING_SEARCH_SCORE_THRESHOLD !== undefined) {
                args.push('--score-threshold', OPENVIKING_SEARCH_SCORE_THRESHOLD);
            }
            if (sessionId) {
                args.push('--session-id', sessionId);
            }
            const searchResponse = await runOpenVikingToolJson(workspacePath, agentId, args, OPENVIKING_PREFETCH_TIMEOUT_MS);
            const searchHits = parseOpenVikingSearchHits(searchResponse);
            if (searchHits.length > 0) {
                const distribution = summarizeOpenVikingSearchHitDistribution(searchHits.slice(0, OPENVIKING_PREFETCH_MAX_HITS));
                return {
                    block: buildOpenVikingSearchPrefetchBlock(searchHits, OPENVIKING_PREFETCH_MAX_CHARS, OPENVIKING_PREFETCH_MAX_HITS),
                    source: 'search_native',
                    diagnostics: [`native_search_hits=${searchHits.length}`, sessionId ? 'session_id_used=1' : 'session_id_used=0'],
                    distribution,
                };
            }
            diagnostics.push('native_search_empty');
        } catch (error) {
            diagnostics.push(`native_search_error=${(error as Error).message}`);
        }
    } else {
        diagnostics.push('native_search_disabled');
    }

    const legacy = await fetchLegacyOpenVikingPrefetchContext(workspacePath, agentId, query);
    const fallbackReason = OPENVIKING_SEARCH_NATIVE_ENABLED
        ? 'native_search_no_hits_or_error'
        : 'native_search_flag_disabled';
    return {
        block: legacy.block,
        source: legacy.block ? 'legacy_markdown' : 'none',
        diagnostics: [...diagnostics, ...legacy.diagnostics],
        fallbackReason,
    };
}

/**
 * If a response exceeds the threshold, save full text as a .md file
 * and return a truncated preview with the file attached.
 */
function handleLongResponse(
    response: string,
    existingFiles: string[]
): { message: string; files: string[] } {
    if (response.length <= LONG_RESPONSE_THRESHOLD) {
        return { message: response, files: existingFiles };
    }

    // Save full response as a .md file
    const filename = `response_${Date.now()}.md`;
    const filePath = path.join(FILES_DIR, filename);
    fs.writeFileSync(filePath, response);
    log('INFO', `Long response (${response.length} chars) saved to ${filename}`);

    // Truncate to preview
    const preview = response.substring(0, LONG_RESPONSE_THRESHOLD) + '\n\n_(Full response attached as file)_';

    return { message: preview, files: [...existingFiles, filePath] };
}

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

/**
 * Enqueue an internal (agent-to-agent) message into QUEUE_INCOMING.
 */
function enqueueInternalMessage(
    conversationId: string,
    fromAgent: string,
    targetAgent: string,
    message: string,
    originalData: MessageData
): void {
    const internalMessage: MessageData = {
        channel: originalData.channel,
        sender: originalData.sender,
        senderId: originalData.senderId,
        message,
        timestamp: Date.now(),
        messageId: originalData.messageId,
        agent: targetAgent,
        conversationId,
        fromAgent,
    };

    const filename = `internal_${conversationId}_${targetAgent}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.json`;
    fs.writeFileSync(path.join(QUEUE_INCOMING, filename), JSON.stringify(internalMessage, null, 2));
    log('INFO', `Enqueued internal message: @${fromAgent} → @${targetAgent}`);
}

/**
 * Collect files from a response text.
 */
function collectFiles(response: string, fileSet: Set<string>): void {
    const fileRegex = /\[send_file:\s*([^\]]+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = fileRegex.exec(response)) !== null) {
        const filePath = match[1].trim();
        if (fs.existsSync(filePath)) fileSet.add(filePath);
    }
}

/**
 * Complete a conversation: aggregate responses, write to outgoing queue, save chat history.
 */
function completeConversation(conv: Conversation): void {
    const settings = getSettings();
    const agents = getAgents(settings);

    log('INFO', `Conversation ${conv.id} complete — ${conv.responses.length} response(s), ${conv.totalMessages} total message(s)`);
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
        log('INFO', `Chat history saved`);
    } catch (e) {
        log('ERROR', `Failed to save chat history: ${(e as Error).message}`);
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

    // Remove [@agent: ...] tags from final response
    finalResponse = finalResponse.replace(/\[@\S+?:\s*[\s\S]*?\]/g, '').trim();

    // Handle long responses — send as file attachment
    const { message: responseMessage, files: allFiles } = handleLongResponse(finalResponse, outboundFiles);

    // Write to outgoing queue
    const responseData: ResponseData = {
        channel: conv.channel,
        sender: conv.sender,
        message: responseMessage,
        originalMessage: conv.originalMessage,
        timestamp: Date.now(),
        messageId: conv.messageId,
        files: allFiles.length > 0 ? allFiles : undefined,
    };

    const responseFile = conv.channel === 'heartbeat'
        ? path.join(QUEUE_OUTGOING, `${conv.messageId}.json`)
        : path.join(QUEUE_OUTGOING, `${conv.channel}_${conv.messageId}_${Date.now()}.json`);

    fs.writeFileSync(responseFile, JSON.stringify(responseData, null, 2));

    log('INFO', `✓ Response ready [${conv.channel}] ${conv.sender} (${finalResponse.length} chars)`);
    emitEvent('response_ready', { channel: conv.channel, sender: conv.sender, responseLength: finalResponse.length, responseText: finalResponse, messageId: conv.messageId });

    // Clean up
    conversations.delete(conv.id);
}

// Process a single message
async function processMessage(messageFile: string): Promise<void> {
    const processingFile = path.join(QUEUE_PROCESSING, path.basename(messageFile));

    try {
        // Move to processing to mark as in-progress
        fs.renameSync(messageFile, processingFile);

        // Read message
        const messageData: MessageData = safeParseJSON(fs.readFileSync(processingFile, 'utf8'), path.basename(processingFile));
        const { channel, sender, message: rawMessage, timestamp, messageId } = messageData;
        const isInternal = !!messageData.conversationId;

        log('INFO', `Processing [${isInternal ? 'internal' : channel}] ${isInternal ? `@${messageData.fromAgent}→@${messageData.agent}` : `from ${sender}`}: ${rawMessage.substring(0, 50)}...`);
        if (!isInternal) {
            emitEvent('message_received', { channel, sender, message: rawMessage.substring(0, 120), messageId });
        }

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

        // Easter egg: Handle multiple agent mentions (only for external messages)
        if (!isInternal && agentId === 'error') {
            log('INFO', `Multiple agents detected, sending easter egg message`);

            const responseFile = path.join(QUEUE_OUTGOING, path.basename(processingFile));
            const responseData: ResponseData = {
                channel,
                sender,
                message: message,
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
        ensureAgentDirectory(path.join(workspacePath, agentId));
        log('INFO', `Routing to agent: ${agent.name} (${agentId}) [${agent.provider}/${agent.model}]`);
        if (!isInternal) {
            emitEvent('agent_routed', { agentId, agentName: agent.name, provider: agent.provider, model: agent.model, isTeamRouted });
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
        const sessionMapKey = !isInternal ? resolveSessionMapKey(messageData, agentId) : null;
        let openVikingSessionId: string | null = null;
        let nativeSessionWriteFailed = false;
        const userMessageForSession = message;

        if (shouldReset) {
            fs.unlinkSync(agentResetFlag);
            if (!isInternal && OPENVIKING_SESSION_NATIVE_ENABLED && sessionMapKey) {
                const existingSessionId = getOpenVikingSessionId(sessionMapKey);
                if (existingSessionId) {
                    try {
                        await commitNativeOpenVikingSession(workspacePath, agentId, existingSessionId);
                    } catch (error) {
                        log('WARN', `OpenViking session commit failed for @${agentId}: session_id=${existingSessionId} error=${(error as Error).message}`);
                    } finally {
                        deleteOpenVikingSessionId(sessionMapKey);
                        log('INFO', `OpenViking session map cleared for @${agentId}: session_id=${existingSessionId}`);
                    }
                } else {
                    log('INFO', `OpenViking reset consumed for @${agentId}: no native session mapping found`);
                }
            }

            if (OPENVIKING_AUTOSYNC_FALLBACK_ENABLED) {
                enqueueOpenVikingSync(agentId, async () => {
                    await finalizeOpenVikingSession(workspacePath, agentId);
                    log('INFO', `OpenViking legacy markdown session finalized for @${agentId}`);
                });
            }
        }

        if (!isInternal && OPENVIKING_SESSION_NATIVE_ENABLED && sessionMapKey) {
            try {
                const ensured = await ensureOpenVikingNativeSession(workspacePath, agentId, sessionMapKey);
                openVikingSessionId = ensured.sessionId;
                log('INFO', `OpenViking session resolved for @${agentId}: session_id=${openVikingSessionId} status=${ensured.isNew ? 'created' : 'reused'}`);
            } catch (error) {
                nativeSessionWriteFailed = true;
                log('WARN', `OpenViking session setup failed for @${agentId}: ${(error as Error).message}`);
            }
        }

        // For internal messages: append pending response indicator so the agent
        // knows other teammates are still processing and won't re-mention them.
        if (isInternal && messageData.conversationId) {
            const conv = conversations.get(messageData.conversationId);
            if (conv) {
                // pending includes this message (not yet decremented), so subtract 1 for "others"
                const othersPending = conv.pending - 1;
                if (othersPending > 0) {
                    message += `\n\n------\n\n[${othersPending} other teammate response(s) are still being processed and will be delivered when ready. Do not re-mention teammates who haven't responded yet.]`;
                }
            }
        }

        if (!isInternal) {
            try {
                const prefetch = await fetchOpenVikingPrefetchContext(
                    workspacePath,
                    agentId,
                    message,
                    openVikingSessionId || undefined
                );
                if (prefetch.block) {
                    writeNativePrefetchDump(agentId, message, openVikingSessionId || undefined, prefetch);
                    message += `\n\n------\n\n${prefetch.block}\n[End OpenViking Context]`;
                    const distributionSummary = maybeDistributionSummary(prefetch.distribution);
                    log('INFO', `OpenViking prefetch hit for @${agentId}: source=${prefetch.source} distribution=${distributionSummary} injected_chars=${prefetch.block.length}`);
                    if (prefetch.fallbackReason) {
                        log('INFO', `OpenViking prefetch fallback for @${agentId}: reason=${prefetch.fallbackReason} diagnostics=${prefetch.diagnostics.join(' | ')}`);
                    }
                } else {
                    log('INFO', `OpenViking prefetch miss for @${agentId}: source=${prefetch.source} diagnostics=${prefetch.diagnostics.join(' | ')}`);
                }
            } catch (error) {
                log('WARN', `OpenViking prefetch skipped for @${agentId}: ${(error as Error).message}`);
            }
        }

        if (!isInternal && OPENVIKING_SESSION_NATIVE_ENABLED) {
            if (openVikingSessionId) {
                try {
                    await appendNativeOpenVikingSessionMessage(
                        workspacePath,
                        agentId,
                        openVikingSessionId,
                        'user',
                        userMessageForSession
                    );
                } catch (error) {
                    nativeSessionWriteFailed = true;
                    log('WARN', `OpenViking session write failed for @${agentId}: session_id=${openVikingSessionId} role=user error=${(error as Error).message}`);
                }
            } else {
                nativeSessionWriteFailed = true;
                log('WARN', `OpenViking session write skipped for @${agentId}: session_id_unavailable`);
            }
        }

        // Invoke agent
        emitEvent('chain_step_start', { agentId, agentName: agent.name, fromAgent: messageData.fromAgent || null });
        let response: string;
        try {
            response = await invokeAgent(agent, agentId, message, workspacePath, shouldReset, agents, teams);
        } catch (error) {
            const provider = agent.provider || 'anthropic';
            const providerLabel = provider === 'openai' ? 'Codex' : provider === 'opencode' ? 'OpenCode' : 'Claude';
            log('ERROR', `${providerLabel} error (agent: ${agentId}): ${(error as Error).message}`);
            response = "Sorry, I encountered an error processing your request. Please check the queue logs.";
        }

        emitEvent('chain_step_done', { agentId, agentName: agent.name, responseLength: response.length, responseText: response });

        if (!isInternal && OPENVIKING_SESSION_NATIVE_ENABLED && openVikingSessionId) {
            try {
                await appendNativeOpenVikingSessionMessage(
                    workspacePath,
                    agentId,
                    openVikingSessionId,
                    'assistant',
                    response
                );
            } catch (error) {
                nativeSessionWriteFailed = true;
                log('WARN', `OpenViking session write failed for @${agentId}: session_id=${openVikingSessionId} role=assistant error=${(error as Error).message}`);
            }
        }

        const shouldUseLegacyWriteback = OPENVIKING_AUTOSYNC_FALLBACK_ENABLED && (
            isInternal
            || !OPENVIKING_SESSION_NATIVE_ENABLED
            || nativeSessionWriteFailed
            || !openVikingSessionId
        );

        if (shouldUseLegacyWriteback) {
            const fallbackReasons: string[] = [];
            if (isInternal) fallbackReasons.push('internal_message');
            if (!OPENVIKING_SESSION_NATIVE_ENABLED) fallbackReasons.push('session_native_disabled');
            if (OPENVIKING_SESSION_NATIVE_ENABLED && !openVikingSessionId) fallbackReasons.push('session_id_unavailable');
            if (nativeSessionWriteFailed) fallbackReasons.push('native_session_write_failed');
            log('INFO', `OpenViking legacy writeback fallback for @${agentId}: reasons=${fallbackReasons.join(',') || 'unknown'}`);
            enqueueOpenVikingSync(agentId, async () => {
                await appendTurnAndSyncOpenViking(workspacePath, agentId, messageId, message, response, isInternal);
            });
        } else if (!isInternal && OPENVIKING_SESSION_NATIVE_ENABLED && openVikingSessionId) {
            log('INFO', `OpenViking native write path complete for @${agentId}: session_id=${openVikingSessionId}`);
        }

        // --- No team context: simple response to user ---
        if (!teamContext) {
            let finalResponse = response.trim();

            // Detect files
            const outboundFilesSet = new Set<string>();
            collectFiles(finalResponse, outboundFilesSet);
            const outboundFiles = Array.from(outboundFilesSet);
            if (outboundFiles.length > 0) {
                finalResponse = finalResponse.replace(/\[send_file:\s*[^\]]+\]/g, '').trim();
            }

            // Handle long responses — send as file attachment
            const { message: responseMessage, files: allFiles } = handleLongResponse(finalResponse, outboundFiles);

            const responseData: ResponseData = {
                channel,
                sender,
                message: responseMessage,
                originalMessage: rawMessage,
                timestamp: Date.now(),
                messageId,
                agent: agentId,
                files: allFiles.length > 0 ? allFiles : undefined,
            };

            const responseFile = channel === 'heartbeat'
                ? path.join(QUEUE_OUTGOING, `${messageId}.json`)
                : path.join(QUEUE_OUTGOING, `${channel}_${messageId}_${Date.now()}.json`);

            fs.writeFileSync(responseFile, JSON.stringify(responseData, null, 2));

            log('INFO', `✓ Response ready [${channel}] ${sender} via agent:${agentId} (${finalResponse.length} chars)`);
            emitEvent('response_ready', { channel, sender, agentId, responseLength: finalResponse.length, responseText: finalResponse, messageId });

            fs.unlinkSync(processingFile);
            return;
        }

        // --- Team context: conversation-based message passing ---

        // Get or create conversation
        let conv: Conversation;
        if (isInternal && messageData.conversationId && conversations.has(messageData.conversationId)) {
            conv = conversations.get(messageData.conversationId)!;
        } else {
            // New conversation
            const convId = `${messageId}_${Date.now()}`;
            conv = {
                id: convId,
                channel,
                sender,
                originalMessage: rawMessage,
                messageId,
                pending: 1, // this initial message
                responses: [],
                files: new Set(),
                totalMessages: 0,
                maxMessages: MAX_CONVERSATION_MESSAGES,
                teamContext,
                startTime: Date.now(),
                outgoingMentions: new Map(),
            };
            conversations.set(convId, conv);
            log('INFO', `Conversation started: ${convId} (team: ${teamContext.team.name})`);
            emitEvent('team_chain_start', { teamId: teamContext.teamId, teamName: teamContext.team.name, agents: teamContext.team.agents, leader: teamContext.team.leader_agent });
        }

        // Record this agent's response
        conv.responses.push({ agentId, response });
        conv.totalMessages++;
        collectFiles(response, conv.files);

        // Check for teammate mentions
        const teammateMentions = extractTeammateMentions(
            response, agentId, conv.teamContext.teamId, teams, agents
        );

        if (teammateMentions.length > 0 && conv.totalMessages < conv.maxMessages) {
            // Enqueue internal messages for each mention
            conv.pending += teammateMentions.length;
            conv.outgoingMentions.set(agentId, teammateMentions.length);
            for (const mention of teammateMentions) {
                log('INFO', `@${agentId} → @${mention.teammateId}`);
                emitEvent('chain_handoff', { teamId: conv.teamContext.teamId, fromAgent: agentId, toAgent: mention.teammateId });

                const internalMsg = `[Message from teammate @${agentId}]:\n${mention.message}`;
                enqueueInternalMessage(conv.id, agentId, mention.teammateId, internalMsg, messageData);
            }
        } else if (teammateMentions.length > 0) {
            log('WARN', `Conversation ${conv.id} hit max messages (${conv.maxMessages}) — not enqueuing further mentions`);
        }

        // This branch is done
        conv.pending--;

        if (conv.pending === 0) {
            completeConversation(conv);
        } else {
            log('INFO', `Conversation ${conv.id}: ${conv.pending} branch(es) still pending`);
        }

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
        const messageData = safeParseJSON<MessageData>(fs.readFileSync(filePath, 'utf8'));
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
