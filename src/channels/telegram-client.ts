#!/usr/bin/env node
/**
 * Telegram Client for TinyClaw Simple
 * Writes DM messages to queue and reads responses
 * Does NOT call Claude directly - that's handled by queue-processor
 *
 * Setup: Create a bot via @BotFather on Telegram to get a bot token.
 */

import TelegramBot from 'node-telegram-bot-api';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
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
const SETTINGS_FILE = path.join(TINYCLAW_HOME, 'settings.json');
const FILES_DIR = path.join(TINYCLAW_HOME, 'files');
const PAIRING_FILE = path.join(TINYCLAW_HOME, 'pairing.json');
const logger = createLogger({ runtime: 'telegram', source: 'telegram', component: 'client' });

// Ensure directories exist
[FILES_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Validate bot token
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'your_token_here') {
    logger.error('TELEGRAM_BOT_TOKEN is not set in .env file');
    process.exit(1);
}

interface PendingMessage {
    chatId: number;
    messageId: number;
    timestamp: number;
}

function sanitizeFileName(fileName: string): string {
    const baseName = path.basename(fileName).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
    return baseName.length > 0 ? baseName : 'file.bin';
}

function ensureFileExtension(fileName: string, fallbackExt: string): string {
    if (path.extname(fileName)) {
        return fileName;
    }
    return `${fileName}${fallbackExt}`;
}

function buildUniqueFilePath(dir: string, preferredName: string): string {
    const cleanName = sanitizeFileName(preferredName);
    const ext = path.extname(cleanName);
    const stem = path.basename(cleanName, ext);
    let candidate = path.join(dir, cleanName);
    let counter = 1;
    while (fs.existsSync(candidate)) {
        candidate = path.join(dir, `${stem}_${counter}${ext}`);
        counter++;
    }
    return candidate;
}

// Track pending messages (waiting for response)
const pendingMessages = new Map<string, PendingMessage>();
let processingOutgoingQueue = false;
let lastPollingActivity = Date.now();
let pollingRestartInProgress = false;

// Load teams from settings for /team command
function getTeamListText(): string {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const settings = JSON.parse(settingsData);
        const teams = settings.teams;
        if (!teams || Object.keys(teams).length === 0) {
            return 'No teams configured.\n\nCreate a team with: tinyclaw team add';
        }
        let text = 'Available Teams:\n';
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
        let text = 'Available Agents:\n';
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

// Split long messages for Telegram's 4096 char limit
function splitMessage(text: string, maxLength = 4096): string[] {
    if (text.length <= maxLength) {
        return [text];
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            chunks.push(remaining);
            break;
        }

        // Try to split at a newline boundary
        let splitIndex = remaining.lastIndexOf('\n', maxLength);

        // Fall back to space boundary
        if (splitIndex <= 0) {
            splitIndex = remaining.lastIndexOf(' ', maxLength);
        }

        // Hard-cut if no good boundary found
        if (splitIndex <= 0) {
            splitIndex = maxLength;
        }

        chunks.push(remaining.substring(0, splitIndex));
        remaining = remaining.substring(splitIndex).replace(/^\n/, '');
    }

    return chunks;
}

async function sendTelegramMessage(
    chatId: number,
    text: string,
    options: TelegramBot.SendMessageOptions = {},
): Promise<void> {
    try {
        await bot.sendMessage(chatId, text, {
            parse_mode: 'Markdown',
            ...options,
        });
    } catch (error) {
        const message = (error as Error).message || '';
        if (!message.toLowerCase().includes("can't parse entities")) {
            throw error;
        }

        logger.warn('Failed to parse Telegram Markdown, retrying without Markdown parsing');
        await bot.sendMessage(chatId, text, options);
    }
}

// Download a file from URL to local path
function downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        const request = (url.startsWith('https') ? https.get(url, handleResponse) : http.get(url, handleResponse));

        function handleResponse(response: http.IncomingMessage): void {
            if (response.statusCode === 301 || response.statusCode === 302) {
                const redirectUrl = response.headers.location;
                if (redirectUrl) {
                    file.close();
                    fs.unlinkSync(destPath);
                    downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
                    return;
                }
            }
            response.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
        }

        request.on('error', (err) => {
            fs.unlink(destPath, () => { }); // Clean up on error
            reject(err);
        });
    });
}

// Download a Telegram file by file_id and return the local path
async function downloadTelegramFile(fileId: string, ext: string, messageId: string, originalName?: string): Promise<string | null> {
    try {
        const file = await bot.getFile(fileId);
        if (!file.file_path) return null;

        const url = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;
        const telegramPathName = path.basename(file.file_path);
        const sourceName = originalName || telegramPathName || `file_${Date.now()}${ext}`;
        const withExt = ensureFileExtension(sourceName, ext || '.bin');
        const filename = `telegram_${messageId}_${withExt}`;
        const localPath = buildUniqueFilePath(FILES_DIR, filename);

        await downloadFile(url, localPath);
        logger.info({ messageId, context: { file: path.basename(localPath) } }, 'Downloaded file');
        return localPath;
    } catch (error) {
        logError(logger, error, 'Failed to download file', { messageId, fileId });
        return null;
    }
}

