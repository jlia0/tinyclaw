import fs from 'fs';
import path from 'path';
import { jsonrepair } from 'jsonrepair';
import { LOG_FILE } from '../../lib/config';
import { runCommand } from '../../lib/invoke';
import { log } from '../../lib/logging';
import type {
    BeforeModelContext,
    BeforeModelHookResult,
    HealthContext,
    HealthResult,
    Hooks,
    SessionEndContext,
    SessionResetContext,
    StartupContext,
} from '../../lib/plugins';
import type { MessageData, Settings } from '../../lib/types';
import {
    SessionTurn,
    parseSessionTurns,
    buildPrefetchBlock,
    parseOpenVikingSearchHits,
    summarizeOpenVikingSearchHitDistribution,
    buildOpenVikingSearchPrefetchBlock,
    OpenVikingSearchHitDistribution,
} from './prefetch';
import {
    buildOpenVikingSessionMapKey,
    getOpenVikingSessionEntry,
    getOpenVikingSessionId,
    listOpenVikingSessionEntries,
    touchOpenVikingSessionId,
    upsertOpenVikingSessionId,
    deleteOpenVikingSessionId,
    OpenVikingSessionMapKey,
} from './session-map';

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

type OpenVikingPluginState = {
    openVikingSessionId: string | null;
    nativeSessionWriteFailed: boolean;
};

type OpenVikingContextConfig = {
    enabled: boolean;
    autosyncFallbackEnabled: boolean;
    prefetchEnabled: boolean;
    sessionNativeEnabled: boolean;
    searchNativeEnabled: boolean;
    commitOnShutdown: boolean;
    sessionIdleTimeoutMs: number;
    sessionSwitchMarkers: string[];
    prefetchTimeoutMs: number;
    commitTimeoutMs: number;
    prefetchMaxChars: number;
    prefetchMaxTurns: number;
    prefetchMaxHits: number;
    searchScoreThreshold?: string;
    sessionRoot: string;
    nativePrefetchDumpFile: string;
};

const OPENVIKING_SESSION_ROOT = '/tinyclaw/sessions';
const OPENVIKING_NATIVE_PREFETCH_DUMP_FILE = path.join(path.dirname(LOG_FILE), 'prefetch_dump_native_latest.txt');
const openVikingSyncChains = new Map<string, Promise<void>>();

function parseBoolean(value: string | undefined): boolean | undefined {
    if (value === undefined) return undefined;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return undefined;
}

function resolveBooleanFlag(
    envName: string,
    settingValue: boolean | undefined,
    fallback: boolean
): boolean {
    const env = parseBoolean(process.env[envName]);
    if (env !== undefined) return env;
    if (typeof settingValue === 'boolean') return settingValue;
    return fallback;
}

function resolveNumberFlag(
    envName: string,
    settingValue: number | undefined,
    fallback: number,
    min: number
): number {
    const envValue = Number(process.env[envName]);
    if (Number.isFinite(envValue) && envValue >= min) {
        return envValue;
    }
    if (Number.isFinite(settingValue) && (settingValue as number) >= min) {
        return settingValue as number;
    }
    return fallback;
}

function resolveStringListFlag(
    envName: string,
    settingValue: string[] | undefined,
    fallback: string[]
): string[] {
    const raw = process.env[envName];
    if (typeof raw === 'string') {
        const parsed = raw
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
        if (parsed.length > 0) return parsed;
    }
    if (Array.isArray(settingValue)) {
        const parsed = settingValue
            .map((item) => String(item || '').trim())
            .filter(Boolean);
        if (parsed.length > 0) return parsed;
    }
    return fallback;
}

