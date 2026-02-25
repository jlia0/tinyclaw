import fs from 'fs';
import os from 'os';
import path from 'path';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type Command =
    | 'ls'
    | 'read'
    | 'write'
    | 'write-file'
    | 'res-get'
    | 'res-put'
    | 'find-uris'
    | 'search'
    | 'session-create'
    | 'session-message'
    | 'session-commit';

const HELP = `OpenViking workspace tool

Usage:
  node openviking-tool.js ls <path> [--json]
  node openviking-tool.js read <path> [--json]
  node openviking-tool.js write <path> <content> [--json]
  node openviking-tool.js write-file <path> <local_file> [--json]
  node openviking-tool.js res-get <uri> [--json]
  node openviking-tool.js res-put <uri> <content> [--mime <mime_type>] [--json]
  node openviking-tool.js find-uris <query> <target_path> [--limit <n>] [--score-threshold <n>] [--json]
  node openviking-tool.js search <query> [--session-id <id>] [--limit <n>] [--score-threshold <n>] [--json]
  node openviking-tool.js session-create [--agent-id <id>] [--channel <name>] [--sender-id <id>] [--json]
  node openviking-tool.js session-message <session_id> <role> <content> [--json]
  node openviking-tool.js session-commit <session_id> [--json]

Environment:
  OPENVIKING_BASE_URL  API base URL (default: http://127.0.0.1:8320)
  OPENVIKING_API_KEY   Optional API key for X-API-Key header
  OPENVIKING_PROJECT   Optional project query (e.g. my-project)
`;

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');

function fail(message: string): never {
    console.error(`[openviking-tool] ${message}`);
    process.exit(1);
}

function getFlagValue(flag: string): string | undefined {
    const idx = args.indexOf(flag);
    if (idx === -1) return undefined;
    if (!args[idx + 1] || args[idx + 1].startsWith('--')) {
        fail(`Missing value for ${flag}`);
    }
    return args[idx + 1];
}

function positionalArguments(): string[] {
    const output: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--json') continue;
        if (
            arg === '--mime'
            || arg === '--limit'
            || arg === '--score-threshold'
            || arg === '--session-id'
            || arg === '--agent-id'
            || arg === '--channel'
            || arg === '--sender-id'
        ) {
            i += 1;
            continue;
        }
        output.push(arg);
    }
    return output;
}

function asObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {};
}

function asArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    return [];
}

type ListItem = {
    uri: string;
    isDir: boolean;
    modTime: string;
    index: number;
};

type SearchMatch = {
    type: 'memory' | 'resource' | 'skill';
    uri: string;
    score: number;
    abstract: string;
};

const DIRECTORY_READ_MAX_FILES = 8;

function toUri(input: string): string {
    if (input.startsWith('viking://')) return input;
    if (input === '/') return 'viking://resources';
    const normalized = input.startsWith('/') ? input.slice(1) : input;
    return `viking://resources/${normalized}`;
}

async function request(endpoint: string, init?: RequestInit): Promise<JsonValue> {
    const baseUrl = process.env.OPENVIKING_BASE_URL || 'http://127.0.0.1:8320';
    const project = process.env.OPENVIKING_PROJECT;
    const apiKey = process.env.OPENVIKING_API_KEY;
    const url = new URL(endpoint, baseUrl);

    if (project) {
        url.searchParams.set('project', project);
    }

    const headers = new Headers(init?.headers || {});
    if (apiKey) headers.set('X-API-Key', apiKey);
    if (init?.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(url.toString(), { ...init, headers });
    const text = await response.text();

    let data: JsonValue = null;
    if (text.trim()) {
        try {
            data = JSON.parse(text) as JsonValue;
        } catch {
            data = text;
        }
    }

    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
    }

    return data;
}

function printJson(data: JsonValue): void {
    console.log(JSON.stringify(data, null, 2));
}

function printList(data: JsonValue): void {
    const root = asObject(data);
    const resultNode = root.result;
    const dataNode = asObject(root.data);
    const items = asArray(resultNode ?? dataNode.items ?? root.items);

    if (!items.length) {
        console.log('(empty)');
        return;
    }

    for (const item of items) {
        const node = asObject(item);
        const itemPath = String(node.path ?? node.uri ?? '');
        const itemType = String(node.type ?? node.kind ?? 'item');
        if (itemPath) {
            console.log(`${itemType}\t${itemPath}`);
        } else {
            console.log(JSON.stringify(item));
        }
    }
}

