import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { AgentConfig, Settings } from './types';
import { TINYCLAW_HOME } from './config';
import { log } from './logging';
import { computeHeuristicScoreDelta, isLowConfidenceText, resolveMemoryRerankOptions } from './memory-rerank';

const MEMORY_ROOT = path.join(TINYCLAW_HOME, 'memory');
const MEMORY_TURNS_DIR = path.join(MEMORY_ROOT, 'turns');

const DEFAULT_TOP_K = 4;
const DEFAULT_MIN_SCORE = 0.0;
const DEFAULT_MAX_CHARS = 2500;
const DEFAULT_UPDATE_INTERVAL_SECONDS = 120;
const DEFAULT_EMBED_INTERVAL_SECONDS = 600;
const DEFAULT_RETAIN_DAYS = 30;
const DEFAULT_MAX_TURN_FILES_PER_AGENT = 2000;
const DEFAULT_CLEANUP_INTERVAL_SECONDS = 300;
const DEFAULT_PRECHECK_TIMEOUT_MS = 800;
const DEFAULT_TEXT_SEARCH_TIMEOUT_MS = 3000;
const DEFAULT_VECTOR_SEARCH_TIMEOUT_MS = 10000;
const QMD_FALLBACK_WARN_INTERVAL_MS = 10 * 60 * 1000;
const VSEARCH_EXPERIMENTAL_INFO_INTERVAL_MS = 10 * 60 * 1000;

let qmdChecked = false;
let qmdAvailable = false;
const qmdUnavailableLoggedByAgent = new Map<string, boolean>();
let qmdCommandPath: string | null = null;
let qmdCheckKey = '';
let qmdDisableExpansionCheckKey = '';
let qmdDisableExpansionSupported = false;

const collectionPrepared = new Set<string>();
const lastCollectionUpdateMs = new Map<string, number>();
const lastCollectionEmbedMs = new Map<string, number>();
const embedInFlightByCollection = new Set<string>();
const lastTurnsCleanupMs = new Map<string, number>();
const lastUnsafeFallbackWarnMsByAgent = new Map<string, number>();
const lastVsearchExperimentalInfoMsByAgent = new Map<string, number>();
export const MEMORY_ELIGIBLE_CHANNELS = new Set(['telegram', 'discord', 'whatsapp']);

interface QmdResult {
    score: number;
    snippet: string;
    source: string;
}

interface QmdConfig {
    enabled: boolean;
    command?: string;
    topK: number;
    minScore: number;
    maxChars: number;
    updateIntervalSeconds: number;
    embedIntervalSeconds: number;
    useSemanticSearch: boolean;
    disableQueryExpansion: boolean;
    allowUnsafeVsearch: boolean;
    quickPrecheckEnabled: boolean;
    precheckTimeoutMs: number;
    searchTimeoutMs: number;
    vectorSearchTimeoutMs: number;
    debugLogging: boolean;
}

interface CommandResult {
    stdout: string;
    stderr: string;
}

interface QueryResult {
    results: QmdResult[];
    query: string;
}

interface TurnSections {
    user: string;
    assistant: string;
}

interface RetentionConfig {
    enabled: boolean;
    retainDays: number;
    maxTurnFilesPerAgent: number;
    cleanupIntervalSeconds: number;
}

