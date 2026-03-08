#!/usr/bin/env node
/**
 * WhatsApp Client for TinyClaw Simple
 * Writes messages to queue and reads responses
 * Does NOT call Claude directly - that's handled by queue-processor
 */

import { Client, LocalAuth, Message, Chat, MessageMedia, MessageTypes } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import { ensureSenderPaired } from '../lib/pairing';
import { createLogger, excerptText, logError } from '../lib/logging';

const API_PORT = parseInt(process.env.TINYCLAW_API_PORT || '3777', 10);
const API_BASE = `http://localhost:${API_PORT}`;

const SCRIPT_DIR = path.resolve(__dirname, '..', '..');
const _localTinyclaw = path.join(SCRIPT_DIR, '.tinyclaw');
const TINYCLAW_HOME = process.env.TINYCLAW_HOME
    || (fs.existsSync(path.join(_localTinyclaw, 'settings.json'))
        ? _localTinyclaw
        : path.join(require('os').homedir(), '.tinyclaw'));
const SESSION_DIR = path.join(SCRIPT_DIR, '.tinyclaw/whatsapp-session');
const SETTINGS_FILE = path.join(TINYCLAW_HOME, 'settings.json');
const FILES_DIR = path.join(TINYCLAW_HOME, 'files');
const PAIRING_FILE = path.join(TINYCLAW_HOME, 'pairing.json');
const logger = createLogger({ runtime: 'whatsapp', source: 'whatsapp', component: 'client' });

// Ensure directories exist
[SESSION_DIR, FILES_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

interface PendingMessage {
    message: Message;
    chat: Chat;
    timestamp: number;
}

// Media message types that we can download
const MEDIA_TYPES: string[] = [
    MessageTypes.IMAGE,
    MessageTypes.AUDIO,
    MessageTypes.VOICE,
    MessageTypes.VIDEO,
    MessageTypes.DOCUMENT,
    MessageTypes.STICKER,
];

// Get file extension from mime type
function extFromMime(mime?: string): string {
    if (!mime) return '.bin';
    const map: Record<string, string> = {
        'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
        'image/webp': '.webp', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3',
        'audio/mp4': '.m4a', 'video/mp4': '.mp4', 'application/pdf': '.pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
        'text/plain': '.txt',
    };
    return map[mime] || `.${mime.split('/')[1] || 'bin'}`;
}

// Download media from a WhatsApp message and save to FILES_DIR
async function downloadWhatsAppMedia(message: Message, queueMessageId: string): Promise<string | null> {
    try {
        const media = await message.downloadMedia();
        if (!media || !media.data) return null;

        const ext = message.type === MessageTypes.DOCUMENT && (message as any)._data?.filename
            ? path.extname((message as any)._data.filename)
            : extFromMime(media.mimetype);

        const filename = `whatsapp_${queueMessageId}_${Date.now()}${ext}`;
        const localPath = path.join(FILES_DIR, filename);

        // Write base64 data to file
        fs.writeFileSync(localPath, Buffer.from(media.data, 'base64'));
        logger.info({ messageId: queueMessageId, context: { file: filename, mimeType: media.mimetype } }, 'Downloaded media');
        return localPath;
    } catch (error) {
        logError(logger, error, 'Failed to download media', { messageId: queueMessageId });
        return null;
    }
}

// Track pending messages (waiting for response)
const pendingMessages = new Map<string, PendingMessage>();
let processingOutgoingQueue = false;

// Load teams from settings for /team command
function getTeamListText(): string {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const settings = JSON.parse(settingsData);
        const teams = settings.teams;
        if (!teams || Object.keys(teams).length === 0) {
            return 'No teams configured.\n\nCreate a team with: tinyclaw team add';
        }
        let text = '*Available Teams:*\n';
        for (const [id, team] of Object.entries(teams) as [string, any][]) {
            text += `\n@${id} - ${team.name}`;
            text += `\n  Agents: ${team.agents.join(', ')}`;
            text += `\n  Leader: @${team.leader_agent}`;
        }
        text += '\n\nUsage: Start your message with @team_id to route to a team.';
        return text;
    } catch {
        return 'Could not load team configuration.';
    }
}

