#!/usr/bin/env node
import * as p from '@clack/prompts';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { SCRIPT_DIR } from '@tinyagi/core';
import { unwrap, required, readSettings, writeSettings, printBanner } from './shared.ts';

const API_PORT = process.env.TINYAGI_API_PORT || '3777';
const API_URL = `http://localhost:${API_PORT}`;

function sendMessage(message: string, source = 'cli') {
    const payload = JSON.stringify({ message, channel: 'cli', sender: source });

    const url = new URL(`${API_URL}/api/message`);
    const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
        },
    }, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
            try {
                const result = JSON.parse(body);
                if (result.ok) {
                    console.log(`Message enqueued: ${result.messageId}`);
                } else {
                    console.error(`Failed to enqueue message: ${body}`);
                }
            } catch {
                console.error(`Failed to parse response: ${body}`);
            }
        });
    });

    req.on('error', (err) => {
        console.error(`Failed to send message: ${err.message}`);
        process.exit(1);
    });

    req.write(payload);
    req.end();
}

function channelsReset(channel: string) {
    const knownChannels = ['telegram', 'discord', 'whatsapp'];

    if (!knownChannels.includes(channel)) {
        p.log.error(`Usage: channels reset {${knownChannels.join('|')}}`);
        process.exit(1);
    }

    if (channel === 'whatsapp') {
        const paths = [
            path.join(SCRIPT_DIR, '.tinyagi', 'whatsapp-session'),
            path.join(SCRIPT_DIR, '.tinyagi', 'channels', 'whatsapp_ready'),
            path.join(SCRIPT_DIR, '.tinyagi', 'channels', 'whatsapp_qr.txt'),
            path.join(SCRIPT_DIR, '.wwebjs_cache'),
        ];
        for (const p of paths) {
            fs.rmSync(p, { recursive: true, force: true });
        }
        p.log.success('WhatsApp session cleared');
        p.log.message('Restart TinyAGI to re-authenticate: tinyagi restart');
        return;
    }

    // Token-based channels
    p.log.message(`To reset ${channel}, run: tinyagi channel setup`);
    p.log.message(`Or manually edit .tinyagi/settings.json to change the ${channel} token.`);
}

const ALL_CHANNELS = ['telegram', 'discord', 'whatsapp'] as const;

const CHANNEL_DISPLAY: Record<string, string> = {
    telegram: 'Telegram',
    discord: 'Discord',
    whatsapp: 'WhatsApp',
};

const CHANNEL_TOKEN_PROMPT: Record<string, string> = {
    discord: 'Enter your Discord bot token',
    telegram: 'Enter your Telegram bot token',
};

const CHANNEL_TOKEN_HELP: Record<string, string> = {
    discord: 'Get one at: https://discord.com/developers/applications',
    telegram: 'Create a bot via @BotFather on Telegram to get a token',
};

async function channelSetup() {
    printBanner();
    p.intro('TinyAGI - Channel Setup');

    const settings = readSettings();

    const enabledChannels = unwrap(await p.multiselect({
        message: 'Which messaging channels do you want to enable?',
        options: ALL_CHANNELS.map(ch => ({
            value: ch,
            label: CHANNEL_DISPLAY[ch],
            initialSelected: settings.channels?.enabled?.includes(ch),
        })),
        required: false,
    }));

    // Collect tokens for channels that need them
    const tokens: Record<string, string> = {};
    for (const ch of enabledChannels) {
        if (CHANNEL_TOKEN_PROMPT[ch]) {
            const existing = (settings.channels as any)?.[ch]?.bot_token;
            const token = unwrap(await p.password({
                message: `${CHANNEL_TOKEN_PROMPT[ch]} (${CHANNEL_TOKEN_HELP[ch]})${existing ? ' [leave empty to keep current]' : ''}`,
                validate: existing ? undefined : required,
            }));
            tokens[ch] = token || existing || '';
        }
    }

    // Update settings
    if (!settings.channels) settings.channels = { enabled: [] };
    settings.channels.enabled = enabledChannels as string[];
    for (const ch of ALL_CHANNELS) {
        if (CHANNEL_TOKEN_PROMPT[ch]) {
            if (tokens[ch]) {
                (settings.channels as any)[ch] = { bot_token: tokens[ch] };
            }
        }
    }
    if (enabledChannels.includes('whatsapp')) {
        (settings.channels as any).whatsapp = (settings.channels as any).whatsapp || {};
    }

    writeSettings(settings);
    p.log.success('Channel configuration saved');

    if (enabledChannels.length > 0) {
        p.outro('Run `tinyagi restart` to apply changes.');
    } else {
        p.outro('No channels enabled. You can add them later.');
    }
}

// --- CLI dispatch ---

const command = process.argv[2];
const arg = process.argv[3];

switch (command) {
    case 'send':
        if (!arg) {
            p.log.error('Usage: messaging send <message>');
            process.exit(1);
        }
        sendMessage(arg);
        break;
    case 'channels-reset':
        if (!arg) {
            p.log.error('Usage: messaging channels-reset <channel>');
            process.exit(1);
        }
        channelsReset(arg);
        break;
    case 'channel-setup':
        channelSetup().catch(err => {
            p.log.error(err.message);
            process.exit(1);
        });
        break;
    default:
        p.log.error(`Unknown messaging command: ${command}`);
        process.exit(1);
}