function printRead(data: JsonValue): void {
    const root = asObject(data);
    const resultNode = root.result;
    const dataNode = asObject(root.data);
    const content = dataNode.content ?? root.content ?? resultNode;

    if (typeof content === 'string') {
        console.log(content);
        return;
    }

    printJson(data);
}

function normalizeAbstract(value: string): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) return '(no abstract provided)';
    const MAX_ABSTRACT_CHARS = 220;
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
            return normalizeAbstract(candidate);
        }
    }
    const metadata = asObject(node.metadata);
    for (const candidate of [metadata.abstract, metadata.summary, metadata.snippet, metadata.description]) {
        if (typeof candidate === 'string') {
            return normalizeAbstract(candidate);
        }
    }
    return '(no abstract provided)';
}

function extractSearchMatches(data: JsonValue): SearchMatch[] {
    const root = asObject(data);
    const resultNode = asObject(root.result ?? root.data ?? root);
    const groups: Array<{ key: string; type: SearchMatch['type'] }> = [
        { key: 'memories', type: 'memory' },
        { key: 'resources', type: 'resource' },
        { key: 'skills', type: 'skill' },
    ];

    const out: SearchMatch[] = [];
    for (const group of groups) {
        const items = asArray(resultNode[group.key]);
        for (const item of items) {
            const node = asObject(item);
            const uri = String(node.uri ?? node.path ?? '').trim();
            if (!uri) continue;
            out.push({
                type: group.type,
                uri,
                score: Number(node.score ?? 0),
                abstract: pickAbstract(node),
            });
        }
    }

    out.sort((a, b) => b.score - a.score);
    return out;
}

function printSearchMatches(data: JsonValue): void {
    const matches = extractSearchMatches(data);
    if (!matches.length) return;
    for (const m of matches) {
        console.log(`${m.type}\t${m.score}\t${m.uri}\t${m.abstract}`);
    }
}

function extractFindMatches(data: JsonValue): Array<{ uri: string; score: number; isLeaf: boolean }> {
    const root = asObject(data);
    const resultNode = asObject(root.result);
    const groups = ['memories', 'resources', 'skills'];
    const out: Array<{ uri: string; score: number; isLeaf: boolean }> = [];
    for (const g of groups) {
        const items = asArray(resultNode[g]);
        for (const item of items) {
            const node = asObject(item);
            const uri = String(node.uri ?? '');
            if (!uri) continue;
            out.push({
                uri,
                score: Number(node.score ?? 0),
                isLeaf: Boolean(node.is_leaf),
            });
        }
    }
    out.sort((a, b) => b.score - a.score);
    return out;
}

function printFindUris(data: JsonValue): void {
    const matches = extractFindMatches(data);
    if (!matches.length) return;
    for (const m of matches) {
        console.log(`${m.score}\t${m.uri}`);
    }
}

function extractListItems(data: JsonValue): ListItem[] {
    const root = asObject(data);
    const items = asArray(root.result ?? asObject(root.data).items ?? root.items);
    const out: ListItem[] = [];
    for (let i = 0; i < items.length; i++) {
        const node = asObject(items[i]);
        const uri = String(node.uri ?? node.path ?? '');
        if (!uri) continue;
        out.push({
            uri,
            isDir: Boolean(node.isDir),
            modTime: String(node.modTime ?? ''),
            index: i,
        });
    }
    return out;
}

function modTimeScore(modTime: string): number {
    const parsed = Date.parse(modTime);
    if (!Number.isNaN(parsed)) return parsed;

    const m = modTime.match(/^(\d{2}):(\d{2}):(\d{2})$/);
    if (!m) return -1;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    const ss = Number(m[3]);
    return hh * 3600 + mm * 60 + ss;
}

