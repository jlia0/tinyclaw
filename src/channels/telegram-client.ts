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
import { QuestionData } from '../lib/types';
import { writeAnswer } from '../lib/question-bridge';

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
const PAIRING_FILE = path.join(TINYCLAW_HOME, 'pairing.json');
const QUEUE_QUESTIONS = path.join(TINYCLAW_HOME, 'queue/questions');
const QUEUE_ANSWERS = path.join(TINYCLAW_HOME, 'queue/answers');

// Ensure directories exist
[QUEUE_INCOMING, QUEUE_OUTGOING, QUEUE_QUESTIONS, QUEUE_ANSWERS, path.dirname(LOG_FILE), FILES_DIR].forEach(dir => {
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
    senderId?: string;
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

// Track pending messages (waiting for response) — persisted to survive restarts
const PENDING_FILE = path.join(TINYCLAW_HOME, 'queue', 'pending-telegram.json');
const pendingMessages = new Map<string, PendingMessage>();
let processingOutgoingQueue = false;

function loadPendingMessages(): void {
    try {
        if (fs.existsSync(PENDING_FILE)) {
            const data: Record<string, PendingMessage> = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
            const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
            for (const [id, msg] of Object.entries(data)) {
                if (msg.timestamp >= tenMinutesAgo) {
                    pendingMessages.set(id, msg);
                }
            }
            if (pendingMessages.size > 0) {
                log('INFO', `Restored ${pendingMessages.size} pending message(s) from disk`);
            }
        }
    } catch (error) {
        log('WARN', `Failed to load pending messages: ${(error as Error).message}`);
    }
}

function savePendingMessages(): void {
    try {
        const obj: Record<string, PendingMessage> = {};
        for (const [id, msg] of pendingMessages.entries()) {
            obj[id] = msg;
        }
        fs.writeFileSync(PENDING_FILE, JSON.stringify(obj, null, 2));
    } catch (error) {
        log('WARN', `Failed to save pending messages: ${(error as Error).message}`);
    }
}

// Load persisted pending messages on startup
loadPendingMessages();

// Interactive question state
const pendingQuestions = new Map<string, QuestionData>();     // questionId → QuestionData
const awaitingFreeText = new Map<number, string>();           // chatId → questionId
const multiSelectState = new Map<string, Set<number>>();      // questionId → selected option indices

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

// Convert GitHub-flavored Markdown to Telegram HTML
// Telegram HTML supports: <b>, <i>, <u>, <s>, <code>, <pre>, <a>, <blockquote>,
// <blockquote expandable>, <tg-spoiler>
// GFM uses **bold**, *italic*, ~~strikethrough~~, # headers, > blockquotes, etc.
function gfmToTelegram(text: string): string {
    let result = text;

    // Strip decorative ★ lines and Unicode box-drawing lines BEFORE backtick conversion
    // (these rely on backtick delimiters which get consumed by <code> conversion)
    result = result.replace(/^`?★[^`]*`?$/gm, '');
    result = result.replace(/^`?[─═╌╍┄┅┈┉╴╶]+`?$/gm, '');

    // Escape HTML entities first (before we add our own tags)
    result = result.replace(/&/g, '&amp;');
    result = result.replace(/</g, '&lt;');
    result = result.replace(/>/g, '&gt;');

    // Now convert GFM syntax to Telegram HTML tags

    // Code blocks: ```lang\ncode\n``` → <pre>code</pre>
    // Must happen before inline conversions to protect code content
    result = result.replace(/```[a-zA-Z]*\n([\s\S]*?)```/g, '<pre>$1</pre>');
    result = result.replace(/```([\s\S]*?)```/g, '<pre>$1</pre>');

    // Inline code: `code` → <code>code</code>
    result = result.replace(/`([^`\n]+)`/g, '<code>$1</code>');

    // Headers: # text → <b>text</b> (with a line break after for spacing)
    result = result.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');

    // Bold+italic: ***text*** → <b><i>text</i></b>
    result = result.replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>');

    // Bold: **text** → <b>text</b>
    result = result.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

    // Italic: *text* → <i>text</i> (but not inside words like file*name)
    result = result.replace(/(?<!\w)\*([^*\n]+?)\*(?!\w)/g, '<i>$1</i>');

    // Strikethrough: ~~text~~ → <s>text</s>
    result = result.replace(/~~(.+?)~~/g, '<s>$1</s>');

    // Links: [text](url) → <a href="url">text</a>
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Blockquotes: lines starting with &gt; (we escaped > earlier)
    // Collect consecutive blockquote lines into a single <blockquote> block
    result = result.replace(/(^&gt;\s?.*$(\n|$))+/gm, (match) => {
        const inner = match
            .split('\n')
            .map(line => line.replace(/^&gt;\s?/, ''))
            .join('\n')
            .trim();
        return `<blockquote>${inner}</blockquote>\n`;
    });

    // Remove horizontal rules (--- or ***)
    result = result.replace(/^[-*_]{3,}\s*$/gm, '');

    // Remove table formatting — convert to simple lines
    // Remove table separator rows (|---|---|)
    result = result.replace(/^\|[-:\s|]+\|$/gm, '');
    // Convert table rows: | cell | cell | → cell — cell
    result = result.replace(/^\|(.+)\|$/gm, (_match, content: string) => {
        return content.split('|').map((c: string) => c.trim()).filter(Boolean).join(' — ');
    });

    // Remove image syntax ![alt](url) — keep just the alt text
    result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

    // Collapse multiple blank lines into max 2
    result = result.replace(/\n{3,}/g, '\n\n');

    return result.trim();
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
            fs.unlink(destPath, () => {}); // Clean up on error
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

// Bot ready — register commands and start listening
bot.getMe().then(async (me: TelegramBot.User) => {
    log('INFO', `Telegram bot connected as @${me.username}`);

    // Register bot commands so they appear in Telegram's "/" menu
    await bot.setMyCommands([
        { command: 'agent', description: 'List available agents' },
        { command: 'team', description: 'List available teams' },
        { command: 'reset', description: 'Reset conversation history' },
    ]).catch((err: Error) => log('WARN', `Failed to register commands: ${err.message}`));

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

        // Intercept free-text answers for "Other" option in interactive questions
        const pendingQuestionId = awaitingFreeText.get(msg.chat.id);
        if (pendingQuestionId && msg.text) {
            awaitingFreeText.delete(msg.chat.id);
            const written = writeAnswer(pendingQuestionId, msg.text);
            if (written) {
                await bot.sendMessage(msg.chat.id, `Got it: "${msg.text}"`, {
                    reply_to_message_id: msg.message_id,
                });
                log('INFO', `Free-text answer for question ${pendingQuestionId}: ${msg.text.substring(0, 80)}`);
            } else {
                await bot.sendMessage(msg.chat.id, 'That question was already answered.', {
                    reply_to_message_id: msg.message_id,
                });
            }
            pendingQuestions.delete(pendingQuestionId);
            return; // Don't queue as normal message
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

        log('INFO', `Message from ${sender}: ${messageText.substring(0, 50)}${downloadedFiles.length > 0 ? ` [+${downloadedFiles.length} file(s)]` : ''}...`);

        const pairing = ensureSenderPaired(PAIRING_FILE, 'telegram', senderId, sender);
        if (!pairing.approved && pairing.code) {
            if (pairing.isNewPending) {
                log('INFO', `Blocked unpaired Telegram sender ${sender} (${senderId}) with code ${pairing.code}`);
                await bot.sendMessage(msg.chat.id, pairingMessage(pairing.code), {
                    reply_to_message_id: msg.message_id,
                });
            } else {
                log('INFO', `Blocked pending Telegram sender ${sender} (${senderId}) without re-sending pairing message`);
            }
            return;
        }

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

            // Create reset flag (TINYCLAW_HOME = ~/.tinyclaw, not SCRIPT_DIR)
            const resetFlagPath = path.join(TINYCLAW_HOME, 'reset_flag');
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

        // Persist to disk so responses survive restarts
        savePendingMessages();

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

                // Handle heartbeat files — refresh pending TTL, don't send to user
                if (messageId.startsWith('heartbeat_')) {
                    const realMessageId = messageId.replace('heartbeat_', '');
                    const pending = pendingMessages.get(realMessageId);
                    if (pending) {
                        pending.timestamp = Date.now();
                        savePendingMessages();
                        log('INFO', `Refreshed pending TTL for ${realMessageId}`);
                    }
                    fs.unlinkSync(filePath);
                    continue;
                }

                // Handle partial responses — send text but keep pending (question is coming next)
                if (messageId.startsWith('partial_')) {
                    const realMessageId = messageId.replace(/^partial_/, '').replace(/_r\d+$/, '');
                    const pending = pendingMessages.get(realMessageId);
                    if (pending && responseData.message) {
                        const chunks = splitMessage(responseData.message);
                        const sendFormatted = async (chatId: number, text: string, opts?: Record<string, any>) => {
                            const converted = gfmToTelegram(text);
                            try {
                                await bot.sendMessage(chatId, converted, { ...opts, parse_mode: 'HTML' });
                            } catch (err: any) {
                                if (err?.response?.body?.description?.includes("can't parse")) {
                                    const stripped = converted.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
                                    await bot.sendMessage(chatId, stripped || text, opts || {});
                                } else {
                                    throw err;
                                }
                            }
                        };
                        for (const chunk of chunks) {
                            await sendFormatted(pending.chatId, chunk);
                        }
                        pending.timestamp = Date.now();
                        savePendingMessages();
                        log('INFO', `Sent partial response (${responseData.message.length} chars) for ${realMessageId}`);
                    }
                    fs.unlinkSync(filePath);
                    continue;
                }

                // Find pending message
                const pending = pendingMessages.get(messageId);
                if (pending) {
                    // Send any attached files first
                    if (responseData.files && responseData.files.length > 0) {
                        for (const file of responseData.files) {
                            try {
                                if (!fs.existsSync(file)) continue;
                                const ext = path.extname(file).toLowerCase();
                                if (ext === '.gif') {
                                    await bot.sendAnimation(pending.chatId, file);
                                } else if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
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

                        // Send with HTML parse_mode, fallback to plain text (tags stripped) if parsing fails
                        const sendFormatted = async (chatId: number, text: string, opts?: Record<string, any>) => {
                            const converted = gfmToTelegram(text);
                            try {
                                await bot.sendMessage(chatId, converted, { ...opts, parse_mode: 'HTML' });
                            } catch (err: any) {
                                // If HTML parsing fails, strip tags and send as plain text
                                if (err?.response?.body?.description?.includes("can't parse")) {
                                    log('WARN', `HTML parse failed, sending as plain text`);
                                    const stripped = converted
                                        .replace(/<[^>]+>/g, '')
                                        .replace(/&amp;/g, '&')
                                        .replace(/&lt;/g, '<')
                                        .replace(/&gt;/g, '>')
                                        .replace(/&quot;/g, '"')
                                        .trim();
                                    if (!stripped) {
                                        // Tag-stripped result is empty — send original unconverted text
                                        log('WARN', `Stripped text empty, sending original unconverted text`);
                                        await bot.sendMessage(chatId, text, opts || {});
                                        return;
                                    }
                                    await bot.sendMessage(chatId, stripped, opts || {});
                                } else {
                                    throw err;
                                }
                            }
                        };

                        // First chunk as reply, rest as follow-up messages
                        if (chunks.length > 0) {
                            await sendFormatted(pending.chatId, chunks[0]!, {
                                reply_to_message_id: pending.messageId,
                            });
                        }
                        for (let i = 1; i < chunks.length; i++) {
                            await sendFormatted(pending.chatId, chunks[i]!);
                        }
                    } else {
                        // Agent returned empty response — notify user instead of silent drop
                        log('WARN', `Empty response for message ${messageId}, sending fallback`);
                        await bot.sendMessage(pending.chatId, '⏳ Response was empty — the agent may still be processing. Try again.', {
                            reply_to_message_id: pending.messageId,
                        });
                    }

                    log('INFO', `Sent response to ${sender} (${responseText.length} chars${responseData.files ? `, ${responseData.files.length} file(s)` : ''})`);

                    // Clean up
                    pendingMessages.delete(messageId);
                    savePendingMessages();
                    fs.unlinkSync(filePath);
                } else if (responseData.senderId) {
                    // Proactive/agent-initiated message — send directly to user
                    const chatId = Number(responseData.senderId);

                    // Send any attached files first
                    if (responseData.files && responseData.files.length > 0) {
                        for (const file of responseData.files) {
                            try {
                                if (!fs.existsSync(file)) continue;
                                const ext = path.extname(file).toLowerCase();
                                if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
                                    await bot.sendPhoto(chatId, file);
                                } else if (['.mp3', '.ogg', '.wav', '.m4a'].includes(ext)) {
                                    await bot.sendAudio(chatId, file);
                                } else if (['.mp4', '.avi', '.mov', '.webm'].includes(ext)) {
                                    await bot.sendVideo(chatId, file);
                                } else {
                                    await bot.sendDocument(chatId, file);
                                }
                                log('INFO', `Sent file to Telegram: ${path.basename(file)}`);
                            } catch (fileErr) {
                                log('ERROR', `Failed to send file ${file}: ${(fileErr as Error).message}`);
                            }
                        }
                    }

                    // Send message text
                    if (responseText) {
                        const chunks = splitMessage(responseText);
                        for (const chunk of chunks) {
                            await bot.sendMessage(chatId, chunk);
                        }
                    }

                    log('INFO', `Sent proactive message to ${sender} (${responseText.length} chars${responseData.files ? `, ${responseData.files.length} file(s)` : ''})`);
                    fs.unlinkSync(filePath);
                } else {
                    log('WARN', `No pending message for ${messageId} and no senderId, cleaning up`);
                    fs.unlinkSync(filePath);
                }
            } catch (error: any) {
                const statusCode = error?.response?.statusCode;
                log('ERROR', `Error processing response file ${file}: ${(error as Error).message}`);
                // Delete on permanent client errors (4xx) to prevent infinite retry loops
                if (statusCode && statusCode >= 400 && statusCode < 500) {
                    log('WARN', `Permanent error (${statusCode}), removing response file ${file}`);
                    try { fs.unlinkSync(filePath); } catch {}
                }
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

// ─── Interactive Questions: Inline Keyboard ────────────────────────────────

/**
 * Build a Telegram InlineKeyboardMarkup from question options.
 * Each button's callback_data: "q:<questionId>:<optionIndex>"
 * "Other" button triggers free-text mode.
 */
function buildQuestionKeyboard(questionId: string, options: { label: string; description?: string }[], multiSelect: boolean, selected?: Set<number>): TelegramBot.InlineKeyboardMarkup {
    const rows: TelegramBot.InlineKeyboardButton[][] = [];

    for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        const prefix = multiSelect && selected?.has(i) ? '✓ ' : '';
        rows.push([{
            text: `${prefix}${opt.label}`,
            callback_data: `q:${questionId}:${i}`,
        }]);
    }

    if (multiSelect) {
        rows.push([{
            text: '✅ Done',
            callback_data: `q:${questionId}:done`,
        }]);
    }

    rows.push([{
        text: '💬 Other (type answer)',
        callback_data: `q:${questionId}:other`,
    }]);

    return { inline_keyboard: rows };
}

// Watch questions queue for Telegram questions
async function checkQuestionsQueue(): Promise<void> {
    try {
        if (!fs.existsSync(QUEUE_QUESTIONS)) return;

        const files = fs.readdirSync(QUEUE_QUESTIONS)
            .filter(f => f.startsWith('telegram_') && f.endsWith('.json'));

        for (const file of files) {
            const filePath = path.join(QUEUE_QUESTIONS, file);
            try {
                const question: QuestionData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

                // Delete BEFORE sending to prevent duplicate delivery on next poll tick
                try { fs.unlinkSync(filePath); } catch {}

                // Build inline keyboard
                const keyboard = buildQuestionKeyboard(question.questionId, question.options, question.multiSelect);

                // Format question text with option descriptions
                let text = `❓ ${question.question}`;
                const descriptions = question.options
                    .filter(o => o.description)
                    .map(o => `• <b>${o.label}</b> — ${o.description}`);
                if (descriptions.length > 0) {
                    text += '\n\n' + descriptions.join('\n');
                }

                // Send to Telegram with inline keyboard
                await bot.sendMessage(question.chatId, text, {
                    parse_mode: 'HTML',
                    reply_markup: keyboard,
                });

                // Store for callback resolution
                pendingQuestions.set(question.questionId, question);
                if (question.multiSelect) {
                    multiSelectState.set(question.questionId, new Set());
                }

                log('INFO', `Sent question ${question.questionId} to chat ${question.chatId}`);

            } catch (error) {
                log('ERROR', `Error processing question file ${file}: ${(error as Error).message}`);
                // Delete malformed files to prevent infinite retry
                try { fs.unlinkSync(filePath); } catch {}
            }
        }
    } catch (error) {
        log('ERROR', `Questions queue error: ${(error as Error).message}`);
    }
}

// Poll questions queue every 500ms
setInterval(checkQuestionsQueue, 500);

// Handle inline keyboard button presses
bot.on('callback_query', async (query: TelegramBot.CallbackQuery) => {
    try {
        const data = query.data;
        if (!data || !data.startsWith('q:')) {
            await bot.answerCallbackQuery(query.id);
            return;
        }

        // Parse callback_data: "q:<questionId>:<action>"
        const parts = data.split(':');
        if (parts.length < 3) {
            await bot.answerCallbackQuery(query.id, { text: 'Invalid selection' });
            return;
        }

        const questionId = parts[1];
        const action = parts.slice(2).join(':'); // Rejoin in case questionId contains colons
        const question = pendingQuestions.get(questionId);

        if (!question) {
            await bot.answerCallbackQuery(query.id, { text: 'This question has expired.' });
            return;
        }

        // Handle "Other" — enter free-text mode
        if (action === 'other') {
            awaitingFreeText.set(question.chatId, questionId);
            await bot.answerCallbackQuery(query.id);
            await bot.sendMessage(question.chatId, 'Type your answer:');
            return;
        }

        // Handle multiSelect "Done" — submit selected options
        if (action === 'done' && question.multiSelect) {
            const selected = multiSelectState.get(questionId);
            if (!selected || selected.size === 0) {
                await bot.answerCallbackQuery(query.id, { text: 'Please select at least one option.' });
                return;
            }

            const selectedLabels = Array.from(selected)
                .sort((a, b) => a - b)
                .map(i => question.options[i]?.label)
                .filter(Boolean)
                .join(', ');

            const written = writeAnswer(questionId, selectedLabels);
            await bot.answerCallbackQuery(query.id, { text: written ? 'Submitted!' : 'Already answered.' });

            // Edit message to show selection (only if write succeeded)
            if (written && query.message) {
                await bot.editMessageText(
                    `${question.question}\n\n✅ Selected: ${selectedLabels}`,
                    { chat_id: query.message.chat.id, message_id: query.message.message_id }
                ).catch(() => {});
            }

            pendingQuestions.delete(questionId);
            multiSelectState.delete(questionId);
            return;
        }

        // Handle option selection
        const optionIndex = parseInt(action, 10);
        if (isNaN(optionIndex) || optionIndex < 0 || optionIndex >= question.options.length) {
            await bot.answerCallbackQuery(query.id, { text: 'Invalid option.' });
            return;
        }

        if (question.multiSelect) {
            // Toggle selection
            const selected = multiSelectState.get(questionId) || new Set<number>();
            if (selected.has(optionIndex)) {
                selected.delete(optionIndex);
            } else {
                selected.add(optionIndex);
            }
            multiSelectState.set(questionId, selected);

            // Update keyboard to show check marks
            const keyboard = buildQuestionKeyboard(questionId, question.options, true, selected);
            if (query.message) {
                await bot.editMessageReplyMarkup(keyboard, {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id,
                }).catch(() => {});
            }

            const label = question.options[optionIndex].label;
            await bot.answerCallbackQuery(query.id, {
                text: selected.has(optionIndex) ? `Selected: ${label}` : `Deselected: ${label}`,
            });
        } else {
            // Single select — submit immediately
            const selectedLabel = question.options[optionIndex].label;
            const written = writeAnswer(questionId, selectedLabel);
            await bot.answerCallbackQuery(query.id, { text: written ? `Selected: ${selectedLabel}` : 'Already answered.' });

            // Edit message to show selection (only if write succeeded)
            if (written && query.message) {
                await bot.editMessageText(
                    `${question.question}\n\n✅ ${selectedLabel}`,
                    { chat_id: query.message.chat.id, message_id: query.message.message_id }
                ).catch(() => {});
            }

            pendingQuestions.delete(questionId);
        }
    } catch (error) {
        log('ERROR', `Callback query error: ${(error as Error).message}`);
        try { await bot.answerCallbackQuery(query.id); } catch {}
    }
});

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
