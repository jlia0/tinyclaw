import fs from 'fs';
import path from 'path';
import { log } from './logging';

type Role = 'system' | 'user' | 'assistant';
type Msg = { role: Role; content: string };

const DEFAULT_BASE_URL = 'https://api.cerebras.ai/v1';
const HISTORY_FILE = '.tinyclaw/cerebras_history.jsonl';
const META_FILE = '.tinyclaw/cerebras_meta.json';
const MAX_HISTORY_MESSAGES = 20;
const SYSTEM_PROMPT_FILE = path.join('.claude', 'CLAUDE.md');

function getHistoryPath(agentDir: string): string {
    return path.join(agentDir, HISTORY_FILE);
}

function getMetaPath(agentDir: string): string {
    return path.join(agentDir, META_FILE);
}

function readMeta(agentDir: string): { model?: string } {
    const p = getMetaPath(agentDir);
    try {
        const raw = fs.readFileSync(p, 'utf8');
        const j = JSON.parse(raw);
        if (j && typeof j.model === 'string') return { model: j.model };
    } catch {
        // ignore
    }
    return {};
}

function writeMeta(agentDir: string, meta: { model: string }): void {
    const p = getMetaPath(agentDir);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ ...meta, updatedAt: Date.now() }, null, 2));
}

function readSystemPrompt(agentDir: string): string {
    const p = path.join(agentDir, SYSTEM_PROMPT_FILE);
    try {
        const raw = fs.readFileSync(p, 'utf8').trim();
        if (raw) return raw;
    } catch {
        // ignore
    }

    // Keep this short and stable: we primarily want to prevent incorrect self-identification.
    return [
        'You are TinyClaw, a multi-agent assistant running inside a local daemon.',
        'Do not claim to be Codex or a GPT-5 model.',
        'If asked what model/provider you are using, answer that you are the TinyClaw assistant running via the configured provider/model.',
    ].join('\n');
}

function readHistory(agentDir: string): Msg[] {
    const p = getHistoryPath(agentDir);
    try {
        const raw = fs.readFileSync(p, 'utf8');
        const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
        const msgs: Msg[] = [];
        for (const line of lines) {
            try {
                const j = JSON.parse(line);
                if (j && (j.role === 'user' || j.role === 'assistant' || j.role === 'system') && typeof j.content === 'string') {
                    msgs.push({ role: j.role, content: j.content });
                }
            } catch {
                // ignore
            }
        }
        return msgs.slice(-MAX_HISTORY_MESSAGES);
    } catch {
        return [];
    }
}

function inferModelFromHistory(history: Msg[]): string | undefined {
    // Best-effort: detect self-reported model strings in recent assistant messages
    // to avoid getting "stuck" after switching models.
    for (let i = history.length - 1; i >= 0; i--) {
        const m = history[i];
        if (m.role !== 'assistant') continue;
        const txt = m.content || '';
        const match =
            txt.match(/\bprovider\s*=\s*cerebras\b[\s\S]{0,80}\bmodel\s*=\s*([a-z0-9._-]+)/i) ||
            txt.match(/\bruntime model:\s*([a-z0-9._-]+)/i) ||
            txt.match(/\bmodel\s*=\s*([a-z0-9._-]+)\b/i);
        if (match && match[1]) return match[1].toLowerCase();
    }
    return undefined;
}

function appendHistory(agentDir: string, msg: Msg): void {
    const p = getHistoryPath(agentDir);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify(msg) + '\n');
}

export function resetCerebrasHistory(agentDir: string): void {
    const p = getHistoryPath(agentDir);
    try {
        fs.unlinkSync(p);
    } catch {
        // ignore
    }
}