// Load agents from settings for /agent command
function getAgentListText(): string {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const settings = JSON.parse(settingsData);
        const agents = settings.agents;
        if (!agents || Object.keys(agents).length === 0) {
            return 'No agents configured. Using default single-agent mode.\n\nConfigure agents in .tinyclaw/settings.json or run: tinyclaw agent add';
        }
        let text = '*Available Agents:*\n';
        for (const [id, agent] of Object.entries(agents) as [string, any][]) {
            text += `\n@${id} - ${agent.name}`;
            text += `\n  Provider: ${agent.provider}/${agent.model}`;
            text += `\n  Directory: ${agent.working_directory}`;
            if (agent.system_prompt) text += `\n  Has custom system prompt`;
            if (agent.prompt_file) text += `\n  Prompt file: ${agent.prompt_file}`;
        }
        text += '\n\nUsage: Start your message with @agent_id to route to a specific agent.';
        return text;
    } catch {
        return 'Could not load agent configuration.';
    }
}

function pairingMessage(code: string): string {
    return [
        'This sender is not paired yet.',
        `Your pairing code: ${code}`,
        'Ask the TinyClaw owner to approve you with:',
        `tinyclaw pairing approve ${code}`,
    ].join('\n');
}

// Initialize WhatsApp client
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: SESSION_DIR
    }),
    puppeteer: {
        headless: 'new' as any,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// QR Code for authentication
client.on('qr', (qr: string) => {
    logger.info('Scan this QR code with WhatsApp');
    console.log('\n');

    // Display in tmux pane
    qrcode.generate(qr, { small: true });

    // Save to file for tinyclaw.sh to display (avoids tmux capture distortion)
    const channelsDir = path.join(TINYCLAW_HOME, 'channels');
    if (!fs.existsSync(channelsDir)) {
        fs.mkdirSync(channelsDir, { recursive: true });
    }
    const qrFile = path.join(channelsDir, 'whatsapp_qr.txt');
    qrcode.generate(qr, { small: true }, (code: string) => {
        fs.writeFileSync(qrFile, code);
        logger.info('QR code saved to .tinyclaw/channels/whatsapp_qr.txt');
    });

    console.log('\n');
    logger.info('Open WhatsApp → Settings → Linked Devices → Link a Device');
});

// Authentication success
client.on('authenticated', () => {
    logger.info('WhatsApp authenticated successfully');
});

// Client ready
client.on('ready', () => {
    logger.info('WhatsApp client connected and ready');
    logger.info('Listening for messages');

    // Create ready flag for tinyclaw.sh
    const readyFile = path.join(TINYCLAW_HOME, 'channels/whatsapp_ready');
    fs.writeFileSync(readyFile, Date.now().toString());
});

// Message received - Write to queue
client.on('message_create', async (message: Message) => {
    try {
        // Skip outgoing messages
        if (message.fromMe) {
            return;
        }

        // Check if message has downloadable media
        const hasMedia = message.hasMedia && MEDIA_TYPES.includes(message.type);
        const isChat = message.type === 'chat';

        // Skip messages that are neither chat nor media
        if (!isChat && !hasMedia) {
            return;
        }

        let messageText = message.body || '';
        const downloadedFiles: string[] = [];

        const chat = await message.getChat();
        const contact = await message.getContact();
        const sender = contact.pushname || contact.name || message.from;

        // Skip group messages
        if (chat.isGroup) {
            return;
        }

        // Generate unique message ID
        const messageId = `${Date.now()}_${Math.random().toString(36).substring(7)}`;

        // Download media if present
        if (hasMedia) {
            const filePath = await downloadWhatsAppMedia(message, messageId);
            if (filePath) {
                downloadedFiles.push(filePath);
            }
            // Add context for stickers
            if (message.type === MessageTypes.STICKER && !messageText) {
                messageText = '[Sticker]';
            }
        }

        // Skip if no text and no media
        if ((!messageText || messageText.trim().length === 0) && downloadedFiles.length === 0) {
            return;
        }

        logger.info({
            channel: 'whatsapp',
            sender,
            messageId,
            excerpt: excerptText(messageText || '[media only]'),
            context: { fileCount: downloadedFiles.length, senderId: message.from },
        }, 'Message received');

        const pairing = ensureSenderPaired(PAIRING_FILE, 'whatsapp', message.from, sender);
        if (!pairing.approved && pairing.code) {
            if (pairing.isNewPending) {
                logger.info({ channel: 'whatsapp', sender, context: { senderId: message.from, pairingCode: pairing.code } }, 'Blocked unpaired sender');
                await message.reply(pairingMessage(pairing.code));
            } else {
                logger.info({ channel: 'whatsapp', sender, context: { senderId: message.from } }, 'Blocked pending sender without re-sending pairing message');
            }
            return;
        }

        // Check for agent list command
        if (message.body.trim().match(/^[!/]agent$/i)) {
            logger.info({ channel: 'whatsapp', sender, messageId }, 'Agent list command received');
            const agentList = getAgentListText();
            await message.reply(agentList);
            return;
        }

        // Check for team list command
        if (message.body.trim().match(/^[!/]team$/i)) {
            logger.info({ channel: 'whatsapp', sender, messageId }, 'Team list command received');
            const teamList = getTeamListText();
            await message.reply(teamList);
            return;
        }

        // Check for reset command: /reset @agent_id [@agent_id2 ...]
        const resetMatch = messageText.trim().match(/^[!/]reset\s+(.+)$/i);
        if (messageText.trim().match(/^[!/]reset$/i)) {
            await message.reply('Usage: /reset @agent_id [@agent_id2 ...]\nSpecify which agent(s) to reset.');
            return;
        }
        if (resetMatch) {
            logger.info({ channel: 'whatsapp', sender, messageId }, 'Per-agent reset command received');
            const agentArgs = resetMatch[1].split(/\s+/).map(a => a.replace(/^@/, '').toLowerCase());
            try {
                const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
                const settings = JSON.parse(settingsData);
                const agents = settings.agents || {};
                const workspacePath = settings?.workspace?.path || path.join(require('os').homedir(), 'tinyclaw-workspace');
                const resetResults: string[] = [];
                for (const agentId of agentArgs) {
                    if (!agents[agentId]) {
                        resetResults.push(`Agent '${agentId}' not found.`);
                        continue;
                    }
                    const flagDir = path.join(workspacePath, agentId);
                    if (!fs.existsSync(flagDir)) fs.mkdirSync(flagDir, { recursive: true });
                    fs.writeFileSync(path.join(flagDir, 'reset_flag'), 'reset');
                    resetResults.push(`Reset @${agentId} (${agents[agentId].name}).`);
                }
                await message.reply(resetResults.join('\n'));
            } catch {
                await message.reply('Could not process reset command. Check settings.');
            }
            return;
        }

        // Check for restart command
        if (messageText.trim().match(/^[!/]restart$/i)) {
            logger.info({ channel: 'whatsapp', sender, messageId }, 'Restart command received');
            await message.reply('Restarting TinyClaw...');
            const { exec } = require('child_process');
            exec(`"${path.join(SCRIPT_DIR, 'tinyclaw.sh')}" restart`, { detached: true, stdio: 'ignore' });
            return;
        }

        // Show typing indicator
        await chat.sendStateTyping();

        // Build message text with file references
        let fullMessage = messageText;
        if (downloadedFiles.length > 0) {
            const fileRefs = downloadedFiles.map(f => `[file: ${f}]`).join('\n');
            fullMessage = fullMessage ? `${fullMessage}\n\n${fileRefs}` : fileRefs;
        }

        // Write to queue via API
        await fetch(`${API_BASE}/api/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                channel: 'whatsapp',
                sender,
                senderId: message.from,
                message: fullMessage,
                messageId,
                files: downloadedFiles.length > 0 ? downloadedFiles : undefined,
            }),
        });

        logger.info({ channel: 'whatsapp', sender, messageId, context: { fileCount: downloadedFiles.length, senderId: message.from } }, 'Queued message');

        // Store pending message for response
        pendingMessages.set(messageId, {
            message: message,
            chat: chat,
            timestamp: Date.now()
        });

        // Clean up old pending messages (older than 10 minutes)
        const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
        for (const [id, data] of pendingMessages.entries()) {
            if (data.timestamp < tenMinutesAgo) {
                pendingMessages.delete(id);
            }
        }

    } catch (error) {
        logError(logger, error, 'Message handling error');
    }
});

// Watch for responses via API
async function checkOutgoingQueue(): Promise<void> {
    if (processingOutgoingQueue) {
        return;
    }

    processingOutgoingQueue = true;

    try {
        const res = await fetch(`${API_BASE}/api/responses/pending?channel=whatsapp`);
        if (!res.ok) return;
        const responses = await res.json() as any[];

        for (const resp of responses) {
            try {
                const responseText = resp.message;
                const messageId = resp.messageId;
                const sender = resp.sender;
                const senderId = resp.senderId;
                const files: string[] = resp.files || [];

                // Find pending message, or fall back to senderId for proactive messages
                const pending = pendingMessages.get(messageId);
                let targetChat: Chat | null = pending?.chat ?? null;

                if (!targetChat && senderId) {
                    try {
                        const chatId = senderId.includes('@') ? senderId : `${senderId}@c.us`;
                        targetChat = await client.getChatById(chatId);
                    } catch (err) {
                        logError(logger, err, 'Could not get chat for senderId', { senderId, messageId });
                    }
                }

                if (targetChat) {
                    // Send any attached files first
                    if (files.length > 0) {
                        for (const file of files) {
                            try {
                                if (!fs.existsSync(file)) continue;
                                const media = MessageMedia.fromFilePath(file);
                                await targetChat.sendMessage(media);
                                logger.info({ channel: 'whatsapp', sender, messageId, context: { file: path.basename(file) } }, 'Sent file to WhatsApp');
                            } catch (fileErr) {
                                logError(logger, fileErr, 'Failed to send file to WhatsApp', { messageId, file });
                            }
                        }
                    }

                    // Send text response
                    if (responseText) {
                        if (pending) {
                            await pending.message.reply(responseText);
                        } else {
                            await targetChat.sendMessage(responseText);
                        }
                    }

                    logger.info({
                        channel: 'whatsapp',
                        sender,
                        messageId,
                        context: {
                            kind: pending ? 'response' : 'proactive message',
                            responseLength: responseText.length,
                            fileCount: files.length,
                        },
                    }, 'Sent outbound message');

                    if (pending) pendingMessages.delete(messageId);
                    await fetch(`${API_BASE}/api/responses/${resp.id}/ack`, { method: 'POST' });
                } else {
                    logger.warn({ channel: 'whatsapp', sender, messageId, context: { senderId } }, 'No pending message and no senderId; acking');
                    await fetch(`${API_BASE}/api/responses/${resp.id}/ack`, { method: 'POST' });
                }
            } catch (error) {
                logError(logger, error, 'Error processing WhatsApp response', { responseId: resp.id });
                // Don't ack on error, will retry next poll
            }
        }
    } catch (error) {
        logError(logger, error, 'Outgoing queue error');
    } finally {
        processingOutgoingQueue = false;
    }
}

// Check outgoing queue every second
setInterval(checkOutgoingQueue, 1000);

// Error handlers
client.on('auth_failure', (msg: string) => {
    logger.error({ context: { reason: msg } }, 'Authentication failure');
    process.exit(1);
});

client.on('disconnected', (reason: string) => {
    logger.warn({ context: { reason } }, 'WhatsApp disconnected; attempting reconnect in 10s');

    // Remove ready flag
    const readyFile = path.join(TINYCLAW_HOME, 'channels/whatsapp_ready');
    if (fs.existsSync(readyFile)) {
        fs.unlinkSync(readyFile);
    }

    setTimeout(() => {
        logger.info('Reconnecting WhatsApp client');
        client.initialize();
    }, 10000);
});

async function shutdownWhatsApp(exitCode: number): Promise<void> {
    logger.info({ context: { exitCode } }, 'Shutting down WhatsApp client');

    const readyFile = path.join(TINYCLAW_HOME, 'channels/whatsapp_ready');
    if (fs.existsSync(readyFile)) {
        fs.unlinkSync(readyFile);
    }

    try {
        await client.destroy();
    } catch {
        // Ignore shutdown destroy errors.
    }

    process.exit(exitCode);
}

// Catch unhandled errors so we can see what kills the bot
process.on('unhandledRejection', (reason) => {
    logError(logger, reason, 'Unhandled rejection');
});
process.on('uncaughtException', (error) => {
    logError(logger, error, 'Uncaught exception');
    void shutdownWhatsApp(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    await shutdownWhatsApp(0);
});

process.on('SIGTERM', async () => {
    await shutdownWhatsApp(0);
});

// Start client
logger.info('Starting WhatsApp client');
client.initialize();
