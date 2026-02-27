import { AgentConfig } from '../../lib/types';
import { jsonrepair } from 'jsonrepair';

export type PrefetchGateMode = 'always' | 'never' | 'rule' | 'rule_then_llm';

export type PrefetchRuleGateConfig = {
    forcePatterns: string[];
    skipPatterns: string[];
    threshold: number;
    ambiguityLow: number;
    ambiguityHigh: number;
};

export type PrefetchRuleVerdict = 'yes' | 'no' | 'ambiguous';

export type PrefetchRuleEvaluation = {
    verdict: PrefetchRuleVerdict;
    reason: string;
    score: number;
};

type WeightedPattern = {
    pattern: string;
    weight: number;
    reason: string;
};

const POSITIVE_PATTERNS: WeightedPattern[] = [
    { pattern: 'memory', weight: 2, reason: 'kw_memory' },
    { pattern: 'long term memory', weight: 3, reason: 'kw_long_term_memory' },
    { pattern: 'remember', weight: 2, reason: 'kw_remember' },
    { pattern: 'recall', weight: 2, reason: 'kw_recall' },
    { pattern: 'previously told', weight: 3, reason: 'kw_previously_told' },
    { pattern: 'based on memory', weight: 3, reason: 'kw_based_on_memory' },
    { pattern: 'from memory', weight: 2, reason: 'kw_from_memory' },
    { pattern: 'earlier chat', weight: 2, reason: 'kw_earlier_chat' },
    { pattern: 'history with you', weight: 2, reason: 'kw_history' },
    { pattern: 'what do you remember', weight: 3, reason: 'kw_what_do_you_remember' },
    { pattern: 'from your memory', weight: 3, reason: 'kw_from_your_memory' },
    { pattern: 'our previous chats', weight: 2, reason: 'kw_previous_chats' },
    { pattern: 'earlier you said', weight: 2, reason: 'kw_earlier_you_said' },
    { pattern: 'what i told you before', weight: 3, reason: 'kw_told_you_before' },
    { pattern: '记忆', weight: 2, reason: 'kw_cn_memory' },
    { pattern: '长期记忆', weight: 4, reason: 'kw_cn_long_term_memory' },
    { pattern: '记得', weight: 2, reason: 'kw_cn_remember' },
    { pattern: '回忆', weight: 2, reason: 'kw_cn_recall' },
    { pattern: '之前说过', weight: 3, reason: 'kw_cn_previously_told' },
    { pattern: '之前告诉过', weight: 3, reason: 'kw_cn_previously_told_2' },
    { pattern: '根据记忆', weight: 4, reason: 'kw_cn_based_on_memory' },
    { pattern: '基于记忆', weight: 4, reason: 'kw_cn_based_on_memory_2' },
    { pattern: '只根据记忆', weight: 5, reason: 'kw_cn_memory_only' },
    { pattern: '只基于记忆', weight: 5, reason: 'kw_cn_memory_only_2' },
    { pattern: '按记忆', weight: 3, reason: 'kw_cn_by_memory' },
    { pattern: '回忆一下', weight: 3, reason: 'kw_cn_recall_now' },
    { pattern: '你记得我说过', weight: 3, reason: 'kw_cn_you_remember_i_said' },
    { pattern: '我之前提过', weight: 2, reason: 'kw_cn_i_mentioned_before' },
    { pattern: '之前聊过', weight: 2, reason: 'kw_cn_chatted_before' },
    { pattern: '根据我们之前的对话', weight: 4, reason: 'kw_cn_based_on_previous_chat' },
];

