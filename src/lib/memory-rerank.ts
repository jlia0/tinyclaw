import { Settings } from './types';

const DEFAULT_ANSWER_SIGNAL_PATTERNS = ['代号', 'key', 'code', '是', '喜欢', 'likes?'];
const DEFAULT_LOW_CONFIDENCE_PATTERNS = [
    '不知道',
    '没有.*信息',
    '无法',
    '不清楚',
    '没有足够.*上下文',
    '缺少.*上下文',
    'need more context',
    'enough context',
    "don't have enough context",
    "don't have any information",
    "i don't have",
    'not enough information',
];

const DEFAULT_CODE_PATTERN = /\b[A-Z]{3,}(?:-[A-Z0-9]+){2,}\b/;

export interface MemoryRerankOptions {
    enabled: boolean;
    answerSignalPatterns: string[];
    lowConfidencePatterns: string[];
    answerSignalBonus: number;
    lowConfidencePenalty: number;
    codePatternBonus: number;
    termHitBonus: number;
}

export function resolveMemoryRerankOptions(settings?: Settings): MemoryRerankOptions {
    const cfg = settings?.memory?.rerank;
    return {
        enabled: cfg?.enabled !== false,
        answerSignalPatterns: Array.isArray(cfg?.answer_signal_patterns) && cfg.answer_signal_patterns.length > 0
            ? cfg.answer_signal_patterns
            : DEFAULT_ANSWER_SIGNAL_PATTERNS,
        lowConfidencePatterns: Array.isArray(cfg?.low_confidence_patterns) && cfg.low_confidence_patterns.length > 0
            ? cfg.low_confidence_patterns
            : DEFAULT_LOW_CONFIDENCE_PATTERNS,
        answerSignalBonus: Number.isFinite(cfg?.answer_signal_bonus) ? Number(cfg?.answer_signal_bonus) : 0.2,
        lowConfidencePenalty: Number.isFinite(cfg?.low_confidence_penalty) ? Number(cfg?.low_confidence_penalty) : 0.5,
        codePatternBonus: Number.isFinite(cfg?.code_pattern_bonus) ? Number(cfg?.code_pattern_bonus) : 0.5,
        termHitBonus: Number.isFinite(cfg?.term_hit_bonus) ? Number(cfg?.term_hit_bonus) : 0.04,
    };
}

function buildRegex(pattern: string): RegExp | null {
    try {
        return new RegExp(pattern, 'i');
    } catch {
        return null;
    }
}

function matchesAnyPattern(text: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
        const regex = buildRegex(pattern);
        if (!regex) {
            continue;
        }
        if (regex.test(text)) {
            return true;
        }
    }
    return false;
}

export function isLowConfidenceText(text: string, options: MemoryRerankOptions): boolean {
    return matchesAnyPattern(text, options.lowConfidencePatterns);
}

export function computeHeuristicScoreDelta(
    user: string,
    assistant: string,
    messageTerms: string[],
    options: MemoryRerankOptions
): number {
    if (!options.enabled) {
        return 0;
    }

    let delta = 0;
    if (DEFAULT_CODE_PATTERN.test(assistant)) {
        delta += options.codePatternBonus;
    }
    if (matchesAnyPattern(assistant, options.answerSignalPatterns)) {
        delta += options.answerSignalBonus;
    }
    if (matchesAnyPattern(assistant, options.lowConfidencePatterns)) {
        delta -= options.lowConfidencePenalty;
    }

    const hay = `${user} ${assistant}`.toLowerCase();
    for (const term of messageTerms) {
        if (hay.includes(term)) {
            delta += options.termHitBonus;
        }
    }

    return delta;
}
