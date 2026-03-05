export type SessionTurn = {
    timestamp: string;
    messageId: string;
    user: string;
    assistant: string;
    index: number;
};

export type OpenVikingSearchHitType = 'memory' | 'resource' | 'skill';

export type OpenVikingSearchHit = {
    type: OpenVikingSearchHitType;
    uri: string;
    abstract: string;
    score: number;
};

export type OpenVikingSearchHitDistribution = {
    memory: number;
    resource: number;
    skill: number;
};

export function tokenizeForMatch(text: string): string[] {
    const stopwords = new Set([
        'the', 'is', 'are', 'am', 'was', 'were', 'be', 'been', 'being',
        'a', 'an', 'to', 'of', 'in', 'on', 'for', 'with', 'by', 'from',
        'what', 'when', 'where', 'which', 'who', 'whom', 'why', 'how',
        'please', 'reply', 'answer', 'only', 'just', 'tell', 'me', 'you', 'your',
    ]);
    const normalized = text.toLowerCase();
    return normalized
        .split(/[^a-z0-9\u4e00-\u9fff]+/g)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2)
        .filter((s) => !stopwords.has(s));
}

export function parseSessionTurns(markdown: string): SessionTurn[] {
    const turns: SessionTurn[] = [];
    const turnHeadingRegex = /##\s*Turn\s+([^\n]+)/g;
    const turnStarts: { index: number; timestamp: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = turnHeadingRegex.exec(markdown)) !== null) {
        turnStarts.push({ index: m.index, timestamp: (m[1] || '').trim() });
    }

    for (let i = 0; i < turnStarts.length; i++) {
        const start = turnStarts[i].index;
        const end = i + 1 < turnStarts.length ? turnStarts[i + 1].index : markdown.length;
        const chunk = markdown.slice(start, end);

        const idMatch = chunk.match(/- message_id:\s*([^\n]+)/);
        const userMarker = '### User';
        const assistantMarker = '### Assistant';
        const userPos = chunk.indexOf(userMarker);
        const assistantPos = chunk.indexOf(assistantMarker);
        if (userPos === -1 || assistantPos === -1 || assistantPos <= userPos) continue;

        let userSection = chunk.slice(userPos + userMarker.length, assistantPos).trim();
        // Remove injected OpenViking prefetch block if present in the stored turn.
        userSection = userSection.replace(/\n------\n\n\[OpenViking Retrieved Context\][\s\S]*?\[End OpenViking Context\]\s*$/s, '').trim();

        let assistantSection = chunk.slice(assistantPos + assistantMarker.length).trim();
        assistantSection = assistantSection.replace(/\n- ended_at:[\s\S]*$/s, '').trim();
        assistantSection = assistantSection.replace(/\n#\s*TinyClaw Session[\s\S]*$/s, '').trim();

        const user = userSection;
        const assistant = assistantSection;
        if (!user && !assistant) continue;
        turns.push({
            timestamp: turnStarts[i].timestamp,
            messageId: (idMatch?.[1] || '').trim(),
            user,
            assistant,
            index: turns.length,
        });
    }

    return turns;
}

export function selectRelevantTurns(turns: SessionTurn[], query: string, maxTurns: number): SessionTurn[] {
    if (!turns.length) return [];
    const cap = Math.max(1, maxTurns);
    const qTokens = Array.from(new Set(tokenizeForMatch(query)));
    if (!qTokens.length) {
        return turns.slice(-cap);
    }

    const scored = turns.map((turn) => {
        const userTokens = new Set(tokenizeForMatch(turn.user));
        const assistantTokens = new Set(tokenizeForMatch(turn.assistant));
        const userIsQuestion = /[?？]/.test(turn.user) || /^(what|when|where|which|who|why|how)\b/i.test(turn.user.trim());
        const assistantUncertain = /(don't have|do not have|don't know|do not know|don't see|do not see|no information|not in (the )?provided context|抱歉|没有.*信息)/i.test(turn.assistant);
        let hit = 0;
        for (const token of qTokens) {
            if (userTokens.has(token)) hit += 2;
            if (assistantTokens.has(token)) hit += 1;
        }
        // De-prioritize turns where assistant explicitly says it has no info.
        if (assistantUncertain) {
            hit -= userIsQuestion ? 8 : 3;
        }
        // Prefer more recent turns when score ties.
        return { turn, score: hit, recency: turn.index, uncertain: assistantUncertain };
    });

    const minScore = qTokens.length >= 3 ? 2 : 1;
    const positive = scored
        .filter((s) => s.score >= minScore)
        .sort((a, b) => (b.score - a.score) || (b.recency - a.recency));

    const informative = positive.filter((s) => !s.uncertain);
    const candidates = informative.length > 0 ? informative : positive;
    const topHits = candidates.slice(0, cap).map((s) => s.turn);

    if (topHits.length > 0) return topHits;
    return turns.slice(-cap);
}

export function buildPrefetchBlock(turns: SessionTurn[], maxChars: number): string {
    if (!turns.length) return '';
    const lines: string[] = [];
    lines.push('[OpenViking Retrieved Context]');
    for (const turn of turns) {
        lines.push('');
        lines.push(`- turn: ${turn.timestamp || 'unknown'} | message_id: ${turn.messageId || 'unknown'}`);
        lines.push(`  user: ${turn.user.replace(/\s+/g, ' ').trim()}`);
        lines.push(`  assistant: ${turn.assistant.replace(/\s+/g, ' ').trim()}`);
    }
    let output = lines.join('\n');
    if (output.length > maxChars) {
        output = output.slice(0, maxChars) + '\n...';
    }
    return output;
}

function asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {};
}

function asArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    return [];
}

function normalizeAbstract(value: string): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    const MAX_ABSTRACT_CHARS = 260;
    if (normalized.length <= MAX_ABSTRACT_CHARS) return normalized;
    return `${normalized.slice(0, MAX_ABSTRACT_CHARS - 3)}...`;
}

function pickAbstract(node: Record<string, unknown>): string {
    const candidates = [
        node.abstract,
        node.summary,
        node.snippet,
        node.text,
        node.content,
        node.description,
        node.title,
    ];

    for (const candidate of candidates) {
        if (typeof candidate === 'string') {
            const normalized = normalizeAbstract(candidate);
            if (normalized) return normalized;
        }
    }

    const metadata = asRecord(node.metadata);
    const metadataAbstractCandidates = [metadata.abstract, metadata.summary, metadata.snippet, metadata.description];
    for (const candidate of metadataAbstractCandidates) {
        if (typeof candidate === 'string') {
            const normalized = normalizeAbstract(candidate);
            if (normalized) return normalized;
        }
    }

    return '(no abstract provided)';
}

function toFiniteScore(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return n;
}

export function parseOpenVikingSearchHits(payload: unknown): OpenVikingSearchHit[] {
    const root = asRecord(payload);
    const resultNode = asRecord(root.result ?? root.data ?? root);
    const groups: Array<{ key: string; type: OpenVikingSearchHitType }> = [
        { key: 'memories', type: 'memory' },
        { key: 'resources', type: 'resource' },
        { key: 'skills', type: 'skill' },
    ];

    const hits: OpenVikingSearchHit[] = [];
    for (const group of groups) {
        const items = asArray(resultNode[group.key]);
        for (const item of items) {
            const node = asRecord(item);
            const uri = String(node.uri ?? node.path ?? '').trim();
            if (!uri) continue;
            hits.push({
                type: group.type,
                uri,
                abstract: pickAbstract(node),
                score: toFiniteScore(node.score),
            });
        }
    }

    const dedup = new Map<string, OpenVikingSearchHit>();
    for (const hit of hits) {
        const key = `${hit.type}|${hit.uri}|${hit.abstract}`;
        if (!dedup.has(key)) {
            dedup.set(key, hit);
            continue;
        }
        const existing = dedup.get(key)!;
        if (hit.score > existing.score) {
            dedup.set(key, hit);
        }
    }

    return Array.from(dedup.values()).sort((a, b) => b.score - a.score);
}

export function summarizeOpenVikingSearchHitDistribution(hits: OpenVikingSearchHit[]): OpenVikingSearchHitDistribution {
    const summary: OpenVikingSearchHitDistribution = {
        memory: 0,
        resource: 0,
        skill: 0,
    };
    for (const hit of hits) {
        summary[hit.type] += 1;
    }
    return summary;
}

export function selectOpenVikingSearchHits(
    hits: OpenVikingSearchHit[],
    maxHits: number,
    maxResourceSupplement: number
): OpenVikingSearchHit[] {
    if (!hits.length) return [];
    const cap = Math.max(1, maxHits);
    const resourceCap = Math.max(0, Math.min(maxResourceSupplement, cap));
    const memoryHits = hits.filter((hit) => hit.type === 'memory');
    const resourceHits = hits.filter((hit) => hit.type === 'resource');
    const skillHits = hits.filter((hit) => hit.type === 'skill');
    const reserveSkillSlots = skillHits.length > 0 ? 1 : 0;

    // Keep memory as the primary source, while reserving a small budget for resource supplements.
    const selected: OpenVikingSearchHit[] = [];
    const memoryPrimaryCap = Math.max(0, cap - resourceCap - reserveSkillSlots);
    selected.push(...memoryHits.slice(0, memoryPrimaryCap));
    selected.push(...resourceHits.slice(0, resourceCap));
    if (reserveSkillSlots > 0) {
        selected.push(...skillHits.slice(0, reserveSkillSlots));
    }

    if (selected.length < cap) {
        const remainingMemory = memoryHits.slice(memoryPrimaryCap);
        const remainingResource = resourceHits.slice(resourceCap);
        const remainingSkill = skillHits.slice(reserveSkillSlots);
        const backfill = [...remainingMemory, ...remainingResource, ...remainingSkill];
        selected.push(...backfill.slice(0, cap - selected.length));
    }

    return selected.slice(0, cap);
}

export function buildOpenVikingSearchPrefetchBlock(
    hits: OpenVikingSearchHit[],
    maxChars: number,
    maxHits: number,
    maxResourceSupplement: number
): string {
    if (!hits.length) return '';
    const selected = selectOpenVikingSearchHits(hits, maxHits, maxResourceSupplement);
    const summary = summarizeOpenVikingSearchHitDistribution(selected);
    const lines: string[] = [];
    lines.push('[OpenViking Retrieved Context]');
    lines.push('');
    lines.push(`- source: search_native | distribution: memory=${summary.memory}, resource=${summary.resource}, skill=${summary.skill}`);

    for (const hit of selected) {
        lines.push(`- type: ${hit.type} | score: ${hit.score.toFixed(4)} | uri: ${hit.uri}`);
        lines.push(`  abstract: ${hit.abstract}`);
    }

    let output = lines.join('\n');
    if (output.length > maxChars) {
        output = output.slice(0, maxChars) + '\n...';
    }
    return output;
}