function uriTimestampScore(uri: string): number {
    const openVikingLeaf = uri.match(/openviking-(\d{10,})-/);
    if (openVikingLeaf) {
        return Number(openVikingLeaf[1]);
    }

    const compactTurn = uri.match(/Turn_(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})(\d{1,6})?Z/);
    if (compactTurn) {
        const [, date, hh, mm, ss, fracRaw = ''] = compactTurn;
        const ms = fracRaw.slice(0, 3).padEnd(3, '0');
        const iso = `${date}T${hh}:${mm}:${ss}.${ms}Z`;
        const parsed = Date.parse(iso);
        if (!Number.isNaN(parsed)) return parsed;
    }

    const archivedSession = uri.match(/\/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3,6})Z\.md\//);
    if (archivedSession) {
        const [, date, hh, mm, ss, fracRaw] = archivedSession;
        const ms = fracRaw.slice(0, 3).padEnd(3, '0');
        const iso = `${date}T${hh}:${mm}:${ss}.${ms}Z`;
        const parsed = Date.parse(iso);
        if (!Number.isNaN(parsed)) return parsed;
    }

    return -1;
}

function isReadableCandidateUri(uri: string): boolean {
    const base = uri.split('/').pop() || '';
    if (!base) return false;
    if (base.startsWith('.')) return false; // Exclude .overview/.abstract summaries.
    if (!(uri.endsWith('.md') || uri.endsWith('.txt'))) return false;
    return true;
}

function pickNewestReadableFileUris(listData: JsonValue, limit: number): string[] {
    const candidates = extractListItems(listData)
        .filter((item) => !item.isDir)
        .filter((item) => isReadableCandidateUri(item.uri));
    if (!candidates.length) return [];

    candidates.sort((a, b) => {
        const ts = uriTimestampScore(b.uri) - uriTimestampScore(a.uri);
        if (ts !== 0) return ts;
        const dt = modTimeScore(b.modTime) - modTimeScore(a.modTime);
        if (dt !== 0) return dt;
        return b.index - a.index;
    });
    return candidates.slice(0, Math.max(1, limit)).map((item) => item.uri);
}

async function readWithDirectoryFallback(uri: string, rawPath: string): Promise<JsonValue> {
    try {
        const stat = await request(`/api/v1/fs/stat?uri=${encodeURIComponent(uri)}`);
        const isDir = Boolean(asObject(asObject(stat).result).isDir);
        if (!isDir) {
            return await request(`/api/v1/content/read?uri=${encodeURIComponent(uri)}`);
        }
        const listed = await request(`/api/v1/fs/ls?uri=${encodeURIComponent(uri)}&recursive=true&output=agent`);
        const fileUris = pickNewestReadableFileUris(listed, DIRECTORY_READ_MAX_FILES);
        if (!fileUris.length) {
            return await request(`/api/v1/content/read?uri=${encodeURIComponent(uri)}`);
        }
        const chunks: string[] = [];
        for (const fileUri of fileUris) {
            try {
                const data = await request(`/api/v1/content/read?uri=${encodeURIComponent(fileUri)}`);
                const root = asObject(data);
                const dataNode = asObject(root.data);
                const resultNode = root.result;
                const content = dataNode.content ?? root.content ?? resultNode;
                if (typeof content === 'string' && content.trim()) {
                    chunks.push(content.trim());
                }
            } catch {
                // Best effort: skip unreadable leaf.
            }
        }
        if (!chunks.length) {
            return await request(`/api/v1/content/read?uri=${encodeURIComponent(fileUris[0])}`);
        }
        return { content: chunks.join('\n\n------\n\n') };
    } catch (primaryError) {
        try {
            return await request(`/api/v1/content/read?path=${encodeURIComponent(rawPath)}`);
        } catch {
            throw primaryError;
        }
    }
}

function extractSessionId(response: JsonValue): string {
    const root = asObject(response);
    const resultNode = asObject(root.result);
    const dataNode = asObject(root.data);
    const candidates = [
        root.id,
        root.session_id,
        root.sessionId,
        resultNode.id,
        resultNode.session_id,
        resultNode.sessionId,
        dataNode.id,
        dataNode.session_id,
        dataNode.sessionId,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim();
        }
    }
    return '';
}

