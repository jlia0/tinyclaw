#!/usr/bin/env node
/**
 * TUI Client for TinyClaw
 * Reads from stdin, writes responses to stdout.
 * Usable over ssh/telnet/netcat with stdio forwarding.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { ensureSenderPaired } from '../lib/pairing';

const SCRIPT_DIR = path.resolve(__dirname, '..', '..');
const _localTinyclaw = path.join(SCRIPT_DIR, '.tinyclaw');
const TINYCLAW_HOME = process.env.TINYCLAW_HOME
    || (fs.existsSync(path.join(_localTinyclaw, 'settings.json'))
        ? _localTinyclaw
        : path.join(os.homedir(), '.tinyclaw'));

const QUEUE_INCOMING = path.join(TINYCLAW_HOME, 'queue/incoming');
const QUEUE_OUTGOING = path.join(TINYCLAW_HOME, 'queue/outgoing');
const LOG_FILE = path.join(TINYCLAW_HOME, 'logs/tui.log');
const PAIRING_FILE = path.join(TINYCLAW_HOME, 'pairing.json');

// Ensure directories exist
[QUEUE_INCOMING, QUEUE_OUTGOING, path.dirname(LOG_FILE)].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

const CHANNEL_ID = 'tui';
const REQUIRE_PAIRING = process.env.TUI_REQUIRE_PAIRING === '1';
const PENDING_TIMEOUT_MS = 60_000;
let senderId = process.env.TUI_SENDER_ID || `local_${process.pid}`;
let senderName = process.env.TUI_SENDER_NAME || senderId;

interface ResponseData {
    channel: string;
    sender: string;
    message: string;
    originalMessage: string;
    timestamp: number;
    messageId: string;
    files?: string[];
}

interface PendingMessage {
    message: string;
    createdAt: number;
}

const pending = new Map<string, PendingMessage>();
let messageCounter = 0;
let shuttingDown = false;

function log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    fs.appendFileSync(LOG_FILE, logMessage);
}

function makeMessageId(): string {
    messageCounter += 1;
    return `tui_${senderId}_${Date.now()}_${messageCounter}`;
}

function enqueueMessage(message: string, messageId: string): void {
    const payload = {
        channel: CHANNEL_ID,
        sender: senderName,
        senderId,
        message,
        timestamp: Date.now(),
        messageId,
    };
    const queueFile = path.join(QUEUE_INCOMING, `tui_${messageId}.json`);
    fs.writeFileSync(queueFile, JSON.stringify(payload, null, 2));
    log('INFO', `Enqueued message ${messageId} from ${senderName} (${senderId})`);
}

function pairingMessage(code: string): string {
    return [
        'This sender is not paired yet.',
        `Your pairing code: ${code}`,
        'Approve with:',
        `tinyclaw pairing approve ${code}`,
    ].join('\n');
}

function printResponse(text: string): void {
    const clean = text.trimEnd();
    if (!clean) {
        return;
    }
    process.stdout.write(`\n${clean}\n`);
    rl.prompt(true);
}

function expirePending(): void {
    const now = Date.now();
    for (const [messageId, item] of pending.entries()) {
        if (now - item.createdAt < PENDING_TIMEOUT_MS) {
            continue;
        }

        pending.delete(messageId);
        log('WARN', `Timed out waiting for response to ${messageId}`);
        printResponse('Request timed out waiting for TinyClaw.');
    }
}

function checkOutgoing(): void {
    expirePending();
    if (pending.size === 0) {
        return;
    }
    let files: string[] = [];
    try {
        files = fs.readdirSync(QUEUE_OUTGOING)
            .filter(f => f.startsWith('tui_') && f.endsWith('.json'));
    } catch {
        log('WARN', `Unable to read outgoing queue: ${QUEUE_OUTGOING}`);
        return;
    }

    for (const file of files) {
        const fullPath = path.join(QUEUE_OUTGOING, file);
        let data: ResponseData | null = null;
        try {
            data = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as ResponseData;
        } catch {
            log('WARN', `Skipping unreadable response file: ${file}`);
            continue;
        }
        if (!data || data.channel !== CHANNEL_ID) continue;
        if (!pending.has(data.messageId)) continue;

        pending.delete(data.messageId);
        try { fs.unlinkSync(fullPath); } catch { /* ignore */ }
        log('INFO', `Received response for ${data.messageId}`);

        if (data.files && data.files.length > 0) {
            printResponse(`${data.message}\n\n[files]\n${data.files.join('\n')}`);
        } else {
            printResponse(data.message);
        }
    }
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY),
});

function shutdown(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    log('INFO', 'Shutting down TUI client');
    rl.close();
    process.stdout.write('\n');
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

log('INFO', `Starting TUI client for ${senderName} (${senderId})`);
process.stdout.write('TinyClaw TUI (stdin/stdout)\n');
function showHelp(): void {
    const helpLines = [
        'Commands:',
        '  /help                 Show this help',
        '  /whoami               Show current sender',
        '  /as <id> [name]        Set sender id/name',
        '  /exit or /quit        Exit the TUI',
        '',
        'Routing:',
        '  Prefix with @agent or @team to route',
    ];
    printResponse(helpLines.join('\n'));
}

process.stdout.write('Type /help for commands. Prefix @agent or @team to route.\n\n');
rl.setPrompt('> ');
rl.prompt();

const pollInterval = setInterval(checkOutgoing, 400);

rl.on('line', (line) => {
    const input = line.trim();
    if (!input) {
        rl.prompt();
        return;
    }
    if (input === '/exit' || input === '/quit') {
        clearInterval(pollInterval);
        shutdown();
        return;
    }
    if (input === '/help') {
        showHelp();
        return;
    }
    if (input.startsWith('/as ')) {
        const parts = input.split(/\s+/).slice(1);
        if (parts.length === 0 || !parts[0]) {
            printResponse('Usage: /as <id> [name]');
            return;
        }
        senderId = parts[0];
        senderName = parts.slice(1).join(' ') || senderId;
        printResponse(`Sender set to ${senderName} (${senderId})`);
        return;
    }
    if (input === '/whoami') {
        printResponse(`Sender: ${senderName} (${senderId})`);
        return;
    }

    if (REQUIRE_PAIRING) {
        const pairing = ensureSenderPaired(PAIRING_FILE, CHANNEL_ID, senderId, senderName);
        if (!pairing.approved) {
            printResponse(pairingMessage(pairing.code || ''));
            return;
        }
    }

    const messageId = makeMessageId();
    pending.set(messageId, { message: input, createdAt: Date.now() });
    enqueueMessage(input, messageId);
    rl.prompt();
});

rl.on('close', () => {
    clearInterval(pollInterval);
    process.exit(0);
});