const NEGATIVE_PATTERNS: WeightedPattern[] = [
    { pattern: 'latest', weight: -3, reason: 'kw_latest' },
    { pattern: 'today', weight: -2, reason: 'kw_today' },
    { pattern: 'news', weight: -3, reason: 'kw_news' },
    { pattern: 'weather', weight: -3, reason: 'kw_weather' },
    { pattern: 'stock price', weight: -3, reason: 'kw_stock_price' },
    { pattern: 'crypto price', weight: -3, reason: 'kw_crypto_price' },
    { pattern: 'search web', weight: -4, reason: 'kw_search_web' },
    { pattern: 'web search', weight: -4, reason: 'kw_web_search' },
    { pattern: 'search online', weight: -4, reason: 'kw_search_online' },
    { pattern: 'browse internet', weight: -4, reason: 'kw_browse_internet' },
    { pattern: 'google', weight: -3, reason: 'kw_google' },
    { pattern: 'latest update', weight: -3, reason: 'kw_latest_update' },
    { pattern: 'breaking news', weight: -3, reason: 'kw_breaking_news' },
    { pattern: 'live score', weight: -3, reason: 'kw_live_score' },
    { pattern: 'price now', weight: -3, reason: 'kw_price_now' },
    { pattern: 'real time', weight: -3, reason: 'kw_real_time' },
    { pattern: 'realtime', weight: -3, reason: 'kw_realtime' },
    { pattern: 'run command', weight: -2, reason: 'kw_run_command' },
    { pattern: 'execute this command', weight: -2, reason: 'kw_execute_this_command' },
    { pattern: 'terminal command', weight: -2, reason: 'kw_terminal_command' },
    { pattern: 'shell', weight: -2, reason: 'kw_shell' },
    { pattern: 'npm ', weight: -2, reason: 'kw_npm' },
    { pattern: 'git ', weight: -2, reason: 'kw_git' },
    { pattern: '今天', weight: -2, reason: 'kw_cn_today' },
    { pattern: '最新', weight: -3, reason: 'kw_cn_latest' },
    { pattern: '新闻', weight: -3, reason: 'kw_cn_news' },
    { pattern: '天气', weight: -3, reason: 'kw_cn_weather' },
    { pattern: '实时', weight: -3, reason: 'kw_cn_realtime' },
    { pattern: '最新动态', weight: -3, reason: 'kw_cn_latest_update' },
    { pattern: '在线搜索', weight: -3, reason: 'kw_cn_online_search' },
    { pattern: '网页搜索', weight: -3, reason: 'kw_cn_web_search' },
    { pattern: '上网查', weight: -3, reason: 'kw_cn_search_online' },
    { pattern: '终端命令', weight: -2, reason: 'kw_cn_terminal_command' },
    { pattern: 'shell命令', weight: -2, reason: 'kw_cn_shell_command' },
    { pattern: '当前价格', weight: -3, reason: 'kw_cn_current_price' },
    { pattern: '查一下', weight: -2, reason: 'kw_cn_lookup' },
    { pattern: '帮我查', weight: -2, reason: 'kw_cn_lookup_2' },
    { pattern: '执行', weight: -2, reason: 'kw_cn_execute' },
    { pattern: '命令', weight: -2, reason: 'kw_cn_command' },
];

export const DEFAULT_PREFETCH_FORCE_PATTERNS: string[] = [
    'based on memory',
    'using memory',
    'from your memory',
    'from long term memory',
    'long-term memory',
    'use long term memory',
    'memory only',
    'remember what i told you',
    'what do you remember',
    'what i told you before',
    'based on our previous chats',
    'previously told',
    'according to memory',
    '根据记忆',
    '按记忆',
    '按长期记忆',
    '基于记忆',
    '结合记忆',
    '只根据记忆',
    '只基于记忆',
    '你还记得',
    '你记得我说过',
    '回忆一下',
    '我之前告诉过',
    '我之前提过',
    '我之前说过',
    '之前聊过',
    '根据我们之前的对话',
    '之前说过',
    '长期记忆',
];

export const DEFAULT_PREFETCH_SKIP_PATTERNS: string[] = [
    'latest news',
    'latest update',
    'breaking news',
    'today weather',
    'live score',
    'current price',
    'price now',
    'stock price',
    'crypto price',
    'search web',
    'web search',
    'search online',
    'browse internet',
    'browse web',
    'run command',
    'run this command',
    'execute this command',
    'execute command',
    'terminal command',
    'shell command',
    'npm run',
    'git ',
    '最新新闻',
    '最新动态',
    '今天天气',
    '当前价格',
    '实时价格',
    '在线搜索',
    '网页搜索',
    '上网查',
    '终端命令',
    'shell命令',
    '执行命令',
    '执行这个命令',
    '跑一下命令',
    '查一下最新',
    '查今日',
];

export function normalizePrefetchGateText(input: string): string {
    return input
        .toLowerCase()
        .replace(/[\u3000]/g, ' ')
        .replace(/[“”‘’"'`]/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizePatterns(patterns: string[]): string[] {
    return patterns
        .map((pattern) => normalizePrefetchGateText(pattern))
        .filter(Boolean);
}

function firstPatternHit(text: string, patterns: string[]): string | null {
    for (const pattern of patterns) {
        if (!pattern) continue;
        if (text.includes(pattern)) return pattern;
    }
    return null;
}

function clampAmbiguityRange(
    threshold: number,
    low: number,
    high: number
): { low: number; high: number } {
    const cappedThreshold = Math.max(1, Math.floor(threshold));
    const floorLow = Math.max(0, Math.floor(low));
    const floorHigh = Math.max(0, Math.floor(high));
    const normalizedLow = Math.min(floorLow, floorHigh);
    const normalizedHigh = Math.max(floorLow, floorHigh);
    return {
        low: Math.min(normalizedLow, cappedThreshold - 1),
        high: Math.min(normalizedHigh, cappedThreshold - 1),
    };
}

function applyWeightedPatterns(text: string, patterns: WeightedPattern[]): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];
    for (const entry of patterns) {
        if (text.includes(entry.pattern)) {
            score += entry.weight;
            reasons.push(entry.reason);
        }
    }
    return { score, reasons };
}