function resolveOpenVikingContextConfig(settings: Settings): OpenVikingContextConfig {
    const ov = settings.openviking || {};
    const enabled = resolveBooleanFlag(
        'TINYCLAW_OPENVIKING_CONTEXT_PLUGIN',
        ov.context_plugin_enabled ?? ov.enabled,
        true
    );
    const autosyncFallbackEnabled = resolveBooleanFlag('TINYCLAW_OPENVIKING_AUTOSYNC', ov.autosync, true);
    const prefetchEnabled = resolveBooleanFlag('TINYCLAW_OPENVIKING_PREFETCH', ov.prefetch, true);
    const sessionNativeEnabled = resolveBooleanFlag('TINYCLAW_OPENVIKING_SESSION_NATIVE', ov.native_session, false);
    const searchNativeEnabled = resolveBooleanFlag('TINYCLAW_OPENVIKING_SEARCH_NATIVE', ov.native_search, false);
    const commitOnShutdown = resolveBooleanFlag('TINYCLAW_OPENVIKING_COMMIT_ON_SHUTDOWN', ov.commit_on_shutdown, true);
    const sessionSwitchMarkers = resolveStringListFlag(
        'TINYCLAW_OPENVIKING_SESSION_SWITCH_MARKERS',
        ov.session_switch_markers,
        ['/newtask']
    );

    const scoreFromEnv = process.env.TINYCLAW_OPENVIKING_SEARCH_SCORE_THRESHOLD;
    const scoreFromSettings = ov.search_score_threshold;
    const searchScoreThreshold = scoreFromEnv !== undefined
        ? scoreFromEnv
        : (scoreFromSettings !== undefined ? String(scoreFromSettings) : undefined);

    return {
        enabled,
        autosyncFallbackEnabled,
        prefetchEnabled,
        sessionNativeEnabled,
        searchNativeEnabled,
        commitOnShutdown,
        sessionIdleTimeoutMs: resolveNumberFlag('TINYCLAW_OPENVIKING_SESSION_IDLE_TIMEOUT_MS', ov.session_idle_timeout_ms, 0, 0),
        sessionSwitchMarkers,
        prefetchTimeoutMs: resolveNumberFlag('TINYCLAW_OPENVIKING_PREFETCH_TIMEOUT_MS', ov.prefetch_timeout_ms, 5000, 1),
        commitTimeoutMs: resolveNumberFlag('TINYCLAW_OPENVIKING_COMMIT_TIMEOUT_MS', ov.commit_timeout_ms, 15000, 1),
        prefetchMaxChars: resolveNumberFlag('TINYCLAW_OPENVIKING_PREFETCH_MAX_CHARS', ov.prefetch_max_chars, 2800, 200),
        prefetchMaxTurns: resolveNumberFlag('TINYCLAW_OPENVIKING_PREFETCH_MAX_TURNS', ov.prefetch_max_turns, 4, 1),
        prefetchMaxHits: resolveNumberFlag('TINYCLAW_OPENVIKING_PREFETCH_MAX_HITS', ov.prefetch_max_hits, 8, 1),
        searchScoreThreshold,
        sessionRoot: OPENVIKING_SESSION_ROOT,
        nativePrefetchDumpFile: OPENVIKING_NATIVE_PREFETCH_DUMP_FILE,
    };
}

/** Parse JSON with automatic repair for malformed content (e.g. bad escapes). */
function safeParseJSON<T = unknown>(raw: string, label?: string): T {
    try {
        return JSON.parse(raw);
    } catch {
        log('WARN', `Invalid JSON${label ? ` in ${label}` : ''}, attempting auto-repair`);
        return JSON.parse(jsonrepair(raw));
    }
}