async function createSession(agentId?: string, channel?: string, senderId?: string): Promise<JsonValue> {
    const metadata = {
        source: 'tinyclaw',
        agent_id: agentId || 'unknown',
        channel: channel || 'unknown',
        sender_id: senderId || 'unknown',
        created_at: new Date().toISOString(),
    };

    const fallbackName = `tinyclaw:${agentId || 'agent'}:${channel || 'channel'}:${senderId || 'sender'}`;
    const payloads: Array<Record<string, unknown>> = [
        { metadata },
        { name: fallbackName, metadata },
        { agent_id: agentId, channel, sender_id: senderId, metadata },
        {},
    ];

    let lastError: Error | null = null;
    for (const payload of payloads) {
        try {
            return await request('/api/v1/sessions', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
        } catch (error) {
            lastError = error as Error;
        }
    }

    throw lastError || new Error('Failed to create session');
}

async function writeSessionMessage(sessionId: string, role: string, content: string): Promise<JsonValue> {
    const endpoint = `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`;
    try {
        return await request(endpoint, {
            method: 'POST',
            body: JSON.stringify({ role, content }),
        });
    } catch {
        return await request(endpoint, {
            method: 'POST',
            body: JSON.stringify({ message: { role, content } }),
        });
    }
}

async function commitSession(sessionId: string): Promise<JsonValue> {
    const endpoint = `/api/v1/sessions/${encodeURIComponent(sessionId)}/commit`;
    try {
        return await request(endpoint, {
            method: 'POST',
            body: JSON.stringify({}),
        });
    } catch {
        return await request(endpoint, {
            method: 'POST',
        });
    }
}

async function run(): Promise<void> {
    const positional = positionalArguments();
    if (!positional.length || positional[0] === 'help' || positional[0] === '--help') {
        console.log(HELP);
        return;
    }

    const command = positional[0] as Command;
    let response: JsonValue;

    switch (command) {
        case 'ls': {
            if (!positional[1]) fail('Usage: ls <path>');
            const uri = toUri(positional[1]);
            try {
                response = await request(`/api/v1/fs/ls?uri=${encodeURIComponent(uri)}&output=agent`);
            } catch {
                response = await request(`/api/v1/fs/ls?path=${encodeURIComponent(positional[1])}`);
            }
            if (jsonOutput) printJson(response);
            else printList(response);
            return;
        }
        case 'read': {
            if (!positional[1]) fail('Usage: read <path>');
            const uri = toUri(positional[1]);
            response = await readWithDirectoryFallback(uri, positional[1]);
            if (jsonOutput) printJson(response);
            else printRead(response);
            return;
        }
        case 'write': {
            if (!positional[1] || positional[2] === undefined) fail('Usage: write <path> <content>');
            const content = positional[2];
            const targetUri = toUri(positional[1]);
            const tmpFile = path.join(os.tmpdir(), `openviking-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
            fs.writeFileSync(tmpFile, content, 'utf8');
            try {
                try {
                    response = await request('/api/v1/resources', {
                        method: 'POST',
                        body: JSON.stringify({ path: tmpFile, target: targetUri, wait: true }),
                    });
                } catch {
                    response = await request('/api/v1/content/write', {
                        method: 'POST',
                        body: JSON.stringify({ path: positional[1], content }),
                    });
                }
            } finally {
                fs.rmSync(tmpFile, { force: true });
            }
            if (jsonOutput) printJson(response);
            else console.log(`Wrote content to ${targetUri}`);
            return;
        }
        case 'write-file': {
            if (!positional[1] || !positional[2]) fail('Usage: write-file <path> <local_file>');
            const targetUri = toUri(positional[1]);
            const localFile = positional[2];
            try {
                const ext = path.extname(localFile) || '.txt';
                const tmpFile = path.join(os.tmpdir(), `openviking-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
                fs.copyFileSync(localFile, tmpFile);
                try {
                    response = await request('/api/v1/resources', {
                        method: 'POST',
                        body: JSON.stringify({ path: tmpFile, target: targetUri, wait: true }),
                    });
                } finally {
                    fs.rmSync(tmpFile, { force: true });
                }
            } catch {
                const content = fs.readFileSync(localFile, 'utf8');
                response = await request('/api/v1/content/write', {
                    method: 'POST',
                    body: JSON.stringify({ path: positional[1], content }),
                });
            }
            if (jsonOutput) printJson(response);
            else console.log(`Uploaded ${localFile} -> ${targetUri}`);
            return;
        }
        case 'res-get': {
            if (!positional[1]) fail('Usage: res-get <uri>');
            const uri = toUri(positional[1]);
            response = await readWithDirectoryFallback(uri, positional[1]);
            if (jsonOutput) printJson(response);
            else printRead(response);
            return;
        }
        case 'res-put': {
            if (!positional[1] || positional[2] === undefined) fail('Usage: res-put <uri> <content> [--mime <mime_type>]');
            const content = positional[2];
            const uri = toUri(positional[1]);
            const mimeType = getFlagValue('--mime') || 'text/plain';
            const _ = mimeType;
            const tmpFile = path.join(os.tmpdir(), `openviking-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
            fs.writeFileSync(tmpFile, content, 'utf8');
            try {
                response = await request('/api/v1/resources', {
                    method: 'POST',
                    body: JSON.stringify({ path: tmpFile, target: uri, wait: true }),
                });
            } finally {
                fs.rmSync(tmpFile, { force: true });
            }
            if (jsonOutput) printJson(response);
            else console.log(`Wrote resource ${uri}`);
            return;
        }
        case 'find-uris': {
            if (!positional[1] || !positional[2]) fail('Usage: find-uris <query> <target_path> [--limit <n>] [--score-threshold <n>]');
            const query = positional[1];
            const targetUri = toUri(positional[2]);
            const limitRaw = getFlagValue('--limit');
            const scoreThresholdRaw = getFlagValue('--score-threshold');
            const limit = limitRaw ? Number(limitRaw) : 12;
            if (!Number.isFinite(limit) || limit <= 0) fail('Invalid --limit value');
            let scoreThreshold: number | undefined;
            if (scoreThresholdRaw !== undefined) {
                const parsed = Number(scoreThresholdRaw);
                if (!Number.isFinite(parsed)) fail('Invalid --score-threshold value');
                scoreThreshold = parsed;
            }
            response = await request('/api/v1/search/find', {
                method: 'POST',
                body: JSON.stringify({
                    query,
                    target_uri: targetUri,
                    limit,
                    score_threshold: scoreThreshold,
                }),
            });
            if (jsonOutput) printJson(response);
            else printFindUris(response);
            return;
        }
        case 'search': {
            if (!positional[1]) fail('Usage: search <query> [--session-id <id>] [--limit <n>] [--score-threshold <n>]');
            const query = positional[1];
            const sessionId = getFlagValue('--session-id');
            const limitRaw = getFlagValue('--limit');
            const scoreThresholdRaw = getFlagValue('--score-threshold');
            const limit = limitRaw ? Number(limitRaw) : 12;
            if (!Number.isFinite(limit) || limit <= 0) fail('Invalid --limit value');
            let scoreThreshold: number | undefined;
            if (scoreThresholdRaw !== undefined) {
                const parsed = Number(scoreThresholdRaw);
                if (!Number.isFinite(parsed)) fail('Invalid --score-threshold value');
                scoreThreshold = parsed;
            }
            response = await request('/api/v1/search/search', {
                method: 'POST',
                body: JSON.stringify({
                    query,
                    session_id: sessionId,
                    limit,
                    score_threshold: scoreThreshold,
                }),
            });
            if (jsonOutput) printJson(response);
            else printSearchMatches(response);
            return;
        }
        case 'session-create': {
            const agentId = getFlagValue('--agent-id');
            const channel = getFlagValue('--channel');
            const senderId = getFlagValue('--sender-id');
            response = await createSession(agentId, channel, senderId);
            const sessionId = extractSessionId(response);
            if (!sessionId) {
                fail('Session create succeeded but no session id found in response');
            }
            if (jsonOutput) printJson(response);
            else console.log(sessionId);
            return;
        }
        case 'session-message': {
            if (!positional[1] || !positional[2] || positional[3] === undefined) {
                fail('Usage: session-message <session_id> <role> <content>');
            }
            const sessionId = positional[1];
            const role = positional[2];
            const content = positional[3];
            if (!['user', 'assistant', 'system'].includes(role)) {
                fail('Role must be one of: user, assistant, system');
            }
            response = await writeSessionMessage(sessionId, role, content);
            if (jsonOutput) printJson(response);
            else console.log(`Session message stored: ${sessionId} (${role})`);
            return;
        }
        case 'session-commit': {
            if (!positional[1]) fail('Usage: session-commit <session_id>');
            const sessionId = positional[1];
            response = await commitSession(sessionId);
            if (jsonOutput) printJson(response);
            else console.log(`Session committed: ${sessionId}`);
            return;
        }
        default:
            fail(`Unknown command: ${command}\n\n${HELP}`);
    }
}

run().catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
});