function getQmdConfig(settings: Settings): QmdConfig {
    const memoryCfg = settings.memory?.qmd;
    const command = typeof memoryCfg?.command === 'string' ? memoryCfg.command.trim() : '';
    return {
        enabled: settings.memory?.enabled === true && memoryCfg?.enabled !== false,
        command: command || undefined,
        topK: Number.isFinite(memoryCfg?.top_k) ? Math.max(1, Number(memoryCfg?.top_k)) : DEFAULT_TOP_K,
        minScore: Number.isFinite(memoryCfg?.min_score) ? Number(memoryCfg?.min_score) : DEFAULT_MIN_SCORE,
        maxChars: Number.isFinite(memoryCfg?.max_chars) ? Math.max(500, Number(memoryCfg?.max_chars)) : DEFAULT_MAX_CHARS,
        updateIntervalSeconds: Number.isFinite(memoryCfg?.update_interval_seconds)
            ? Math.max(10, Number(memoryCfg?.update_interval_seconds))
            : DEFAULT_UPDATE_INTERVAL_SECONDS,
        embedIntervalSeconds: Number.isFinite(memoryCfg?.embed_interval_seconds)
            ? Math.max(10, Number(memoryCfg?.embed_interval_seconds))
            : DEFAULT_EMBED_INTERVAL_SECONDS,
        useSemanticSearch: memoryCfg?.use_semantic_search === true,
        disableQueryExpansion: memoryCfg?.disable_query_expansion !== false,
        allowUnsafeVsearch: memoryCfg?.allow_unsafe_vsearch === true,
        quickPrecheckEnabled: memoryCfg?.quick_precheck_enabled !== false,
        precheckTimeoutMs: Number.isFinite(memoryCfg?.precheck_timeout_ms)
            ? Math.max(100, Number(memoryCfg?.precheck_timeout_ms))
            : DEFAULT_PRECHECK_TIMEOUT_MS,
        searchTimeoutMs: Number.isFinite(memoryCfg?.search_timeout_ms)
            ? Math.max(500, Number(memoryCfg?.search_timeout_ms))
            : DEFAULT_TEXT_SEARCH_TIMEOUT_MS,
        vectorSearchTimeoutMs: Number.isFinite(memoryCfg?.vector_search_timeout_ms)
            ? Math.max(1000, Number(memoryCfg?.vector_search_timeout_ms))
            : DEFAULT_VECTOR_SEARCH_TIMEOUT_MS,
        debugLogging: memoryCfg?.debug_logging === true,
    };
}

function getRetentionConfig(settings?: Settings): RetentionConfig {
    const retentionCfg = settings?.memory?.retention;
    return {
        enabled: retentionCfg?.enabled !== false,
        retainDays: Number.isFinite(retentionCfg?.retain_days)
            ? Math.max(1, Number(retentionCfg?.retain_days))
            : DEFAULT_RETAIN_DAYS,
        maxTurnFilesPerAgent: Number.isFinite(retentionCfg?.max_turn_files_per_agent)
            ? Math.max(100, Number(retentionCfg?.max_turn_files_per_agent))
            : DEFAULT_MAX_TURN_FILES_PER_AGENT,
        cleanupIntervalSeconds: Number.isFinite(retentionCfg?.cleanup_interval_seconds)
            ? Math.max(30, Number(retentionCfg?.cleanup_interval_seconds))
            : DEFAULT_CLEANUP_INTERVAL_SECONDS,
    };
}

function logQmdDebug(agentId: string, qmdCfg: QmdConfig, stage: string, details: string): void {
    if (!qmdCfg.debugLogging) {
        return;
    }
    log('INFO', `Memory debug @${agentId} [${stage}]: ${details}`);
}

function logThrottled(
    key: string,
    cache: Map<string, number>,
    intervalMs: number,
    level: 'INFO' | 'WARN',
    message: string
): void {
    const now = Date.now();
    const last = cache.get(key) || 0;
    if (now - last < intervalMs) {
        return;
    }
    cache.set(key, now);
    log(level, message);
}

function warnUnsafeFallback(agentId: string, reason: string): void {
    logThrottled(
        agentId,
        lastUnsafeFallbackWarnMsByAgent,
        QMD_FALLBACK_WARN_INTERVAL_MS,
        'WARN',
        `QMD vsearch fallback for @${agentId}: ${reason}`
    );
}

function infoVsearchExperimental(agentId: string): void {
    logThrottled(
        agentId,
        lastVsearchExperimentalInfoMsByAgent,
        VSEARCH_EXPERIMENTAL_INFO_INTERVAL_MS,
        'INFO',
        `QMD vsearch is experimental for @${agentId}.`
    );
}