function maybeDistributionSummary(distribution?: OpenVikingSearchHitDistribution): string {
    if (!distribution) return 'memory=0,resource=0,skill=0';
    return `memory=${distribution.memory},resource=${distribution.resource},skill=${distribution.skill}`;
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
            '',
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

function writeNativePrefetchDump(
    config: OpenVikingContextConfig,
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
    fs.writeFileSync(config.nativePrefetchDumpFile, lines.join('\n'), 'utf8');
}

async function writeSessionFileToOpenViking(
    config: OpenVikingContextConfig,
    workspacePath: string,
    agentId: string,
    localFile: string,
    targetPath: string
): Promise<void> {
    if (!config.autosyncFallbackEnabled) return;
    const toolPath = getOpenVikingToolPath(workspacePath, agentId);
    if (!toolPath) return;
    await runCommand('node', [toolPath, 'write-file', targetPath, localFile], path.join(workspacePath, agentId));
}

async function finalizeOpenVikingSession(
    config: OpenVikingContextConfig,
    workspacePath: string,
    agentId: string
): Promise<void> {
    const sessionFile = getActiveSessionFile(workspacePath, agentId);
    if (!fs.existsSync(sessionFile)) return;

    const currentContent = fs.readFileSync(sessionFile, 'utf8').trim();
    if (!currentContent) return;

    const endedAt = new Date().toISOString();
    const sessionCloseNote = `\n\n- ended_at: ${endedAt}\n`;
    fs.appendFileSync(sessionFile, sessionCloseNote);

    const safeTimestamp = endedAt.replace(/[:.]/g, '-');
    await writeSessionFileToOpenViking(
        config,
        workspacePath,
        agentId,
        sessionFile,
        `${config.sessionRoot}/${agentId}/closed/${safeTimestamp}.md`
    );

    fs.rmSync(sessionFile, { force: true });
}

async function appendTurnAndSyncOpenViking(
    config: OpenVikingContextConfig,
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
        '',
    ].join('\n');
    fs.appendFileSync(sessionFile, turnBlock);

    await writeSessionFileToOpenViking(
        config,
        workspacePath,
        agentId,
        sessionFile,
        `${config.sessionRoot}/${agentId}/active.md`
    );
}

function resolveSessionMapKey(messageData: MessageData, agentId: string): OpenVikingSessionMapKey {
    const senderId = messageData.senderId || messageData.sender || 'unknown-sender';
    return buildOpenVikingSessionMapKey(messageData.channel, senderId, agentId);
}

function resolveWorkspacePathFromSettings(settings: Settings): string {
    return settings.workspace?.path || path.join(require('os').homedir(), 'tinyclaw-workspace');
}

function matchSessionSwitchDirective(
    message: string,
    markers: string[]
): { matched: boolean; marker?: string; strippedMessage: string } {
    const trimmed = message.trim();
    const normalized = trimmed.toLowerCase();
    for (const marker of markers) {
        const candidate = marker.trim();
        if (!candidate) continue;
        const lower = candidate.toLowerCase();
        if (!normalized.startsWith(lower)) continue;
        const nextChar = trimmed[candidate.length];
        if (nextChar && !/[\s:：,，\-]/.test(nextChar)) continue;
        const strippedMessage = trimmed
            .slice(candidate.length)
            .replace(/^[\s:：,，\-]+/, '')
            .trim();
        return { matched: true, marker: candidate, strippedMessage };
    }
    return { matched: false, strippedMessage: message };
}

async function runOpenVikingToolJson(
    config: OpenVikingContextConfig,
    workspacePath: string,
    agentId: string,
    args: string[],
    timeoutMs: number = config.prefetchTimeoutMs
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
    config: OpenVikingContextConfig,
    workspacePath: string,
    agentId: string,
    sessionKey: OpenVikingSessionMapKey
): Promise<{ sessionId: string; isNew: boolean }> {
    const existingSessionId = getOpenVikingSessionId(sessionKey);
    if (existingSessionId) {
        return { sessionId: existingSessionId, isNew: false };
    }

    const created = await runOpenVikingToolJson(
        config,
        workspacePath,
        agentId,
        [
            'session-create',
            '--agent-id', sessionKey.agentId,
            '--channel', sessionKey.channel,
            '--sender-id', sessionKey.senderId,
        ],
        config.prefetchTimeoutMs
    );
    const createdSessionId = extractOpenVikingSessionId(created);
    if (!createdSessionId) {
        throw new Error('OpenViking session create returned no session id');
    }
    upsertOpenVikingSessionId(sessionKey, createdSessionId);
    return { sessionId: createdSessionId, isNew: true };
}