// Get file extension from mime type
function extFromMime(mime?: string): string {
    if (!mime) return '';
    const map: Record<string, string> = {
        'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
        'image/webp': '.webp', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3',
        'video/mp4': '.mp4', 'application/pdf': '.pdf',
    };
    return map[mime] || '';
}

function pairingMessage(code: string): string {
    return [
        'This sender is not paired yet.',
        `Your pairing code: ${code}`,
        'Ask the TinyClaw owner to approve you with:',
        `tinyclaw pairing approve ${code}`,
    ].join('\n');
}

// Initialize Telegram bot (polling mode)
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Bot ready
bot.getMe().then(async (me: TelegramBot.User) => {
    logger.info({ context: { username: me.username } }, 'Telegram bot connected');
    lastPollingActivity = Date.now();

    // Register bot commands so they appear in Telegram's "/" menu
    await bot.setMyCommands([
        { command: 'agent', description: 'List available agents' },
        { command: 'team', description: 'List available teams' },
        { command: 'reset', description: 'Reset conversation history' },
        { command: 'restart', description: 'Restart TinyClaw' },
    ]).catch((err: Error) => logger.warn({ context: { error: err.message } }, 'Failed to register commands'));

    logger.info('Listening for messages');
}).catch((err: Error) => {
    logError(logger, err, 'Failed to connect Telegram bot');
    process.exit(1);
});

