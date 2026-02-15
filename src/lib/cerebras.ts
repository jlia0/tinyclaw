import fs from 'fs';
import path from 'path';

type Role = 'system' | 'user' | 'assistant';
type Msg = { role: Role; content: string };

const DEFAULT_BASE_URL = 'https://api.cerebras.ai/v1';
const HISTORY_FILE = '.tinyclaw/cerebras_history.jsonl';
const MAX_HISTORY_MESSAGES = 20;
const SYSTEM_PROMPT_FILE = path.join('.claude', 'CLAUDE.md');

function getHistoryPath(agentDir: string): string {
    return path.join(agentDir, HISTORY_FILE);
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
    // Accept either OPENAI_BASE_URL (set by tinyclaw.sh) or a dedicated var.
    return (process.env.TINYCLAW_CEREBRAS_BASE_URL || process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function getApiKey(): string {
    return process.env.CEREBRAS_API_KEY || process.env.TINYCLAW_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
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
        throw new Error('Missing Cerebras API key (set CEREBRAS_API_KEY or TINYCLAW_OPENAI_API_KEY).');
    }

    const url = `${baseUrl}/chat/completions`;

    const history = readHistory(opts.agentDir);
    const system = readSystemPrompt(opts.agentDir);
    const messages: Msg[] = [{ role: 'system', content: system }, ...history, { role: 'user', content: opts.userMessage }];

    // Persist user message before sending so history is consistent even if we crash mid-call.
    appendHistory(opts.agentDir, { role: 'user', content: opts.userMessage });

    let lastErrMsg = 'Unknown Cerebras error';
    let lastStatus = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(url, {
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
            throw new Error(lastErrMsg);
        }

        if (!res.ok) {
            const msg = json?.error?.message || json?.message || `Cerebras HTTP ${res.status}`;
            lastErrMsg = msg;
            if (attempt < 2 && isRetryable(res.status, msg)) {
                const ra = Number(res.headers.get('retry-after') || '');
                const delay = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 250 * Math.pow(2, attempt);
                await sleep(delay);
                continue;
            }
            throw new Error(msg);
        }

        const content: string | undefined = json?.choices?.[0]?.message?.content;
        if (!content) {
            lastErrMsg = 'Cerebras returned no message content.';
            if (attempt < 2) {
                await sleep(250 * Math.pow(2, attempt));
                continue;
            }
            throw new Error(lastErrMsg);
        }

        appendHistory(opts.agentDir, { role: 'assistant', content });
        return content;
    }

    throw new Error(`Cerebras temporarily unavailable (HTTP ${lastStatus}): ${lastErrMsg}`);
}