function getBaseUrl(): string {
    // Keep Cerebras isolated from OpenAI/Codex env vars to avoid accidental cross-contamination.
    return (process.env.TINYCLAW_CEREBRAS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function getApiKey(): string {
    // Do not fall back to OPENAI_API_KEY: it's for Codex/OpenAI, not Cerebras.
    return process.env.CEREBRAS_API_KEY || '';
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryable(status: number, message: string): boolean {
    if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true;
    const m = message.toLowerCase();
    return m.includes('high traffic') || m.includes('rate limit') || m.includes('timeout') || m.includes('temporar');
}

export async function cerebrasChatCompletion(opts: {
    agentDir: string;
    model: string;
    userMessage: string;
}): Promise<string> {
    const baseUrl = getBaseUrl();
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error('Missing Cerebras API key (set CEREBRAS_API_KEY).');
    }

    const url = `${baseUrl}/chat/completions`;

    // If the configured model changed, reset history to avoid model "stickiness".
    // This is intentionally conservative: we'd rather lose a bit of conversational context
    // than keep returning stale self-identification.
    const initialHistory = readHistory(opts.agentDir);
    const inferred = inferModelFromHistory(initialHistory);
    const prevMeta = readMeta(opts.agentDir);
    if ((prevMeta.model && prevMeta.model !== opts.model) || (inferred && inferred !== opts.model)) {
        resetCerebrasHistory(opts.agentDir);
    }
    writeMeta(opts.agentDir, { model: opts.model });

    const history = readHistory(opts.agentDir);
    const baseSystem = readSystemPrompt(opts.agentDir);
    const system = [
        `Runtime provider: cerebras`,
        `Runtime model: ${opts.model}`,
        `If asked what provider/model you're using, answer exactly: provider=cerebras model=${opts.model}.`,
        '',
        baseSystem,
    ].join('\n');
    const messages: Msg[] = [{ role: 'system', content: system }, ...history, { role: 'user', content: opts.userMessage }];

    // Persist user message before sending so history is consistent even if we crash mid-call.
    appendHistory(opts.agentDir, { role: 'user', content: opts.userMessage });

    let lastErrMsg = 'Unknown Cerebras error';
    let lastStatus = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
        const attemptStart = Date.now();
        let res: Response;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: opts.model,
                    messages,
                }),
            });
        } catch (e) {
            lastStatus = 0;
            lastErrMsg = (e as Error).message || 'Network error';
            if (attempt < 2) {
                await sleep(250 * Math.pow(2, attempt));
                continue;
            }
            break;
        }

        lastStatus = res.status;
        const text = await res.text();
        let json: any;
        try {
            json = JSON.parse(text);
        } catch {
            lastErrMsg = `Cerebras HTTP ${res.status}: ${text.slice(0, 200)}`;
            if (attempt < 2 && isRetryable(res.status, lastErrMsg)) {
                await sleep(250 * Math.pow(2, attempt));
                continue;
            }
            if (isRetryable(res.status, lastErrMsg)) break;
            throw new Error(lastErrMsg);
        }

        if (!res.ok) {
            const msg = json?.error?.message || json?.message || `Cerebras HTTP ${res.status}`;
            lastErrMsg = msg;
            if (attempt < 2 && isRetryable(res.status, msg)) {
                const ra = Number(res.headers.get('retry-after') || '');
                const delay = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 250 * Math.pow(2, attempt);
                log('WARN', `Cerebras retrying (model=${opts.model}, status=${res.status}, attempt=${attempt + 1}/3, delayMs=${delay}, ms=${Date.now() - attemptStart}): ${msg}`);
                await sleep(delay);
                continue;
            }
            if (isRetryable(res.status, msg)) break;
            throw new Error(msg);
        }

        const content: string | undefined = json?.choices?.[0]?.message?.content;
        if (!content) {
            lastErrMsg = 'Cerebras returned no message content.';
            if (attempt < 2) {
                await sleep(250 * Math.pow(2, attempt));
                continue;
            }
            break;
        }

        const usage = json?.usage || {};
        const completionTokens = Number(usage.completion_tokens || usage.completionTokens || 0) || 0;
        const totalTokens = Number(usage.total_tokens || usage.totalTokens || 0) || 0;
        const ms = Date.now() - attemptStart;
        const tps = completionTokens > 0 && ms > 0 ? Math.round((completionTokens / ms) * 1000) : 0;
        log('INFO', `Cerebras ok (model=${opts.model}, status=${res.status}, attempt=${attempt + 1}/3, ms=${ms}, completionTokens=${completionTokens || 'n/a'}, totalTokens=${totalTokens || 'n/a'}, tps=${tps || 'n/a'})`);

        appendHistory(opts.agentDir, { role: 'assistant', content });
        return content;
    }

    throw new Error(`Cerebras temporarily unavailable${lastStatus ? ` (HTTP ${lastStatus})` : ''}: ${lastErrMsg}`);
}
