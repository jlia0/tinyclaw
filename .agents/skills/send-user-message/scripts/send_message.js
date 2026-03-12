#!/usr/bin/env node
/**
 * send_message.js — Write a message to the TinyAGI outgoing queue
 * so a channel client (Discord/Telegram/WhatsApp) delivers it to a paired user.
 *
 * Usage:
 *   node send_message.js list-targets
 *   node send_message.js send --channel <ch> --sender-id <id> --sender <name> --message <msg> [--agent <agent>] [--files <paths>]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const API_PORT = parseInt(process.env.TINYAGI_API_PORT || '3777', 10);
const API_BASE = `http://localhost:${API_PORT}`;

// ---------------------------------------------------------------------------
// Resolve TINYAGI_HOME (same logic as src/lib/config.ts)
// ---------------------------------------------------------------------------
const SCRIPT_DIR = path.resolve(__dirname, '../../../..');
const localTinyagi = path.join(SCRIPT_DIR, '.tinyagi');
const TINYAGI_HOME = fs.existsSync(path.join(localTinyagi, 'settings.json'))
    ? localTinyagi
    : path.join(os.homedir(), '.tinyagi');

const PAIRING_FILE = path.join(TINYAGI_HOME, 'pairing.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function loadPairingState() {
    try {
        if (!fs.existsSync(PAIRING_FILE)) {
            return { pending: [], approved: [] };
        }
        const raw = JSON.parse(fs.readFileSync(PAIRING_FILE, 'utf8'));
        return {
            pending: Array.isArray(raw.pending) ? raw.pending : [],
            approved: Array.isArray(raw.approved)
                ? raw.approved.filter(
                      (e) =>
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

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function listTargets() {
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

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--') && i + 1 < argv.length) {
            const key = arg.slice(2);
            args[key] = argv[++i];
        }
    }
    return args;
}

async function sendMessage(argv) {
    const args = parseArgs(argv);

    const channel = args['channel'];
    const senderId = args['sender-id'];
    const sender = args['sender'];
    const message = args['message'];
    const agent = args['agent'];
    const filesRaw = args['files'];

    // Validate required args
    const missing = [];
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

    // POST to API
    const body = {
        channel,
        sender,
        senderId,
        message,
        ...(agent ? { agent } : {}),
        ...(files && files.length > 0 ? { files } : {}),
    };

    const res = await fetch(`${API_BASE}/api/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const err = await res.text();
        console.error(`API error (${res.status}): ${err}`);
        process.exit(1);
    }

    const result = await res.json();

    console.log(`Message queued: ${result.messageId}`);
    console.log(`  channel:  ${channel}`);
    console.log(`  senderId: ${senderId}`);
    console.log(`  sender:   ${sender}`);
    console.log(`  length:   ${message.length} chars`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
        case 'list-targets':
            listTargets();
            break;
        case 'send':
            await sendMessage(args.slice(1));
            break;
        default:
            console.error('Usage:');
            console.error('  send_message.js list-targets');
            console.error('  send_message.js send --channel <ch> --sender-id <id> --sender <name> --message <msg>');
            process.exit(1);
    }
}

main();
