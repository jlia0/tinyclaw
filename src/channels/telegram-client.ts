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

const SCRIPT_DIR = path.resolve(__dirname, '..', '..');
const _localTinyclaw = path.join(SCRIPT_DIR, '.tinyclaw');
const TINYCLAW_HOME = fs.existsSync(path.join(_localTinyclaw, 'settings.json'))
    ? _localTinyclaw
    : path.join(require('os').homedir(), '.tinyclaw');
const QUEUE_INCOMING = path.join(TINYCLAW_HOME, 'queue/incoming');
const QUEUE_OUTGOING = path.join(TINYCLAW_HOME, 'queue/outgoing');
const LOG_FILE = path.join(TINYCLAW_HOME, 'logs/telegram.log');
const SETTINGS_FILE = path.join(TINYCLAW_HOME, 'settings.json');
const FILES_DIR = path.join(TINYCLAW_HOME, 'files');
const MAX_DOWNLOAD_BYTES = Number(process.env.TINYCLAW_MAX_DOWNLOAD_BYTES || (25 * 1024 * 1024));
const DOWNLOAD_TIMEOUT_MS = Number(process.env.TINYCLAW_DOWNLOAD_TIMEOUT_MS || 30000);
const MAX_REDIRECTS = 5;

// Ensure directories exist
[QUEUE_INCOMING, QUEUE_OUTGOING, path.dirname(LOG_FILE), FILES_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Validate bot token
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'your_token_here') {
    console.error('ERROR: TELEGRAM_BOT_TOKEN is not set in .env file');
    process.exit(1);
}

interface PendingMessage {
    chatId: number;
    messageId: number;
    timestamp: number;
}

interface QueueData {
    channel: string;
    sender: string;
    senderId: string;
    message: string;
    timestamp: number;
    messageId: string;
    files?: string[];
}

interface ResponseData {
    channel: string;
    sender: string;
    message: string;
    originalMessage: string;
    timestamp: number;
    messageId: string;
    files?: string[];
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

function pathInDirectory(candidatePath: string, directoryPath: string): boolean {
    try {
        const resolvedDir = fs.realpathSync(directoryPath);
        const resolvedFile = fs.realpathSync(candidatePath);
        if (resolvedFile === resolvedDir) return true;
        const dirWithSep = resolvedDir.endsWith(path.sep) ? resolvedDir : `${resolvedDir}${path.sep}`;
        return resolvedFile.startsWith(dirWithSep);
    } catch {
        return false;
    }
}

function isAllowedOutgoingFile(filePath: string): boolean {
    if (!fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    return pathInDirectory(filePath, FILES_DIR);
}

// Track pending messages (waiting for response)
const pendingMessages = new Map<string, PendingMessage>();
let processingOutgoingQueue = false;

// Logger
function log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(LOG_FILE, logMessage);
}

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

function isSenderAllowed(senderId: string): boolean {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const settings = JSON.parse(settingsData);
        const requireAllowlist = settings?.security?.require_sender_allowlist !== false;
        if (!requireAllowlist) return true;
        const allowed: string[] = settings?.security?.allowed_senders?.telegram || [];
        return allowed.includes('*') || allowed.includes(senderId);
    } catch {
        return false;
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

// Download a file from URL to local path
function downloadFile(url: string, destPath: string, redirectCount = 0): Promise<void> {
    return new Promise((resolve, reject) => {
        if (redirectCount > MAX_REDIRECTS) {
            reject(new Error('Too many redirects while downloading file'));
            return;
        }

        let parsedUrl: URL;
        try {
            parsedUrl = new URL(url);
        } catch {
            reject(new Error('Invalid download URL'));
            return;
        }
        if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
            reject(new Error(`Unsupported URL protocol: ${parsedUrl.protocol}`));
            return;
        }

        const file = fs.createWriteStream(destPath);
        let totalBytes = 0;
        let settled = false;
        const cleanupFile = () => fs.unlink(destPath, () => {});

        const request = (parsedUrl.protocol === 'https:' ? https.get(url, handleResponse) : http.get(url, handleResponse));
        request.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
            if (settled) return;
            settled = true;
            request.destroy(new Error('Download timeout'));
            file.destroy();
            cleanupFile();
            reject(new Error('Download timeout'));
        });

        function handleResponse(response: http.IncomingMessage): void {
            if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
                const redirectUrl = response.headers.location;
                if (redirectUrl) {
                    settled = true;
                    const absoluteRedirect = new URL(redirectUrl, parsedUrl).toString();
                    file.close();
                    cleanupFile();
                    downloadFile(absoluteRedirect, destPath, redirectCount + 1).then(resolve).catch(reject);
                    return;
                }
            }

            if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
                settled = true;
                file.destroy();
                cleanupFile();
                reject(new Error(`Download failed with status ${response.statusCode}`));
                return;
            }