function sanitizeId(raw: string): string {
    return raw.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

function getAgentTurnsDir(agentId: string): string {
    return path.join(MEMORY_TURNS_DIR, sanitizeId(agentId));
}

function getCollectionName(agentId: string): string {
    return `tinyclaw-${sanitizeId(agentId)}`;
}

function ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function runCommand(
    command: string,
    args: string[],
    cwd?: string,
    timeoutMs = 12000,
    env?: Record<string, string>
): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: env ? { ...process.env, ...env } : process.env,
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
        }, timeoutMs);

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => { stdout += chunk; });
        child.stderr.on('data', (chunk: string) => { stderr += chunk; });
        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (timedOut) {
                reject(new Error(`Command timed out after ${timeoutMs}ms`));
                return;
            }
            if (code === 0) {
                resolve({ stdout, stderr });
                return;
            }
            reject(new Error(stderr.trim() || `Command exited with code ${code}`));
        });
    });
}

async function isQmdAvailable(preferredCommand?: string): Promise<boolean> {
    const key = preferredCommand || '__auto__';
    if (qmdChecked && qmdCheckKey === key) {
        return qmdAvailable;
    }

    qmdChecked = true;
    qmdCheckKey = key;
    qmdAvailable = false;
    qmdCommandPath = null;

    const bundledQmd = path.join(require('os').homedir(), '.bun/bin/qmd');
    const candidates = preferredCommand ? [preferredCommand] : [bundledQmd, 'qmd'];

    try {
        for (const candidate of candidates) {
            try {
                await runCommand(candidate, ['--help'], undefined, 5000);
                qmdCommandPath = candidate;
                qmdAvailable = true;
                break;
            } catch {
                // Try next candidate.
            }
        }
    } finally {
        if (!qmdAvailable) {
            qmdCommandPath = null;
        }
    }

    return qmdAvailable;
}

function isDisableExpansionPatchedQmd(commandPath: string | null): boolean {
    if (!commandPath) {
        return false;
    }

    const bunGlobalQmd = path.join(require('os').homedir(), '.bun/bin/qmd');
    const patchedStoreTs = path.join(require('os').homedir(), '.bun/install/global/node_modules/qmd/src/store.ts');
    if (commandPath !== bunGlobalQmd || !fs.existsSync(patchedStoreTs)) {
        return false;
    }

    try {
        const src = fs.readFileSync(patchedStoreTs, 'utf8');
        return src.includes('QMD_VSEARCH_DISABLE_EXPANSION');
    } catch {
        return false;
    }
}

function isDisableExpansionSupported(): boolean {
    const key = qmdCommandPath || '__unknown__';
    if (qmdDisableExpansionCheckKey === key) {
        return qmdDisableExpansionSupported;
    }

    qmdDisableExpansionCheckKey = key;
    qmdDisableExpansionSupported = isDisableExpansionPatchedQmd(qmdCommandPath);
    return qmdDisableExpansionSupported;
}

function shouldUseMemoryForChannel(channel: string): boolean {
    return MEMORY_ELIGIBLE_CHANNELS.has(channel);
}

async function ensureCollection(agentId: string): Promise<string> {
    ensureDir(MEMORY_ROOT);
    const agentTurnsDir = getAgentTurnsDir(agentId);
    ensureDir(agentTurnsDir);

    const collectionName = getCollectionName(agentId);
    if (!collectionPrepared.has(collectionName)) {
        try {
            await runCommand(qmdCommandPath || 'qmd', ['collection', 'add', agentTurnsDir, '--name', collectionName, '--mask', '**/*.md'], undefined, 10000);
            collectionPrepared.add(collectionName);
        } catch (error) {
            const msg = (error as Error).message.toLowerCase();
            if (msg.includes('already') || msg.includes('exists')) {
                collectionPrepared.add(collectionName);
            } else {
                throw error;
            }
        }
    }

    return collectionName;
}

async function maybeUpdateCollection(collectionName: string, updateIntervalSeconds: number): Promise<void> {
    const now = Date.now();
    const last = lastCollectionUpdateMs.get(collectionName) || 0;
    if (now - last < updateIntervalSeconds * 1000) {
        return;
    }
    await runCommand(qmdCommandPath || 'qmd', ['update', '--collections', collectionName], undefined, 15000);
    lastCollectionUpdateMs.set(collectionName, now);
}

