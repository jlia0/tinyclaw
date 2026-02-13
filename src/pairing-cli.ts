#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { TINYCLAW_HOME } from './lib/config';
import { approvePairingCode, loadPairingState } from './lib/pairing';

const PAIRING_FILE = path.join(TINYCLAW_HOME, 'pairing.json');

function formatTime(ts: number): string {
    return new Date(ts).toISOString();
}

function ensurePairingFileExists(): void {
    if (!fs.existsSync(PAIRING_FILE)) {
        fs.writeFileSync(PAIRING_FILE, JSON.stringify({ pending: [], approved: [] }, null, 2));
    }
}

function printPending(): void {
    const state = loadPairingState(PAIRING_FILE);
    if (state.pending.length === 0) {
        console.log('No pending pairing requests.');
        return;
    }

    console.log(`Pending (${state.pending.length}):`);
    for (const entry of state.pending) {
        console.log(`- ${entry.code} | ${entry.channel} | ${entry.sender} (${entry.senderId}) | requested ${formatTime(entry.createdAt)}`);
    }
}

function printApproved(): void {
    const state = loadPairingState(PAIRING_FILE);
    if (state.approved.length === 0) {
        console.log('No approved senders.');
        return;
    }

    console.log(`Approved (${state.approved.length}):`);
    for (const entry of state.approved) {
        const via = entry.approvedCode ? ` | via ${entry.approvedCode}` : '';
        console.log(`- ${entry.channel} | ${entry.sender} (${entry.senderId}) | approved ${formatTime(entry.approvedAt)}${via}`);
    }
}

function usage(): void {
    console.log('Usage: tinyclaw pairing {pending|approved|list|approve <code>}');
}

function main(): void {
    ensurePairingFileExists();

    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
        case 'pending':
            printPending();
            return;
        case 'approved':
            printApproved();
            return;
        case 'list':
            printPending();
            console.log('');
            printApproved();
            return;
        case 'approve': {
            const code = args[1];
            if (!code) {
                console.error('Usage: tinyclaw pairing approve <code>');
                process.exit(1);
            }
            const result = approvePairingCode(PAIRING_FILE, code);
            if (!result.ok || !result.entry) {
                console.error(result.reason || 'Failed to approve pairing code.');
                process.exit(1);
            }
            console.log(`Approved ${result.entry.sender} (${result.entry.channel}:${result.entry.senderId})`);
            return;
        }
        default:
            usage();
            process.exit(1);
    }
}

main();
