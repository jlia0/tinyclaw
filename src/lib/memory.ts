import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { AgentConfig, Settings } from './types';
import { TINYCLAW_HOME } from './config';
import { log } from './logging';

const MEMORY_ROOT = path.join(TINYCLAW_HOME, 'memory');
const MEMORY_TURNS_DIR = path.join(MEMORY_ROOT, 'turns');

const DEFAULT_TOP_K = 4;
const DEFAULT_MIN_SCORE = 0.0;
const DEFAULT_MAX_CHARS = 2500;
const DEFAULT_UPDATE_INTERVAL_SECONDS = 120;
const DEFAULT_PRECHECK_TIMEOUT_MS = 800;
const DEFAULT_TEXT_SEARCH_TIMEOUT_MS = 3000;
const DEFAULT_VECTOR_SEARCH_TIMEOUT_MS = 10000;

let qmdChecked = false;
let qmdAvailable = false;
let qmdUnavailableLogged = false;
let qmdCommandPath: string | null = null;
let qmdCheckKey = '';
let qmdDisableExpansionCheckKey = '';
let qmdDisableExpansionSupported = false;
let qmdUnsafeFallbackLogged = false;

const collectionPrepared = new Set<string>();
const lastCollectionUpdateMs = new Map<string, number>();
const MEMORY_CHANNELS = new Set(['telegram', 'discord', 'whatsapp']);

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

function logQmdDebug(agentId: string, qmdCfg: QmdConfig, stage: string, details: string): void {
    if (!qmdCfg.debugLogging) {
        return;
    }
    log('INFO', `Memory debug @${agentId} [${stage}]: ${details}`);
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
    return MEMORY_CHANNELS.has(channel);
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

function truncateInline(text: string, max: number): string {
    if (text.length <= max) {
        return text;
    }
    return `${text.slice(0, max)}...`;
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
    const fullPath = path.join(getAgentTurnsDir(agentId), rel);
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

function isLowConfidenceAnswer(text: string): boolean {
    return /不知道|没有.*信息|无法|不清楚|need more context|don't have any information|i don't have|not enough information/i.test(text);
}

function rerankAndHydrateResults(results: QmdResult[], message: string, agentId: string): QmdResult[] {
    if (results.length === 0) {
        return results;
    }
    const terms = Array.from(new Set((message.toLowerCase().match(/[a-z0-9_-]{2,}|[\u4e00-\u9fff]{1,3}/g) || [])));
    const codePattern = /\b[A-Z]{3,}(?:-[A-Z0-9]+){2,}\b/;

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

                if (codePattern.test(assistant)) score += 0.5;
                if (/代号|key|code|是|喜欢|likes?/i.test(assistant)) score += 0.2;
                if (isLowConfidenceAnswer(assistant)) score -= 0.5;

                const hay = `${user} ${assistant}`.toLowerCase();
                for (const t of terms) {
                    if (hay.includes(t)) score += 0.04;
                }
            }

            return { score, snippet, source: result.source };
        })
        .sort((a, b) => b.score - a.score);
}