async function maybeEmbedCollection(collectionName: string, embedIntervalSeconds: number): Promise<void> {
    const now = Date.now();
    const last = lastCollectionEmbedMs.get(collectionName) || 0;
    if (now - last < embedIntervalSeconds * 1000) {
        return;
    }
    // Apply backoff from the trigger time to avoid tight retries on repeated failures.
    lastCollectionEmbedMs.set(collectionName, now);
    await runCommand(qmdCommandPath || 'qmd', ['embed', '--collections', collectionName], undefined, 30000);
}

function triggerEmbedCollectionAsync(agentId: string, collectionName: string, qmdCfg: QmdConfig): void {
    if (embedInFlightByCollection.has(collectionName)) {
        logQmdDebug(agentId, qmdCfg, 'embed', 'skip trigger (in-flight)');
        return;
    }
    embedInFlightByCollection.add(collectionName);
    void maybeEmbedCollection(collectionName, qmdCfg.embedIntervalSeconds)
        .then(() => {
            logQmdDebug(agentId, qmdCfg, 'embed', `triggered interval=${qmdCfg.embedIntervalSeconds}s`);
        })
        .catch((error) => {
            log('WARN', `Memory embed skipped for @${agentId}: ${(error as Error).message}`);
            logQmdDebug(agentId, qmdCfg, 'embed', 'failed; continuing with existing vectors');
        })
        .finally(() => {
            embedInFlightByCollection.delete(collectionName);
        });
}

function buildLexicalQueryVariants(message: string): string[] {
    const variants: string[] = [];
    const push = (value: string) => {
        const cleaned = value.trim().replace(/\s+/g, ' ');
        if (!cleaned) {
            return;
        }
        if (!variants.includes(cleaned)) {
            variants.push(cleaned);
        }
    };

    push(message);

    const noPunct = message.replace(/[?？!！,，.。;；:：]/g, ' ');
    push(noPunct);

    // Chinese question-particle normalization to reduce BM25 false negatives.
    const zhSimplified = noPunct
        .replace(/是什么|是啥|什么|多少|几点|哪里|哪儿|哪个|哪位|谁|吗|呢|来着/g, ' ')
        .replace(/\s+/g, ' ');
    push(zhSimplified);

    // English question-word normalization.
    const enSimplified = noPunct
        .replace(/\b(what|which|who|where|when|why|how)\b/gi, ' ')
        .replace(/\s+/g, ' ');
    push(enSimplified);

    // Code-friendly variant: treat hyphen as delimiter.
    push(noPunct.replace(/-/g, ' '));

    return variants;
}

function parseQmdResults(raw: string): QmdResult[] {
    const trimmed = raw.trim();
    if (!trimmed) {
        return [];
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed);
    } catch {
        return [];
    }

    const rows = Array.isArray(parsed)
        ? parsed
        : (parsed as { results?: unknown[] }).results || [];

    const results: QmdResult[] = [];
    for (const row of rows) {
        if (!row || typeof row !== 'object') {
            continue;
        }
        const r = row as Record<string, unknown>;
        const score = typeof r.score === 'number' ? r.score : 0;
        const snippet = String(r.snippet || r.context || r.text || r.content || '').trim();
        const source = String(r.path || r.file || r.source || r.title || '').trim();
        if (!snippet) {
            continue;
        }
        results.push({ score, snippet, source });
    }
    return results;
}