            response.on('data', (chunk: Buffer) => {
                totalBytes += chunk.length;
                if (totalBytes > MAX_DOWNLOAD_BYTES && !settled) {
                    settled = true;
                    response.destroy(new Error('Download exceeded size limit'));
                    request.destroy(new Error('Download exceeded size limit'));
                    file.destroy();
                    cleanupFile();
                    reject(new Error(`Download exceeds max size (${MAX_DOWNLOAD_BYTES} bytes)`));
                }
            });

            response.pipe(file);
            file.on('finish', () => {
                if (settled) return;
                settled = true;
                file.close();
                resolve();
            });
        }

        request.on('error', (err) => {
            if (settled) return;
            settled = true;
            cleanupFile();
            file.destroy();
            reject(err);
        });

        file.on('error', (err) => {
            if (settled) return;
            settled = true;
            request.destroy();
            cleanupFile();
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
        log('INFO', `Downloaded file: ${path.basename(localPath)}`);
        return localPath;
    } catch (error) {
        log('ERROR', `Failed to download file: ${(error as Error).message}`);
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

// Initialize Telegram bot (polling mode)
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Bot ready
bot.getMe().then((me: TelegramBot.User) => {
    log('INFO', `Telegram bot connected as @${me.username}`);
    log('INFO', 'Listening for messages...');
}).catch((err: Error) => {
    log('ERROR', `Failed to connect: ${err.message}`);
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
        const senderId = msg.from ? msg.from.id.toString() : msg.chat.id.toString();

        if (!isSenderAllowed(senderId)) {
            log('WARN', `Blocked unauthorized sender: ${sender} (${senderId})`);
            await bot.sendMessage(msg.chat.id, `Access denied. Sender ID ${senderId} is not allowlisted.`, {
                reply_to_message_id: msg.message_id,
            });
            return;
        }

        log('INFO', `Message from ${sender}: ${messageText.substring(0, 50)}${downloadedFiles.length > 0 ? ` [+${downloadedFiles.length} file(s)]` : ''}...`);

        // Check for agent list command
        if (msg.text && msg.text.trim().match(/^[!/]agent$/i)) {
            log('INFO', 'Agent list command received');
            const agentList = getAgentListText();
            await bot.sendMessage(msg.chat.id, agentList, {
                reply_to_message_id: msg.message_id,
            });
            return;
        }

        // Check for team list command
        if (msg.text && msg.text.trim().match(/^[!/]team$/i)) {
            log('INFO', 'Team list command received');
            const teamList = getTeamListText();
            await bot.sendMessage(msg.chat.id, teamList, {
                reply_to_message_id: msg.message_id,
            });
            return;
        }

        // Check for reset command
        if (messageText.trim().match(/^[!/]reset$/i)) {
            log('INFO', 'Reset command received');

            // Create reset flag
            const resetFlagPath = path.join(SCRIPT_DIR, '.tinyclaw/reset_flag');
            fs.writeFileSync(resetFlagPath, 'reset');

            // Reply immediately
            await bot.sendMessage(msg.chat.id, 'Conversation reset! Next message will start a fresh conversation.', {
                reply_to_message_id: msg.message_id,
            });
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

        // Write to incoming queue
        const queueData: QueueData = {
            channel: 'telegram',
            sender: sender,
            senderId: senderId,
            message: fullMessage,
            timestamp: Date.now(),
            messageId: queueMessageId,
            files: downloadedFiles.length > 0 ? downloadedFiles : undefined,
        };

        const queueFile = path.join(QUEUE_INCOMING, `telegram_${queueMessageId}.json`);
        fs.writeFileSync(queueFile, JSON.stringify(queueData, null, 2));

        log('INFO', `Queued message ${queueMessageId}`);

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
        log('ERROR', `Message handling error: ${(error as Error).message}`);
    }
});

// Watch for responses in outgoing queue
async function checkOutgoingQueue(): Promise<void> {
    if (processingOutgoingQueue) {
        return;
    }

    processingOutgoingQueue = true;

    try {
        const files = fs.readdirSync(QUEUE_OUTGOING)
            .filter(f => f.startsWith('telegram_') && f.endsWith('.json'));

        for (const file of files) {
            const filePath = path.join(QUEUE_OUTGOING, file);

            try {
                const responseData: ResponseData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                const { messageId, message: responseText, sender } = responseData;

                // Find pending message
                const pending = pendingMessages.get(messageId);
                if (pending) {
                    // Send any attached files first
                    if (responseData.files && responseData.files.length > 0) {
                        for (const file of responseData.files) {
                            try {
                                if (!isAllowedOutgoingFile(file)) {
                                    log('WARN', `Blocked unsafe outbound file path: ${file}`);
                                    continue;
                                }
                                const ext = path.extname(file).toLowerCase();
                                if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
                                    await bot.sendPhoto(pending.chatId, file);
                                } else if (['.mp3', '.ogg', '.wav', '.m4a'].includes(ext)) {
                                    await bot.sendAudio(pending.chatId, file);
                                } else if (['.mp4', '.avi', '.mov', '.webm'].includes(ext)) {
                                    await bot.sendVideo(pending.chatId, file);
                                } else {
                                    await bot.sendDocument(pending.chatId, file);
                                }
                                log('INFO', `Sent file to Telegram: ${path.basename(file)}`);
                            } catch (fileErr) {
                                log('ERROR', `Failed to send file ${file}: ${(fileErr as Error).message}`);
                            }
                        }
                    }

                    // Split message if needed (Telegram 4096 char limit)
                    if (responseText) {
                        const chunks = splitMessage(responseText);

                        // First chunk as reply, rest as follow-up messages
                        if (chunks.length > 0) {
                            await bot.sendMessage(pending.chatId, chunks[0]!, {
                                reply_to_message_id: pending.messageId,
                            });
                        }
                        for (let i = 1; i < chunks.length; i++) {
                            await bot.sendMessage(pending.chatId, chunks[i]!);
                        }
                    }

                    log('INFO', `Sent response to ${sender} (${responseText.length} chars${responseData.files ? `, ${responseData.files.length} file(s)` : ''})`);

                    // Clean up
                    pendingMessages.delete(messageId);
                    fs.unlinkSync(filePath);
                } else {
                    // Message too old or already processed
                    log('WARN', `No pending message for ${messageId}, cleaning up`);
                    fs.unlinkSync(filePath);
                }
            } catch (error) {
                log('ERROR', `Error processing response file ${file}: ${(error as Error).message}`);
                // Don't delete file on error, might retry
            }
        }
    } catch (error) {
        log('ERROR', `Outgoing queue error: ${(error as Error).message}`);
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

// Handle polling errors
bot.on('polling_error', (error: Error) => {
    log('ERROR', `Polling error: ${error.message}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    log('INFO', 'Shutting down Telegram client...');
    bot.stopPolling();
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('INFO', 'Shutting down Telegram client...');
    bot.stopPolling();
    process.exit(0);
});

// Start
log('INFO', 'Starting Telegram client...');