async function appendNativeOpenVikingSessionMessage(
    config: OpenVikingContextConfig,
    workspacePath: string,
    agentId: string,
    sessionId: string,
    role: 'user' | 'assistant',
    content: string
): Promise<void> {
    const sanitizedContent = stripInjectedOpenVikingContext(content);
    const startedAt = Date.now();
    await runOpenVikingToolJson(
        config,
        workspacePath,
        agentId,
        ['session-message', sessionId, role, sanitizedContent],
        config.prefetchTimeoutMs
    );
    const elapsedMs = Date.now() - startedAt;
    log('INFO', `OpenViking session write success for @${agentId}: session_id=${sessionId} role=${role} elapsed_ms=${elapsedMs}`);
}

async function commitNativeOpenVikingSession(
    config: OpenVikingContextConfig,
    workspacePath: string,
    agentId: string,
    sessionId: string
): Promise<void> {
    const startedAt = Date.now();
    await runOpenVikingToolJson(
        config,
        workspacePath,
        agentId,
        ['session-commit', sessionId],
        config.commitTimeoutMs
    );
    const elapsedMs = Date.now() - startedAt;
    log('INFO', `OpenViking session commit success for @${agentId}: session_id=${sessionId} elapsed_ms=${elapsedMs}`);
}

async function commitMappedNativeSessionAndClear(
    config: OpenVikingContextConfig,
    workspacePath: string,
    sessionKey: OpenVikingSessionMapKey,
    reason: string,
    logPrefix: string
): Promise<boolean> {
    const existingSessionId = getOpenVikingSessionId(sessionKey);
    if (!existingSessionId) {
        log('INFO', `${logPrefix} for @${sessionKey.agentId}: no native session mapping found reason=${reason}`);
        return false;
    }

    try {
        await commitNativeOpenVikingSession(config, workspacePath, sessionKey.agentId, existingSessionId);
    } catch (error) {
        log('WARN', `OpenViking session commit failed for @${sessionKey.agentId}: session_id=${existingSessionId} reason=${reason} error=${(error as Error).message}`);
    } finally {
        deleteOpenVikingSessionId(sessionKey);
        log('INFO', `OpenViking session map cleared for @${sessionKey.agentId}: session_id=${existingSessionId} reason=${reason}`);
    }
    return true;
}