async function quickHasLexicalHit(message: string, collectionName: string, qmdCfg: QmdConfig): Promise<boolean> {
    const variants = buildLexicalQueryVariants(message);
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

function resolveRetrievalMode(qmdCfg: QmdConfig): { useVsearch: boolean; label: 'qmd-bm25' | 'qmd-vsearch' } {
    let useVsearch = qmdCfg.useSemanticSearch;
    if (useVsearch && !qmdCfg.allowUnsafeVsearch) {
        if (!qmdCfg.disableQueryExpansion) {
            useVsearch = false;
            if (!qmdUnsafeFallbackLogged) {
                log('WARN', 'QMD vsearch requested without disable_query_expansion; fallback to BM25 for safety. Set memory.qmd.allow_unsafe_vsearch=true to override.');
                qmdUnsafeFallbackLogged = true;
            }
        } else if (!isDisableExpansionSupported()) {
            useVsearch = false;
            if (!qmdUnsafeFallbackLogged) {
                log('WARN', 'QMD disable-query-expansion support not detected; fallback to BM25 to avoid unexpected model downloads. Run scripts/patch-qmd-no-expansion.sh or set memory.qmd.allow_unsafe_vsearch=true.');
                qmdUnsafeFallbackLogged = true;
            }
        }
    }

    return {
        useVsearch,
        label: useVsearch ? 'qmd-vsearch' : 'qmd-bm25',
    };
}

async function runBm25WithVariants(
    message: string,
    collectionName: string,
    qmdCfg: QmdConfig
): Promise<QueryResult> {
    const variants = buildLexicalQueryVariants(message);
    let lastQuery = message;
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

export async function enrichMessageWithMemory(
    agentId: string,
    message: string,
    settings: Settings,
    sourceChannel: string
): Promise<string> {
    const qmdCfg = getQmdConfig(settings);
    if (!qmdCfg.enabled) {
        return message;
    }
    if (!shouldUseMemoryForChannel(sourceChannel)) {
        return message;
    }

    const hasQmd = await isQmdAvailable(qmdCfg.command);
    if (!hasQmd) {
        if (!qmdUnavailableLogged) {
            log('WARN', 'qmd not found in PATH, memory retrieval disabled');
            qmdUnavailableLogged = true;
        }
        log('INFO', `Memory source for @${agentId}: none (qmd unavailable)`);
        return message;
    }
    logQmdDebug(agentId, qmdCfg, 'qmd', `command=${qmdCommandPath || 'qmd'}`);

    try {
        const collectionName = await ensureCollection(agentId);
        logQmdDebug(agentId, qmdCfg, 'collection', `name=${collectionName}`);
        await maybeUpdateCollection(collectionName, qmdCfg.updateIntervalSeconds);
        logQmdDebug(agentId, qmdCfg, 'update', `interval=${qmdCfg.updateIntervalSeconds}s`);

        if (qmdCfg.quickPrecheckEnabled) {
            try {
                logQmdDebug(
                    agentId,
                    qmdCfg,
                    'precheck',
                    `cmd=search timeout=${qmdCfg.precheckTimeoutMs}ms min_score=${qmdCfg.minScore} variants=${buildLexicalQueryVariants(message).length}`
                );
                const hasQuickHit = await quickHasLexicalHit(message, collectionName, qmdCfg);
                if (!hasQuickHit) {
                    log('INFO', `Memory source for @${agentId}: none (qmd precheck no-hit)`);
                    return message;
                }
            } catch (error) {
                log('WARN', `Memory quick precheck skipped for @${agentId}: ${(error as Error).message}`);
                log('INFO', `Memory source for @${agentId}: none (qmd precheck error)`);
                return message;
            }
        }

        const mode = resolveRetrievalMode(qmdCfg);
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
            : runBm25WithVariants(message, collectionName, qmdCfg);
        const { results, query } = await queryResult;
        logQmdDebug(agentId, qmdCfg, 'query-used', `mode=${mode.label} query=\"${query}\"`);
        if (results.length === 0) {
            log('INFO', `Memory source for @${agentId}: none (${mode.label} no-hit)`);
            return message;
        }

        const rankedResults = rerankAndHydrateResults(results, message, agentId);

        const memoryBlock = formatMemoryPrompt(rankedResults, qmdCfg.maxChars);
        if (!memoryBlock) {
            log('INFO', `Memory source for @${agentId}: none (${mode.label} no-usable-snippet)`);
            return message;
        }

        log('INFO', `Memory retrieval hit for @${agentId}: ${rankedResults.length} snippet(s) via ${mode.label}`);
        log('INFO', `Memory source for @${agentId}: ${mode.label}`);
        return `${message}${memoryBlock}`;
    } catch (error) {
        log('WARN', `Memory retrieval skipped for @${agentId}: ${(error as Error).message}`);
        log('INFO', `Memory source for @${agentId}: none (qmd error)`);
        return message;
    }
}

function timestampFilename(ts: number): string {
    return new Date(ts).toISOString().replace(/[:.]/g, '-');
}

function truncate(text: string, max = 16000): string {
    if (text.length <= max) {
        return text;
    }
    return `${text.substring(0, max)}\n\n[truncated]`;
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
    } catch (error) {
        log('WARN', `Failed to persist memory turn for @${params.agentId}: ${(error as Error).message}`);
    }
}