function normalizeInline(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function normalizeQueryKey(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeFilenameKey(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function truncateInline(text: string, max: number): string {
    if (text.length <= max) {
        return text;
    }
    return `${text.slice(0, max)}...`;
}

function summarizeSnippetForLog(text: string, max = 120): string {
    const oneLine = normalizeInline(text).replace(/\n/g, ' ');
    return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max)}...`;
}

function parseTurnSections(content: string): TurnSections {
    const userMarker = '\n## User\n';
    const assistantMarker = '\n## Assistant\n';
    const userPos = content.indexOf(userMarker);
    const assistantPos = content.indexOf(assistantMarker);
    if (userPos < 0 || assistantPos < 0 || assistantPos <= userPos) {
        return { user: '', assistant: '' };
    }
    const userStart = userPos + userMarker.length;
    const userText = content.slice(userStart, assistantPos).trim();
    const assistantStart = assistantPos + assistantMarker.length;
    const assistantText = content.slice(assistantStart).trim();
    return { user: userText, assistant: assistantText };
}

function loadTurnSectionsFromSource(source: string, agentId: string): TurnSections | null {
    const m = source.match(/^qmd:\/\/[^/]+\/(.+)$/);
    if (!m) {
        return null;
    }
    const rel = decodeURIComponent(m[1]);
    const agentDir = getAgentTurnsDir(agentId);
    let fullPath = path.join(agentDir, rel);
    if (!fs.existsSync(fullPath)) {
        // qmd may normalize source path (e.g. casing and punctuation like "_" -> "-").
        // Resolve with a tolerant fallback so we can hydrate turn sections reliably.
        const wanted = normalizeFilenameKey(path.basename(rel));
        try {
            const found = fs.readdirSync(agentDir).find(name => normalizeFilenameKey(name) === wanted);
            if (found) {
                fullPath = path.join(agentDir, found);
            }
        } catch {
            return null;
        }
    }
    if (!fs.existsSync(fullPath)) {
        return null;
    }
    try {
        const content = fs.readFileSync(fullPath, 'utf8');
        return parseTurnSections(content);
    } catch {
        return null;
    }
}

function rerankAndHydrateResults(results: QmdResult[], message: string, agentId: string, settings?: Settings): QmdResult[] {
    if (results.length === 0) {
        return results;
    }
    const terms = Array.from(new Set((message.toLowerCase().match(/[a-z0-9_-]{2,}|[\u4e00-\u9fff]{1,3}/g) || [])));
    const rerankOptions = resolveMemoryRerankOptions(settings);
    const normalizedMessage = normalizeQueryKey(message);

    return results
        .map((result) => {
            let score = result.score;
            let snippet = result.snippet;

            const sections = loadTurnSectionsFromSource(result.source, agentId);
            if (sections && sections.assistant) {
                const user = normalizeInline(sections.user);
                const assistant = normalizeInline(sections.assistant);
                if (assistant) {
                    snippet = `User: ${truncateInline(user, 180)}\nAssistant: ${truncateInline(assistant, 260)}`;
                }

                score += computeHeuristicScoreDelta(user, assistant, terms, rerankOptions);
                const lowConfidence = isLowConfidenceText(assistant, rerankOptions);
                if (lowConfidence) {
                    return null;
                }
            }

            return { score, snippet, source: result.source };
        })
        .filter((row): row is QmdResult => !!row)
        .sort((a, b) => b.score - a.score);
}

async function quickHasLexicalHit(
    variants: string[],
    collectionName: string,
    qmdCfg: QmdConfig
): Promise<boolean> {
    for (const query of variants) {
        const args = ['search', query, '--json', '-c', collectionName, '-n', '1', '--min-score', String(qmdCfg.minScore)];
        const { stdout } = await runCommand(qmdCommandPath || 'qmd', args, undefined, qmdCfg.precheckTimeoutMs);
        const hits = parseQmdResults(stdout);
        if (hits.length > 0) {
            return true;
        }
    }
    return false;
}

function formatMemoryPrompt(results: QmdResult[], maxChars: number): string {
    if (results.length === 0) {
        return '';
    }

    const blocks: string[] = [];
    let usedChars = 0;

    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const block = [
            `Snippet ${i + 1} (score=${result.score.toFixed(3)}):`,
            result.source ? `Source: ${result.source}` : 'Source: unknown',
            result.snippet,
        ].join('\n');

        if (usedChars + block.length > maxChars) {
            break;
        }
        blocks.push(block);
        usedChars += block.length;
    }

    if (blocks.length === 0) {
        return '';
    }

    return [
        '',
        '---',
        'Retrieved memory snippets (from past conversations):',
        'Use only if relevant. Prioritize current user instructions over old memory.',
        '',
        blocks.join('\n\n'),
    ].join('\n');
}

function resolveRetrievalMode(agentId: string, qmdCfg: QmdConfig): { useVsearch: boolean; label: 'qmd-bm25' | 'qmd-vsearch' } {
    let useVsearch = qmdCfg.useSemanticSearch;
    if (useVsearch && !qmdCfg.allowUnsafeVsearch) {
        if (!qmdCfg.disableQueryExpansion) {
            useVsearch = false;
            warnUnsafeFallback(agentId, 'disable_query_expansion is false; using BM25. Set memory.qmd.allow_unsafe_vsearch=true to override.');
        } else if (!isDisableExpansionSupported()) {
            useVsearch = false;
            warnUnsafeFallback(agentId, 'safe vsearch support not detected; using BM25. Run scripts/patch-qmd-no-expansion.sh or set memory.qmd.allow_unsafe_vsearch=true.');
        }
    }
    if (useVsearch) {
        infoVsearchExperimental(agentId);
    }

    return {
        useVsearch,
        label: useVsearch ? 'qmd-vsearch' : 'qmd-bm25',
    };
}

async function runBm25WithVariants(
    variants: string[],
    fallbackQuery: string,
    collectionName: string,
    qmdCfg: QmdConfig
): Promise<QueryResult> {
    let lastQuery = fallbackQuery;
    for (const query of variants) {
        lastQuery = query;
        const args = ['search', query, '--json', '-c', collectionName, '-n', String(qmdCfg.topK), '--min-score', String(qmdCfg.minScore)];
        const { stdout } = await runCommand(qmdCommandPath || 'qmd', args, undefined, qmdCfg.searchTimeoutMs);
        const results = parseQmdResults(stdout);
        if (results.length > 0) {
            return { results, query };
        }
    }
    return { results: [], query: lastQuery };
}

export async function buildMemoryBlock(
    agentId: string,
    message: string,
    settings: Settings,
    sourceChannel: string
): Promise<string> {
    const qmdCfg = getQmdConfig(settings);
    if (!qmdCfg.enabled) {
        return '';
    }
    if (!shouldUseMemoryForChannel(sourceChannel)) {
        return '';
    }

    const hasQmd = await isQmdAvailable(qmdCfg.command);
    if (!hasQmd) {
        if (!qmdUnavailableLoggedByAgent.get(agentId)) {
            log('WARN', `qmd not found in PATH, memory retrieval disabled for @${agentId}`);
            qmdUnavailableLoggedByAgent.set(agentId, true);
        }
        log('INFO', `Memory source for @${agentId}: none (qmd unavailable)`);
        return '';
    }
    qmdUnavailableLoggedByAgent.delete(agentId);
    logQmdDebug(agentId, qmdCfg, 'qmd', `command=${qmdCommandPath || 'qmd'}`);

    try {
        const collectionName = await ensureCollection(agentId);
        logQmdDebug(agentId, qmdCfg, 'collection', `name=${collectionName}`);
        await maybeUpdateCollection(collectionName, qmdCfg.updateIntervalSeconds);
        logQmdDebug(agentId, qmdCfg, 'update', `interval=${qmdCfg.updateIntervalSeconds}s`);

        const mode = resolveRetrievalMode(agentId, qmdCfg);
        const queryVariants = buildLexicalQueryVariants(message);

        // Only keep precheck for vsearch path. For BM25 it duplicates work and adds latency.
        if (qmdCfg.quickPrecheckEnabled && mode.useVsearch) {
            try {
                logQmdDebug(
                    agentId,
                    qmdCfg,
                    'precheck',
                    `cmd=search timeout=${qmdCfg.precheckTimeoutMs}ms min_score=${qmdCfg.minScore} variants=${queryVariants.length}`
                );
                const hasQuickHit = await quickHasLexicalHit(queryVariants, collectionName, qmdCfg);
                if (!hasQuickHit) {
                    log('INFO', `Memory source for @${agentId}: none (qmd precheck no-hit)`);
                    return '';
                }
            } catch (error) {
                log('WARN', `Memory quick precheck skipped for @${agentId}: ${(error as Error).message}`);
                log('INFO', `Memory source for @${agentId}: none (qmd precheck error)`);
                return '';
            }
        } else if (qmdCfg.quickPrecheckEnabled && !mode.useVsearch) {
            logQmdDebug(agentId, qmdCfg, 'precheck', 'skipped for bm25 mode (avoid duplicate searches)');
        }

        if (mode.useVsearch) {
            triggerEmbedCollectionAsync(agentId, collectionName, qmdCfg);
        }
        const queryArgs = mode.useVsearch
            ? ['vsearch', message, '--json', '-c', collectionName, '-n', String(qmdCfg.topK), '--min-score', String(qmdCfg.minScore)]
            : ['search', message, '--json', '-c', collectionName, '-n', String(qmdCfg.topK), '--min-score', String(qmdCfg.minScore)];
        const queryEnv = mode.useVsearch && qmdCfg.disableQueryExpansion
            ? { QMD_VSEARCH_DISABLE_EXPANSION: '1' }
            : undefined;
        const queryTimeoutMs = mode.useVsearch ? qmdCfg.vectorSearchTimeoutMs : qmdCfg.searchTimeoutMs;
        logQmdDebug(
            agentId,
            qmdCfg,
            'query',
            `mode=${mode.label} timeout=${queryTimeoutMs}ms top_k=${qmdCfg.topK} min_score=${qmdCfg.minScore} disable_expansion=${qmdCfg.disableQueryExpansion}`
        );

        const queryResult = mode.useVsearch
            ? (() => runCommand(qmdCommandPath || 'qmd', queryArgs, undefined, queryTimeoutMs, queryEnv).then(({ stdout }) => ({
                results: parseQmdResults(stdout),
                query: message,
            })))()
            : runBm25WithVariants(queryVariants, message, collectionName, qmdCfg);
        let { results, query } = await queryResult;
        logQmdDebug(agentId, qmdCfg, 'query-used', `mode=${mode.label} query=\"${query}\"`);
        if (results.length === 0) {
            log('INFO', `Memory source for @${agentId}: none (${mode.label} no-hit)`);
            return '';
        }

        let rankedResults = rerankAndHydrateResults(results, message, agentId, settings);
        logQmdDebug(
            agentId,
            qmdCfg,
            'rerank',
            `raw=${results.length} ranked=${rankedResults.length} top=${rankedResults
                .slice(0, 3)
                .map((r, i) => `${i + 1}:${r.score.toFixed(3)}:${summarizeSnippetForLog(r.snippet, 90)}`)
                .join(' | ')}`
        );
        if (mode.useVsearch && rankedResults.length === 0) {
            logQmdDebug(agentId, qmdCfg, 'query', 'vsearch results filtered out; fallback=bm25');
            const bm25Fallback = await runBm25WithVariants(queryVariants, message, collectionName, qmdCfg);
            results = bm25Fallback.results;
            query = bm25Fallback.query;
            logQmdDebug(agentId, qmdCfg, 'query-used', `mode=qmd-bm25-fallback query=\"${query}\"`);
            if (results.length === 0) {
                log('INFO', `Memory source for @${agentId}: none (qmd-vsearch filtered + bm25 no-hit)`);
                return '';
            }
            rankedResults = rerankAndHydrateResults(results, message, agentId, settings);
            logQmdDebug(
                agentId,
                qmdCfg,
                'rerank',
                `fallback raw=${results.length} ranked=${rankedResults.length} top=${rankedResults
                    .slice(0, 3)
                    .map((r, i) => `${i + 1}:${r.score.toFixed(3)}:${summarizeSnippetForLog(r.snippet, 90)}`)
                    .join(' | ')}`
            );
            if (rankedResults.length === 0) {
                log('INFO', `Memory source for @${agentId}: none (qmd-vsearch filtered + bm25 filtered)`);
                return '';
            }
        }

        const memoryBlock = formatMemoryPrompt(rankedResults, qmdCfg.maxChars);
        if (!memoryBlock) {
            log('INFO', `Memory source for @${agentId}: none (${mode.label} no-usable-snippet)`);
            return '';
        }

        log('INFO', `Memory retrieval hit for @${agentId}: ${rankedResults.length} snippet(s) via ${mode.label}`);
        log('INFO', `Memory source for @${agentId}: ${mode.label}`);
        return memoryBlock;
    } catch (error) {
        log('WARN', `Memory retrieval skipped for @${agentId}: ${(error as Error).message}`);
        log('INFO', `Memory source for @${agentId}: none (qmd error)`);
        return '';
    }
}