async function fetchLegacyOpenVikingPrefetchContext(
    config: OpenVikingContextConfig,
    workspacePath: string,
    agentId: string,
    query: string
): Promise<OpenVikingLegacyPrefetchResult> {
    const toolPath = getOpenVikingToolPath(workspacePath, agentId);
    if (!toolPath) return { block: '', diagnostics: ['tool_missing'] };

    const readTargets = [
        `${config.sessionRoot}/${agentId}/active.md`,
        `${config.sessionRoot}/${agentId}/closed`,
    ];

    const allTurns: SessionTurn[] = [];
    const diagnostics: string[] = [];
    const workdir = path.join(workspacePath, agentId);
    const searchLimit = Math.max(config.prefetchMaxTurns * 6, 12);
    const candidateUris: Array<{ uri: string; score: number }> = [];

    // Prefer OpenViking semantic retrieval chain.
    for (const target of readTargets) {
        try {
            const found = await runCommand(
                'node',
                [toolPath, 'find-uris', query, target, '--limit', String(searchLimit)],
                workdir,
                config.prefetchTimeoutMs
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
                config.prefetchTimeoutMs
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
                    config.prefetchTimeoutMs
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

    const selected = turns.slice(0, config.prefetchMaxTurns);
    return {
        block: buildPrefetchBlock(selected, config.prefetchMaxChars),
        diagnostics,
    };
}

async function fetchOpenVikingPrefetchContext(
    config: OpenVikingContextConfig,
    workspacePath: string,
    agentId: string,
    query: string,
    sessionId?: string
): Promise<OpenVikingPrefetchResult> {
    if (!config.prefetchEnabled) {
        return { block: '', source: 'none', diagnostics: ['prefetch_disabled'] };
    }

    const toolPath = getOpenVikingToolPath(workspacePath, agentId);
    if (!toolPath) {
        return { block: '', source: 'none', diagnostics: ['tool_missing'] };
    }

    const diagnostics: string[] = [];
    if (config.searchNativeEnabled) {
        const searchLimit = Math.max(config.prefetchMaxHits * 2, 12);
        const runNativeSearchAttempt = async (scope: 'session' | 'global', sid?: string): Promise<ReturnType<typeof parseOpenVikingSearchHits>> => {
            const args = [
                'search',
                query,
                '--limit', String(searchLimit),
            ];
            if (config.searchScoreThreshold !== undefined) {
                args.push('--score-threshold', config.searchScoreThreshold);
            }
            if (scope === 'session' && sid) {
                args.push('--session-id', sid);
            }
            const searchResponse = await runOpenVikingToolJson(config, workspacePath, agentId, args, config.prefetchTimeoutMs);
            return parseOpenVikingSearchHits(searchResponse);
        };

        try {
            if (sessionId) {
                try {
                    const sessionHits = await runNativeSearchAttempt('session', sessionId);
                    if (sessionHits.length > 0) {
                        const distribution = summarizeOpenVikingSearchHitDistribution(sessionHits.slice(0, config.prefetchMaxHits));
                        return {
                            block: buildOpenVikingSearchPrefetchBlock(sessionHits, config.prefetchMaxChars, config.prefetchMaxHits),
                            source: 'search_native',
                            diagnostics: ['session_id_used=1', `native_search_hits=${sessionHits.length}`],
                            distribution,
                        };
                    }
                    diagnostics.push('native_search_empty_session');
                } catch (error) {
                    diagnostics.push(`native_search_error_session=${(error as Error).message}`);
                }

                // Some OpenViking query planners can return an empty plan when scoped by session.
                // Retry globally before falling back to legacy markdown retrieval.
                diagnostics.push('native_search_retry_without_session');
            }

            const globalHits = await runNativeSearchAttempt('global');
            if (globalHits.length > 0) {
                const distribution = summarizeOpenVikingSearchHitDistribution(globalHits.slice(0, config.prefetchMaxHits));
                return {
                    block: buildOpenVikingSearchPrefetchBlock(globalHits, config.prefetchMaxChars, config.prefetchMaxHits),
                    source: 'search_native',
                    diagnostics: ['session_id_used=0', `native_search_hits=${globalHits.length}`, ...diagnostics],
                    distribution,
                };
            }
            diagnostics.push('native_search_empty_global');
        } catch (error) {
            diagnostics.push(`native_search_error_global=${(error as Error).message}`);
        }
    } else {
        diagnostics.push('native_search_disabled');
    }

    const legacy = await fetchLegacyOpenVikingPrefetchContext(config, workspacePath, agentId, query);
    const fallbackReason = config.searchNativeEnabled
        ? 'native_search_no_hits_or_error'
        : 'native_search_flag_disabled';
    return {
        block: legacy.block,
        source: legacy.block ? 'legacy_markdown' : 'none',
        diagnostics: [...diagnostics, ...legacy.diagnostics],
        fallbackReason,
    };
}

function asPluginState(value: unknown): OpenVikingPluginState {
    const node = (value && typeof value === 'object' && !Array.isArray(value))
        ? value as Record<string, unknown>
        : {};
    const openVikingSessionId = typeof node.openVikingSessionId === 'string' && node.openVikingSessionId.trim()
        ? node.openVikingSessionId
        : null;
    return {
        openVikingSessionId,
        nativeSessionWriteFailed: node.nativeSessionWriteFailed === true,
    };
}

async function onSessionReset(ctx: SessionResetContext): Promise<void> {
    const config = resolveOpenVikingContextConfig(ctx.settings);
    if (!config.enabled) return;

    if (!ctx.isInternal && config.sessionNativeEnabled) {
        const sessionMapKey = resolveSessionMapKey(ctx.messageData, ctx.agentId);
        await commitMappedNativeSessionAndClear(
            config,
            ctx.workspacePath,
            sessionMapKey,
            'session_reset',
            'OpenViking reset consumed'
        );
    }

    if (config.autosyncFallbackEnabled) {
        enqueueOpenVikingSync(ctx.agentId, async () => {
            await finalizeOpenVikingSession(config, ctx.workspacePath, ctx.agentId);
            log('INFO', `OpenViking legacy markdown session finalized for @${ctx.agentId}`);
        });
    }
}

async function beforeModel(ctx: BeforeModelContext): Promise<BeforeModelHookResult | void> {
    const config = resolveOpenVikingContextConfig(ctx.settings);
    if (!config.enabled) return;

    let message = ctx.message;
    let sessionUserMessage = ctx.userMessageForSession;
    const sessionMapKey = !ctx.isInternal ? resolveSessionMapKey(ctx.messageData, ctx.agentId) : null;
    let openVikingSessionId: string | null = null;
    let nativeSessionWriteFailed = false;

    if (!ctx.isInternal && config.sessionNativeEnabled && sessionMapKey) {
        const switchDirective = matchSessionSwitchDirective(message, config.sessionSwitchMarkers);
        if (switchDirective.matched) {
            await commitMappedNativeSessionAndClear(
                config,
                ctx.workspacePath,
                sessionMapKey,
                `task_switch:${switchDirective.marker || 'marker'}`,
                'OpenViking session switch consumed'
            );
            if (switchDirective.strippedMessage) {
                message = switchDirective.strippedMessage;
                sessionUserMessage = switchDirective.strippedMessage;
                log('INFO', `OpenViking session switch marker consumed for @${ctx.agentId}: marker=${switchDirective.marker}`);
            } else {
                log('INFO', `OpenViking session switch marker detected for @${ctx.agentId}: marker=${switchDirective.marker} message_retained=1`);
            }
        }

        if (config.sessionIdleTimeoutMs > 0) {
            const existingEntry = getOpenVikingSessionEntry(sessionMapKey);
            if (existingEntry && existingEntry.updatedAt) {
                const lastUpdatedAt = Date.parse(existingEntry.updatedAt);
                if (Number.isFinite(lastUpdatedAt)) {
                    const idleMs = Date.now() - lastUpdatedAt;
                    if (idleMs >= config.sessionIdleTimeoutMs) {
                        log(
                            'INFO',
                            `OpenViking idle timeout reached for @${ctx.agentId}: session_id=${existingEntry.sessionId} idle_ms=${idleMs} threshold_ms=${config.sessionIdleTimeoutMs}`
                        );
                        await commitMappedNativeSessionAndClear(
                            config,
                            ctx.workspacePath,
                            sessionMapKey,
                            `idle_timeout:${config.sessionIdleTimeoutMs}ms`,
                            'OpenViking idle timeout consumed'
                        );
                    }
                }
            }
        }

        try {
            const ensured = await ensureOpenVikingNativeSession(config, ctx.workspacePath, ctx.agentId, sessionMapKey);
            openVikingSessionId = ensured.sessionId;
            log('INFO', `OpenViking session resolved for @${ctx.agentId}: session_id=${openVikingSessionId} status=${ensured.isNew ? 'created' : 'reused'}`);
        } catch (error) {
            nativeSessionWriteFailed = true;
            log('WARN', `OpenViking session setup failed for @${ctx.agentId}: ${(error as Error).message}`);
        }
    }

    if (!ctx.isInternal) {
        try {
            const prefetch = await fetchOpenVikingPrefetchContext(
                config,
                ctx.workspacePath,
                ctx.agentId,
                message,
                openVikingSessionId || undefined
            );
            if (prefetch.block) {
                writeNativePrefetchDump(config, ctx.agentId, message, openVikingSessionId || undefined, prefetch);
                message += `\n\n------\n\n${prefetch.block}\n[End OpenViking Context]`;
                const distributionSummary = maybeDistributionSummary(prefetch.distribution);
                log('INFO', `OpenViking prefetch hit for @${ctx.agentId}: source=${prefetch.source} distribution=${distributionSummary} injected_chars=${prefetch.block.length}`);
                if (prefetch.fallbackReason) {
                    log('INFO', `OpenViking prefetch fallback for @${ctx.agentId}: reason=${prefetch.fallbackReason} diagnostics=${prefetch.diagnostics.join(' | ')}`);
                }
            } else {
                log('INFO', `OpenViking prefetch miss for @${ctx.agentId}: source=${prefetch.source} diagnostics=${prefetch.diagnostics.join(' | ')}`);
            }
        } catch (error) {
            log('WARN', `OpenViking prefetch skipped for @${ctx.agentId}: ${(error as Error).message}`);
        }
    }

    if (!ctx.isInternal && config.sessionNativeEnabled) {
        if (openVikingSessionId) {
            try {
                await appendNativeOpenVikingSessionMessage(
                    config,
                    ctx.workspacePath,
                    ctx.agentId,
                    openVikingSessionId,
                    'user',
                    sessionUserMessage
                );
                if (sessionMapKey) {
                    touchOpenVikingSessionId(sessionMapKey);
                }
            } catch (error) {
                nativeSessionWriteFailed = true;
                log('WARN', `OpenViking session write failed for @${ctx.agentId}: session_id=${openVikingSessionId} role=user error=${(error as Error).message}`);
            }
        } else {
            nativeSessionWriteFailed = true;
            log('WARN', `OpenViking session write skipped for @${ctx.agentId}: session_id_unavailable`);
        }
    }

    return {
        message,
        state: {
            openVikingSessionId,
            nativeSessionWriteFailed,
        } satisfies OpenVikingPluginState,
    };
}

async function afterModel(ctx: Parameters<NonNullable<Hooks['afterModel']>>[0]): Promise<void> {
    const config = resolveOpenVikingContextConfig(ctx.settings);
    if (!config.enabled) return;

    const pluginState = asPluginState(ctx.state);
    const openVikingSessionId = pluginState.openVikingSessionId;
    const sessionMapKey = !ctx.isInternal ? resolveSessionMapKey(ctx.messageData, ctx.agentId) : null;
    let nativeSessionWriteFailed = pluginState.nativeSessionWriteFailed;

    if (!ctx.isInternal && config.sessionNativeEnabled && openVikingSessionId) {
        try {
            await appendNativeOpenVikingSessionMessage(
                config,
                ctx.workspacePath,
                ctx.agentId,
                openVikingSessionId,
                'assistant',
                ctx.response
            );
            if (sessionMapKey) {
                touchOpenVikingSessionId(sessionMapKey);
            }
        } catch (error) {
            nativeSessionWriteFailed = true;
            log('WARN', `OpenViking session write failed for @${ctx.agentId}: session_id=${openVikingSessionId} role=assistant error=${(error as Error).message}`);
        }
    }

    const shouldUseLegacyWriteback = config.autosyncFallbackEnabled && (
        ctx.isInternal
        || !config.sessionNativeEnabled
        || nativeSessionWriteFailed
        || !openVikingSessionId
    );

    if (shouldUseLegacyWriteback) {
        const fallbackReasons: string[] = [];
        if (ctx.isInternal) fallbackReasons.push('internal_message');
        if (!config.sessionNativeEnabled) fallbackReasons.push('session_native_disabled');
        if (config.sessionNativeEnabled && !openVikingSessionId) fallbackReasons.push('session_id_unavailable');
        if (nativeSessionWriteFailed) fallbackReasons.push('native_session_write_failed');
        log('INFO', `OpenViking legacy writeback fallback for @${ctx.agentId}: reasons=${fallbackReasons.join(',') || 'unknown'}`);
        enqueueOpenVikingSync(ctx.agentId, async () => {
            await appendTurnAndSyncOpenViking(
                config,
                ctx.workspacePath,
                ctx.agentId,
                ctx.messageId,
                ctx.message,
                ctx.response,
                ctx.isInternal
            );
        });
    } else if (!ctx.isInternal && config.sessionNativeEnabled && openVikingSessionId) {
        log('INFO', `OpenViking native write path complete for @${ctx.agentId}: session_id=${openVikingSessionId}`);
    }
}

function onStartup(ctx: StartupContext): void {
    const config = resolveOpenVikingContextConfig(ctx.settings);
    if (!config.enabled) {
        log('INFO', '[plugin:openviking-context] disabled');
        return;
    }

    log(
        'INFO',
        `[plugin:openviking-context] enabled prefetch=${config.prefetchEnabled ? 1 : 0} ` +
        `session_native=${config.sessionNativeEnabled ? 1 : 0} ` +
        `search_native=${config.searchNativeEnabled ? 1 : 0} autosync=${config.autosyncFallbackEnabled ? 1 : 0} ` +
        `idle_timeout_ms=${config.sessionIdleTimeoutMs} commit_on_shutdown=${config.commitOnShutdown ? 1 : 0}`
    );
}

function onHealth(ctx: HealthContext): HealthResult {
    const config = resolveOpenVikingContextConfig(ctx.settings);
    if (!config.enabled) {
        return {
            status: 'ok',
            summary: 'disabled',
            details: {
                enabled: false,
            },
        };
    }

    return {
        status: 'ok',
        summary: 'ready',
        details: {
            enabled: true,
            prefetchEnabled: config.prefetchEnabled,
            sessionNativeEnabled: config.sessionNativeEnabled,
            searchNativeEnabled: config.searchNativeEnabled,
            autosyncFallbackEnabled: config.autosyncFallbackEnabled,
            sessionIdleTimeoutMs: config.sessionIdleTimeoutMs,
            commitOnShutdown: config.commitOnShutdown,
            sessionSwitchMarkers: config.sessionSwitchMarkers,
        },
    };
}

async function onSessionEnd(ctx: SessionEndContext): Promise<void> {
    const config = resolveOpenVikingContextConfig(ctx.settings);
    if (
        config.enabled
        && config.sessionNativeEnabled
        && config.commitOnShutdown
        && ctx.reason === 'shutdown'
    ) {
        const entries = listOpenVikingSessionEntries();
        if (entries.length > 0) {
            const workspacePath = resolveWorkspacePathFromSettings(ctx.settings);
            let committed = 0;
            for (const entry of entries) {
                const didCommit = await commitMappedNativeSessionAndClear(
                    config,
                    workspacePath,
                    entry.key,
                    'process_shutdown',
                    'OpenViking shutdown drain'
                );
                if (didCommit) committed += 1;
            }
            log('INFO', `OpenViking shutdown session drain complete: committed=${committed} scanned=${entries.length}`);
        }
    }

    if (openVikingSyncChains.size === 0) return;
    await Promise.allSettled(Array.from(openVikingSyncChains.values()));
}

export const hooks: Hooks = {
    onStartup,
    onHealth,
    onSessionReset,
    beforeModel,
    afterModel,
    onSessionEnd,
};
