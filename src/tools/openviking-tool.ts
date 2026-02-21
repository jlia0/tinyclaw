import fs from 'fs';
import os from 'os';
import path from 'path';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type Command = 'ls' | 'read' | 'write' | 'write-file' | 'res-get' | 'res-put';

const HELP = `OpenViking workspace tool

Usage:
  node openviking-tool.js ls <path> [--json]
  node openviking-tool.js read <path> [--json]
  node openviking-tool.js write <path> <content> [--json]
  node openviking-tool.js write-file <path> <local_file> [--json]
  node openviking-tool.js res-get <uri> [--json]
  node openviking-tool.js res-put <uri> <content> [--mime <mime_type>] [--json]

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
        if (arg === '--mime') {
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

function extractUris(data: JsonValue): string[] {
    const root = asObject(data);
    const items = asArray(root.result ?? asObject(root.data).items ?? root.items);
    return items
        .map((item) => String(asObject(item).uri ?? asObject(item).path ?? ''))
        .filter((uri) => uri.length > 0);
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
    const m = modTime.match(/^(\d{2}):(\d{2}):(\d{2})$/);
    if (!m) return -1;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    const ss = Number(m[3]);
    return hh * 3600 + mm * 60 + ss;
}

function pickNewestReadableFileUri(listData: JsonValue): string | null {
    const candidates = extractListItems(listData)
        .filter((item) => !item.isDir)
        .filter((item) => item.uri.endsWith('.md') || item.uri.endsWith('.txt'));
    if (!candidates.length) return null;

    candidates.sort((a, b) => {
        const dt = modTimeScore(b.modTime) - modTimeScore(a.modTime);
        if (dt !== 0) return dt;
        return b.index - a.index;
    });
    return candidates[0].uri;
}

async function readWithDirectoryFallback(uri: string, rawPath: string): Promise<JsonValue> {
    try {
        const stat = await request(`/api/v1/fs/stat?uri=${encodeURIComponent(uri)}`);
        const isDir = Boolean(asObject(asObject(stat).result).isDir);
        if (!isDir) {
            return await request(`/api/v1/content/read?uri=${encodeURIComponent(uri)}`);
        }
        const listed = await request(`/api/v1/fs/ls?uri=${encodeURIComponent(uri)}&recursive=true&output=agent`);
        const fileUri = pickNewestReadableFileUri(listed);
        if (!fileUri) {
            return await request(`/api/v1/content/read?uri=${encodeURIComponent(uri)}`);
        }
        return await request(`/api/v1/content/read?uri=${encodeURIComponent(fileUri)}`);
    } catch (primaryError) {
        try {
            return await request(`/api/v1/content/read?path=${encodeURIComponent(rawPath)}`);
        } catch {
            throw primaryError;
        }
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
        default:
            fail(`Unknown command: ${command}\n\n${HELP}`);
    }
}

run().catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
});