export async function enrichMessageWithMemory(
    agentId: string,
    message: string,
    settings: Settings,
    sourceChannel: string
): Promise<string> {
    const memoryBlock = await buildMemoryBlock(agentId, message, settings, sourceChannel);
    return memoryBlock ? `${message}${memoryBlock}` : message;
}

function timestampFilename(ts: number): string {
    return new Date(ts).toISOString().replace(/[:.]/g, '-').toLowerCase();
}

function truncate(text: string, max = 16000): string {
    if (text.length <= max) {
        return text;
    }
    return `${text.substring(0, max)}\n\n[truncated]`;
}

function maybeCleanupTurns(agentId: string, settings?: Settings): void {
    const retention = getRetentionConfig(settings);
    if (!retention.enabled) {
        return;
    }

    const now = Date.now();
    const last = lastTurnsCleanupMs.get(agentId) || 0;
    if (now - last < retention.cleanupIntervalSeconds * 1000) {
        return;
    }
    lastTurnsCleanupMs.set(agentId, now);

    const dir = getAgentTurnsDir(agentId);
    if (!fs.existsSync(dir)) {
        return;
    }

    let entries = fs.readdirSync(dir)
        .filter(name => name.endsWith('.md'))
        .map(name => {
            const filePath = path.join(dir, name);
            const stat = fs.statSync(filePath);
            return {
                name,
                filePath,
                mtimeMs: stat.mtimeMs,
            };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

    if (entries.length === 0) {
        return;
    }

    const cutoffMs = now - retention.retainDays * 24 * 60 * 60 * 1000;
    const keep: typeof entries = [];
    const remove: typeof entries = [];

    for (const e of entries) {
        if (e.mtimeMs < cutoffMs) {
            remove.push(e);
        } else {
            keep.push(e);
        }
    }

    if (keep.length > retention.maxTurnFilesPerAgent) {
        const overflow = keep.slice(retention.maxTurnFilesPerAgent);
        remove.push(...overflow);
        keep.splice(retention.maxTurnFilesPerAgent);
    }

    if (remove.length === 0) {
        return;
    }

    let deleted = 0;
    for (const e of remove) {
        try {
            fs.unlinkSync(e.filePath);
            deleted++;
        } catch {
            // Keep going; best-effort cleanup.
        }
    }
    if (deleted > 0) {
        log('INFO', `Memory turns cleanup for @${agentId}: deleted ${deleted} file(s), kept ${keep.length}`);
    }
}

export async function saveTurnToMemory(params: {
    agentId: string;
    agent: AgentConfig;
    channel: string;
    sender: string;
    messageId: string;
    userMessage: string;
    agentResponse: string;
    timestampMs?: number;
    settings?: Settings;
}): Promise<void> {
    try {
        const timestampMs = params.timestampMs || Date.now();
        const dir = getAgentTurnsDir(params.agentId);
        ensureDir(dir);

        const fileName = `${timestampFilename(timestampMs)}-${params.messageId}.md`;
        const filePath = path.join(dir, fileName);
        const lines = [
            `# Turn for @${params.agentId} (${params.agent.name})`,
            '',
            `- Timestamp: ${new Date(timestampMs).toISOString()}`,
            `- Channel: ${params.channel}`,
            `- Sender: ${params.sender}`,
            `- Message ID: ${params.messageId}`,
            '',
            '## User',
            '',
            truncate(params.userMessage),
            '',
            '## Assistant',
            '',
            truncate(params.agentResponse),
            '',
        ];

        fs.writeFileSync(filePath, lines.join('\n'));
        maybeCleanupTurns(params.agentId, params.settings);
    } catch (error) {
        log('WARN', `Failed to persist memory turn for @${params.agentId}: ${(error as Error).message}`);
    }
}