// Message received - Write to queue
bot.on('message', async (msg: TelegramBot.Message) => {
    try {
        // Skip group/channel messages - only handle private chats
        if (msg.chat.type !== 'private') {
            return;
        }

        // Determine message text and any media files
        let messageText = msg.text || msg.caption || '';
        const downloadedFiles: string[] = [];
        const queueMessageId = `${Date.now()}_${Math.random().toString(36).substring(7)}`;

        // Handle photo messages
        if (msg.photo && msg.photo.length > 0) {
            // Get the largest photo (last in array)
            const photo = msg.photo[msg.photo.length - 1];
            const filePath = await downloadTelegramFile(photo.file_id, '.jpg', queueMessageId, `photo_${msg.message_id}.jpg`);
            if (filePath) downloadedFiles.push(filePath);
        }

        // Handle document/file messages
        if (msg.document) {
            const ext = msg.document.file_name
                ? path.extname(msg.document.file_name)
                : extFromMime(msg.document.mime_type);
            const filePath = await downloadTelegramFile(msg.document.file_id, ext, queueMessageId, msg.document.file_name);
            if (filePath) downloadedFiles.push(filePath);
        }

        // Handle audio messages
        if (msg.audio) {
            const ext = extFromMime(msg.audio.mime_type) || '.mp3';
            const audioFileName = ('file_name' in msg.audio) ? (msg.audio as { file_name?: string }).file_name : undefined;
            const filePath = await downloadTelegramFile(msg.audio.file_id, ext, queueMessageId, audioFileName);
            if (filePath) downloadedFiles.push(filePath);
        }

        // Handle voice messages
        if (msg.voice) {
            const filePath = await downloadTelegramFile(msg.voice.file_id, '.ogg', queueMessageId, `voice_${msg.message_id}.ogg`);
            if (filePath) downloadedFiles.push(filePath);
        }

        // Handle video messages
        if (msg.video) {
            const ext = extFromMime(msg.video.mime_type) || '.mp4';
            const videoFileName = ('file_name' in msg.video) ? (msg.video as { file_name?: string }).file_name : undefined;
            const filePath = await downloadTelegramFile(msg.video.file_id, ext, queueMessageId, videoFileName);
            if (filePath) downloadedFiles.push(filePath);
        }

        // Handle video notes (round video messages)
        if (msg.video_note) {
            const filePath = await downloadTelegramFile(msg.video_note.file_id, '.mp4', queueMessageId, `video_note_${msg.message_id}.mp4`);
            if (filePath) downloadedFiles.push(filePath);
        }

        // Handle sticker
        if (msg.sticker) {
            const ext = msg.sticker.is_animated ? '.tgs' : msg.sticker.is_video ? '.webm' : '.webp';
            const filePath = await downloadTelegramFile(msg.sticker.file_id, ext, queueMessageId, `sticker_${msg.message_id}${ext}`);
            if (filePath) downloadedFiles.push(filePath);
            if (!messageText) messageText = `[Sticker: ${msg.sticker.emoji || 'sticker'}]`;
        }

        // Skip if no text and no media
        if ((!messageText || messageText.trim().length === 0) && downloadedFiles.length === 0) {
            return;
        }

        const sender = msg.from
            ? (msg.from.first_name + (msg.from.last_name ? ` ${msg.from.last_name}` : ''))
            : 'Unknown';
        const senderId = msg.chat.id.toString();

        logger.info({
            channel: 'telegram',
            sender,
            messageId: queueMessageId,
            excerpt: excerptText(messageText || '[media only]'),
            context: { fileCount: downloadedFiles.length },
        }, 'Message received');

        const pairing = ensureSenderPaired(PAIRING_FILE, 'telegram', senderId, sender);
        if (!pairing.approved && pairing.code) {
            if (pairing.isNewPending) {
                logger.info({ channel: 'telegram', sender, context: { senderId, pairingCode: pairing.code } }, 'Blocked unpaired sender');
                await bot.sendMessage(msg.chat.id, pairingMessage(pairing.code), {
                    reply_to_message_id: msg.message_id,
                });
            } else {
                logger.info({ channel: 'telegram', sender, context: { senderId } }, 'Blocked pending sender without re-sending pairing message');
            }
            return;
        }

        // Check for agent list command
        if (msg.text && msg.text.trim().match(/^[!/]agent$/i)) {
            logger.info({ channel: 'telegram', sender, messageId: queueMessageId }, 'Agent list command received');
            const agentList = getAgentListText();
            await bot.sendMessage(msg.chat.id, agentList, {
                reply_to_message_id: msg.message_id,
            });
            return;
        }

        // Check for team list command
        if (msg.text && msg.text.trim().match(/^[!/]team$/i)) {
            logger.info({ channel: 'telegram', sender, messageId: queueMessageId }, 'Team list command received');
            const teamList = getTeamListText();
            await bot.sendMessage(msg.chat.id, teamList, {
                reply_to_message_id: msg.message_id,
            });
            return;
        }

        // Check for reset command: /reset @agent_id [@agent_id2 ...]
        const resetMatch = messageText.trim().match(/^[!/]reset\s+(.+)$/i);
        if (messageText.trim().match(/^[!/]reset$/i)) {
            await bot.sendMessage(msg.chat.id, 'Usage: /reset @agent_id [@agent_id2 ...]\nSpecify which agent(s) to reset.', {
                reply_to_message_id: msg.message_id,
            });
            return;
        }
        if (resetMatch) {
            logger.info({ channel: 'telegram', sender, messageId: queueMessageId }, 'Per-agent reset command received');
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
                await bot.sendMessage(msg.chat.id, resetResults.join('\n'), {
                    reply_to_message_id: msg.message_id,
                });
            } catch {
                await bot.sendMessage(msg.chat.id, 'Could not process reset command. Check settings.', {
                    reply_to_message_id: msg.message_id,
                });
            }
            return;
        }

        // Check for restart command
        if (messageText.trim().match(/^[!/]restart$/i)) {
            logger.info({ channel: 'telegram', sender, messageId: queueMessageId }, 'Restart command received');
            await bot.sendMessage(msg.chat.id, 'Restarting TinyClaw...', {
                reply_to_message_id: msg.message_id,
            });
            const { exec } = require('child_process');
            exec(`"${path.join(SCRIPT_DIR, 'tinyclaw.sh')}" restart`, { detached: true, stdio: 'ignore' });
            return;
        }

        // Show typing indicator
        await bot.sendChatAction(msg.chat.id, 'typing');

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
                channel: 'telegram',
                sender,
                senderId,
                message: fullMessage,
                messageId: queueMessageId,
                files: downloadedFiles.length > 0 ? downloadedFiles : undefined,
            }),
        });

        logger.info({ channel: 'telegram', sender, messageId: queueMessageId, context: { senderId, fileCount: downloadedFiles.length } }, 'Queued message');

        // Store pending message for response
        pendingMessages.set(queueMessageId, {
            chatId: msg.chat.id,
            messageId: msg.message_id,
            timestamp: Date.now(),
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
        const res = await fetch(`${API_BASE}/api/responses/pending?channel=telegram`);
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
                const targetChatId = pending?.chatId ?? (senderId ? Number(senderId) : null);

                if (targetChatId && !Number.isNaN(targetChatId)) {
                    // Send any attached files first
                    if (files.length > 0) {
                        for (const file of files) {
                            try {
                                if (!fs.existsSync(file)) continue;
                                const ext = path.extname(file).toLowerCase();
                                if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
                                    await bot.sendPhoto(targetChatId, file);
                                } else if (['.mp3', '.ogg', '.wav', '.m4a'].includes(ext)) {
                                    await bot.sendAudio(targetChatId, file);
                                } else if (['.mp4', '.avi', '.mov', '.webm'].includes(ext)) {
                                    await bot.sendVideo(targetChatId, file);
                                } else {
                                    await bot.sendDocument(targetChatId, file);
                                }
                                logger.info({ channel: 'telegram', sender, messageId, context: { file: path.basename(file) } }, 'Sent file to Telegram');
                            } catch (fileErr) {
                                logError(logger, fileErr, 'Failed to send file to Telegram', { messageId, file });
                            }
                        }
                    }

                    // Split message if needed (Telegram 4096 char limit)
                    if (responseText) {
                        const chunks = splitMessage(responseText);
                        const parseMode = resp.metadata?.parseMode as TelegramBot.ParseMode | undefined;

                        if (chunks.length > 0) {
                            const opts: TelegramBot.SendMessageOptions = pending
                                ? { reply_to_message_id: pending.messageId }
                                : {};
                            if (parseMode) opts.parse_mode = parseMode;
                            await sendTelegramMessage(targetChatId, chunks[0]!, opts);
                        }
                        for (let i = 1; i < chunks.length; i++) {
                            await sendTelegramMessage(targetChatId, chunks[i]!, parseMode ? { parse_mode: parseMode } : {});
                        }
                    }

                    logger.info({
                        channel: 'telegram',
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
                    logger.warn({ channel: 'telegram', sender, messageId, context: { senderId } }, 'No pending message and no valid senderId; acking');
                    await fetch(`${API_BASE}/api/responses/${resp.id}/ack`, { method: 'POST' });
                }
            } catch (error) {
                logError(logger, error, 'Error processing Telegram response', { responseId: resp.id });
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

// Refresh typing indicator every 4 seconds for pending messages
setInterval(() => {
    for (const [, data] of pendingMessages.entries()) {
        bot.sendChatAction(data.chatId, 'typing').catch(() => {
            // Ignore typing errors silently
        });
    }
}, 4000);

// Restart polling with proper cleanup to avoid duplicate polling loops
async function restartPolling(reason: string, delayMs = 5000): Promise<void> {
    if (pollingRestartInProgress) {
        logger.info({ context: { reason } }, 'Polling restart already in progress, skipping');
        return;
    }
    pollingRestartInProgress = true;
    logger.warn({ context: { reason, delayMs } }, 'Stopping polling before restart');

    try {
        await bot.stopPolling();
    } catch (e) {
        logError(logger, e, 'stopPolling error (ignored)');
    }

    await new Promise(resolve => setTimeout(resolve, delayMs));

    try {
        logger.info({ context: { reason } }, 'Restarting polling');
        await bot.startPolling();
        lastPollingActivity = Date.now();
        logger.info('Polling restarted successfully');
    } catch (e) {
        logError(logger, e, 'Failed to restart polling', { reason });
    } finally {
        pollingRestartInProgress = false;
    }
}

// Handle polling errors with automatic recovery
bot.on('polling_error', (error: Error) => {
    logError(logger, error, 'Polling error');

    // ETELEGRAM 409 = another instance running (stale connection after sleep)
    // EFATAL = unrecoverable
    if (error.message.includes('EFATAL') || error.message.includes('409')) {
        restartPolling('Fatal polling error detected', 10000);
    }
});

// Track polling activity — any event from the bot means polling is alive
bot.on('message', () => { lastPollingActivity = Date.now(); });

// Watchdog: if no polling activity for 2 minutes, verify connectivity before restarting
setInterval(async () => {
    const silentMs = Date.now() - lastPollingActivity;
    if (silentMs > 2 * 60 * 1000) {
        // Check if the bot can actually reach Telegram before deciding polling is dead
        try {
            await bot.getMe();
            // API works fine — polling is just idle (no messages). Reset timer.
            lastPollingActivity = Date.now();
            logger.info({ context: { silentSeconds: Math.round(silentMs / 1000) } }, 'Watchdog check passed; polling is healthy');
        } catch {
            // API unreachable — polling is actually broken, restart it
            restartPolling(`No polling activity for ${Math.round(silentMs / 1000)}s and API unreachable (watchdog)`, 5000);
        }
    }
}, 30000);

async function shutdownTelegram(exitCode: number): Promise<void> {
    logger.info({ context: { exitCode } }, 'Shutting down Telegram client');
    try {
        await bot.stopPolling();
    } catch {
        // Ignore shutdown polling errors.
    }
    process.exit(exitCode);
}

// Catch unhandled errors so we can see what kills the bot
process.on('unhandledRejection', (reason) => {
    logError(logger, reason, 'Unhandled rejection');
});
process.on('uncaughtException', (error) => {
    logError(logger, error, 'Uncaught exception');
    void shutdownTelegram(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
    void shutdownTelegram(0);
});

process.on('SIGTERM', () => {
    void shutdownTelegram(0);
});

// Start
logger.info('Starting Telegram client');
