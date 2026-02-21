export type SessionTurn = {
    timestamp: string;
    messageId: string;
    user: string;
    assistant: string;
    index: number;
};

export function tokenizeForMatch(text: string): string[] {
    const normalized = text.toLowerCase();
    return normalized
        .split(/[^a-z0-9\u4e00-\u9fff]+/g)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2);
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
    const qTokens = tokenizeForMatch(query);
    if (!qTokens.length) {
        return turns.slice(-cap);
    }

    const scored = turns.map((turn) => {
        const haystack = `${turn.user}\n${turn.assistant}`.toLowerCase();
        let hit = 0;
        for (const token of qTokens) {
            if (haystack.includes(token)) hit += 1;
        }
        // Prefer more recent turns when score ties.
        return { turn, score: hit, recency: turn.index };
    });

    const topHits = scored
        .filter((s) => s.score > 0)
        .sort((a, b) => (b.score - a.score) || (b.recency - a.recency))
        .slice(0, cap)
        .map((s) => s.turn);

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