export function evaluatePrefetchRuleGate(message: string, config: PrefetchRuleGateConfig): PrefetchRuleEvaluation {
    const normalized = normalizePrefetchGateText(message);
    const normalizedForce = normalizePatterns(config.forcePatterns);
    const normalizedSkip = normalizePatterns(config.skipPatterns);
    const threshold = Math.max(1, Math.floor(config.threshold));
    const { low: ambiguityLow, high: ambiguityHigh } = clampAmbiguityRange(
        threshold,
        config.ambiguityLow,
        config.ambiguityHigh
    );

    const forceHit = firstPatternHit(normalized, normalizedForce);
    if (forceHit) {
        return {
            verdict: 'yes',
            reason: `force_pattern:${forceHit}`,
            score: threshold + 1,
        };
    }

    const skipHit = firstPatternHit(normalized, normalizedSkip);
    if (skipHit) {
        return {
            verdict: 'no',
            reason: `skip_pattern:${skipHit}`,
            score: -1,
        };
    }

    const positive = applyWeightedPatterns(normalized, POSITIVE_PATTERNS);
    const negative = applyWeightedPatterns(normalized, NEGATIVE_PATTERNS);
    const score = positive.score + negative.score;
    const scoreReasons = [...positive.reasons, ...negative.reasons];
    const reasonSuffix = scoreReasons.length > 0
        ? ` matched=${scoreReasons.join(',')}`
        : '';

    if (score >= threshold) {
        return {
            verdict: 'yes',
            reason: `rule_score_yes:${score}/threshold=${threshold}${reasonSuffix}`,
            score,
        };
    }

    if (score >= ambiguityLow && score <= ambiguityHigh) {
        return {
            verdict: 'ambiguous',
            reason: `rule_score_ambiguous:${score}/range=${ambiguityLow}-${ambiguityHigh}${reasonSuffix}`,
            score,
        };
    }

    return {
        verdict: 'no',
        reason: `rule_score_no:${score}/threshold=${threshold}${reasonSuffix}`,
        score,
    };
}

export function buildPrefetchLlmGatePrompt(
    agentId: string,
    message: string
): string {
    return [
        'You are a strict classifier.',
        `Agent ID: ${agentId}`,
        'Task: decide whether we must query long-term memory before answering this user message.',
        'Return ONLY JSON with this schema: {"need_memory": boolean, "reason": string}.',
        'Rules:',
        '- need_memory=true if user explicitly asks to rely on memory/history/previously shared facts.',
        '- need_memory=false for real-time lookup, web/news/weather/price queries, or pure tool execution requests.',
        '- If uncertain, prefer false.',
        '',
        'User message:',
        message,
    ].join('\n');
}

function extractJsonObject(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const directStart = trimmed.indexOf('{');
    const directEnd = trimmed.lastIndexOf('}');
    if (directStart >= 0 && directEnd > directStart) {
        return trimmed.slice(directStart, directEnd + 1);
    }
    return null;
}

export type PrefetchLlmGateResult = {
    needMemory: boolean;
    reason: string;
    raw: string;
};

export function parsePrefetchLlmGateResult(raw: string): PrefetchLlmGateResult {
    const extracted = extractJsonObject(raw);
    if (!extracted) {
        throw new Error('llm_gate_no_json');
    }
    const parsed = JSON.parse(jsonrepair(extracted)) as Record<string, unknown>;
    const needMemory = parsed.need_memory === true;
    const reasonRaw = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
    return {
        needMemory,
        reason: reasonRaw || (needMemory ? 'llm_need_memory' : 'llm_no_memory'),
        raw: extracted,
    };
}

export function parseCodexJsonlAgentMessage(output: string): string {
    const lines = output.trim().split('\n').filter(Boolean);
    let message = '';
    for (const line of lines) {
        let parsed: Record<string, unknown> | null = null;
        try {
            parsed = JSON.parse(line) as Record<string, unknown>;
        } catch {
            continue;
        }
        if (parsed?.type !== 'item.completed') continue;
        const item = (parsed.item && typeof parsed.item === 'object')
            ? parsed.item as Record<string, unknown>
            : null;
        if (!item || item.type !== 'agent_message') continue;
        if (typeof item.text === 'string') {
            message = item.text;
        }
    }
    return message;
}

export function parseOpenCodeJsonlText(output: string): string {
    const lines = output.trim().split('\n').filter(Boolean);
    let text = '';
    for (const line of lines) {
        let parsed: Record<string, unknown> | null = null;
        try {
            parsed = JSON.parse(line) as Record<string, unknown>;
        } catch {
            continue;
        }
        if (parsed?.type !== 'text') continue;
        const part = (parsed.part && typeof parsed.part === 'object')
            ? parsed.part as Record<string, unknown>
            : null;
        if (part && typeof part.text === 'string') {
            text = part.text;
        }
    }
    return text;
}

export function resolveLlmProvider(agent: AgentConfig): 'openai' | 'opencode' | 'anthropic' {
    if (agent.provider === 'openai') return 'openai';
    if (agent.provider === 'opencode') return 'opencode';
    return 'anthropic';
}
