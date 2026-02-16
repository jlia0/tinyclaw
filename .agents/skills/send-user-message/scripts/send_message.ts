#!/usr/bin/env npx ts-node
/**
 * send_message.ts — Write a message to the TinyClaw outgoing queue
 * so a channel client (Discord/Telegram/WhatsApp) delivers it to a paired user.
 *
 * Usage:
 *   npx ts-node send_message.ts list-targets
 *   npx ts-node send_message.ts send --channel <ch> --sender-id <id> --sender <name> --message <msg> [--agent <agent>] [--files <paths>]
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Resolve TINYCLAW_HOME (same logic as src/lib/config.ts)
// ---------------------------------------------------------------------------
const SCRIPT_DIR = path.resolve(__dirname, '../../../..');
const localTinyclaw = path.join(SCRIPT_DIR, '.tinyclaw');
const TINYCLAW_HOME = fs.existsSync(path.join(localTinyclaw, 'settings.json'))
    ? localTinyclaw
    : path.join(require('os').homedir(), '.tinyclaw');

const QUEUE_OUTGOING = path.join(TINYCLAW_HOME, 'queue/outgoing');
const PAIRING_FILE = path.join(TINYCLAW_HOME, 'pairing.json');

// ---------------------------------------------------------------------------
// Types (mirrors src/lib/pairing.ts)
// ---------------------------------------------------------------------------
interface PairingApprovedEntry {
    channel: string;
    senderId: string;
    sender: string;
    approvedAt: number;
    approvedCode?: string;
}

interface PairingState {
    pending: unknown[];
    approved: PairingApprovedEntry[];
}

interface OutgoingMessage {
    channel: string;
    sender: string;
    senderId: string;
    message: string;
    originalMessage: string;
    timestamp: number;
    messageId: string;
    agent?: string;
    files?: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function loadPairingState(): PairingState {
    try {
        if (!fs.existsSync(PAIRING_FILE)) {
            return { pending: [], approved: [] };
        }
        const raw = JSON.parse(fs.readFileSync(PAIRING_FILE, 'utf8'));
        return {
            pending: Array.isArray(raw.pending) ? raw.pending : [],
            approved: Array.isArray(raw.approved)
                ? raw.approved.filter(
                      (e: PairingApprovedEntry) =>
                          e &&
                          typeof e.channel === 'string' &&
                          typeof e.senderId === 'string' &&
                          typeof e.sender === 'string',
                  )
                : [],
        };
    } catch {
        return { pending: [], approved: [] };
    }
}

function generateMessageId(): string {
    const ts = Date.now();
    const rand = crypto.randomBytes(4).toString('hex');
    return `agent_${ts}_${rand}`;
}

function ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function listTargets(): void {
    const state = loadPairingState();

    if (state.approved.length === 0) {
        console.log('No approved pairings found.');
        console.log(`Checked: ${PAIRING_FILE}`);
        process.exit(0);
    }

    console.log(`Approved pairings (${state.approved.length}):\n`);
    for (const entry of state.approved) {
        console.log(`  channel:  ${entry.channel}`);
        console.log(`  senderId: ${entry.senderId}`);
        console.log(`  sender:   ${entry.sender}`);
        console.log(`  approved: ${new Date(entry.approvedAt).toISOString()}`);
        console.log('');
    }
}

function parseArgs(argv: string[]): Record<string, string> {
    const args: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--') && i + 1 < argv.length) {
            const key = arg.slice(2);
            args[key] = argv[++i];
        }
    }
    return args;
}

function sendMessage(argv: string[]): void {
    const args = parseArgs(argv);

    const channel = args['channel'];
    const senderId = args['sender-id'];
    const sender = args['sender'];
    const message = args['message'];
    const agent = args['agent'];
    const filesRaw = args['files'];

    // Validate required args
    const missing: string[] = [];
    if (!channel) missing.push('--channel');
    if (!senderId) missing.push('--sender-id');
    if (!sender) missing.push('--sender');
    if (!message) missing.push('--message');

    if (missing.length > 0) {
        console.error(`Missing required arguments: ${missing.join(', ')}`);
        console.error('Usage: send --channel <ch> --sender-id <id> --sender <name> --message <msg>');
        process.exit(1);
    }

    const validChannels = ['discord', 'telegram', 'whatsapp'];
    if (!validChannels.includes(channel)) {
        console.error(`Invalid channel "${channel}". Must be one of: ${validChannels.join(', ')}`);
        process.exit(1);
    }

    // Parse optional files
    const files = filesRaw
        ? filesRaw.split(',').map(f => f.trim()).filter(Boolean)
        : undefined;

    // Build the outgoing message
    const messageId = generateMessageId();
    const timestamp = Date.now();

    const outgoing: OutgoingMessage = {
        channel,
        sender,
        senderId,
        message: message.length > 4000
            ? message.substring(0, 3900) + '\n\n[Message truncated...]'
            : message,
        originalMessage: '',
        timestamp,
        messageId,
        ...(agent ? { agent } : {}),
        ...(files && files.length > 0 ? { files } : {}),
    };

    // Write to outgoing queue
    ensureDir(QUEUE_OUTGOING);

    const filename = `${channel}_${messageId}_${timestamp}.json`;
    const filePath = path.join(QUEUE_OUTGOING, filename);
    const tmpPath = `${filePath}.tmp`;

    fs.writeFileSync(tmpPath, JSON.stringify(outgoing, null, 2));
    fs.renameSync(tmpPath, filePath);

    console.log(`Message queued: ${filename}`);
    console.log(`  channel:  ${channel}`);
    console.log(`  senderId: ${senderId}`);
    console.log(`  sender:   ${sender}`);
    console.log(`  length:   ${outgoing.message.length} chars`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
        case 'list-targets':
            listTargets();
            break;
        case 'send':
            sendMessage(args.slice(1));
            break;
        default:
            console.error('Usage:');
            console.error('  send_message.ts list-targets');
            console.error('  send_message.ts send --channel <ch> --sender-id <id> --sender <name> --message <msg>');
            process.exit(1);
    }
}

main();
