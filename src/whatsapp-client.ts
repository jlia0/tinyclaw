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

const SCRIPT_DIR = path.resolve(__dirname, '..');
const QUEUE_INCOMING = path.join(SCRIPT_DIR, '.tinyclaw/queue/incoming');
const QUEUE_OUTGOING = path.join(SCRIPT_DIR, '.tinyclaw/queue/outgoing');
const LOG_FILE = path.join(SCRIPT_DIR, '.tinyclaw/logs/whatsapp.log');
const SESSION_DIR = path.join(SCRIPT_DIR, '.tinyclaw/whatsapp-session');
const SETTINGS_FILE = path.join(SCRIPT_DIR, '.tinyclaw/settings.json');
const FILES_DIR = path.join(SCRIPT_DIR, '.tinyclaw/files');

// Ensure directories exist
[QUEUE_INCOMING, QUEUE_OUTGOING, path.dirname(LOG_FILE), SESSION_DIR, FILES_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

interface PendingMessage {
    message: Message;
    chat: Chat;
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
        log('INFO', `Downloaded media: ${filename} (${media.mimetype})`);
        return localPath;
    } catch (error) {
        log('ERROR', `Failed to download media: ${(error as Error).message}`);
        return null;
    }
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

// Load teams from settings for /agents command
function getAgentListText(): string {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const settings = JSON.parse(settingsData);
        const teams = settings.teams;
        if (!teams || Object.keys(teams).length === 0) {
            return 'No teams configured. Using default single-agent mode.\n\nConfigure teams in .tinyclaw/settings.json or run: tinyclaw team add';
        }
        let text = '*Available Teams:*\n';
        for (const [id, team] of Object.entries(teams) as [string, any][]) {
            text += `\n@${id} - ${team.name}`;
            text += `\n  Provider: ${team.provider}/${team.model}`;
            text += `\n  Directory: ${team.working_directory}`;
            if (team.system_prompt) text += `\n  Has custom system prompt`;
            if (team.prompt_file) text += `\n  Prompt file: ${team.prompt_file}`;
        }
        text += '\n\nUsage: Start your message with @team_id to route to a specific team.';
        return text;
    } catch {
        return 'Could not load team configuration.';
    }
}

// Initialize WhatsApp client
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: SESSION_DIR
    }),
    puppeteer: {
        headless: true,
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
    log('INFO', 'Scan this QR code with WhatsApp:');
    console.log('\n');

    // Display in tmux pane
    qrcode.generate(qr, { small: true });

    // Save to file for tinyclaw.sh to display (avoids tmux capture distortion)
    const channelsDir = path.join(SCRIPT_DIR, '.tinyclaw/channels');
    if (!fs.existsSync(channelsDir)) {
        fs.mkdirSync(channelsDir, { recursive: true });
    }
    const qrFile = path.join(channelsDir, 'whatsapp_qr.txt');
    qrcode.generate(qr, { small: true }, (code: string) => {
        fs.writeFileSync(qrFile, code);
        log('INFO', 'QR code saved to .tinyclaw/channels/whatsapp_qr.txt');
    });

    console.log('\n');
    log('INFO', 'Open WhatsApp → Settings → Linked Devices → Link a Device');
});

// Authentication success
client.on('authenticated', () => {
    log('INFO', 'WhatsApp authenticated successfully!');
});

// Client ready
client.on('ready', () => {
    log('INFO', '✓ WhatsApp client connected and ready!');
    log('INFO', 'Listening for messages...');

    // Create ready flag for tinyclaw.sh
    const readyFile = path.join(SCRIPT_DIR, '.tinyclaw/channels/whatsapp_ready');
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

        log('INFO', `📱 Message from ${sender}: ${messageText.substring(0, 50)}${downloadedFiles.length > 0 ? ` [+${downloadedFiles.length} file(s)]` : ''}...`);

        // Check for teams list command
        if (message.body.trim().match(/^[!/]team$/i)) {
            log('INFO', 'Teams list command received');
            const agentList = getAgentListText();
            await message.reply(agentList);
            return;
        }

        // Check for reset command
        if (messageText.trim().match(/^[!/]reset$/i)) {
            log('INFO', '🔄 Reset command received');

            // Create reset flag
            const resetFlagPath = path.join(SCRIPT_DIR, '.tinyclaw/reset_flag');
            fs.writeFileSync(resetFlagPath, 'reset');

            // Reply immediately
            await message.reply('Conversation reset! Next message will start a fresh conversation.');
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

        // Write to incoming queue
        const queueData: QueueData = {
            channel: 'whatsapp',
            sender: sender,
            senderId: message.from,
            message: fullMessage,
            timestamp: Date.now(),
            messageId: messageId,
            files: downloadedFiles.length > 0 ? downloadedFiles : undefined,
        };

        const queueFile = path.join(QUEUE_INCOMING, `whatsapp_${messageId}.json`);
        fs.writeFileSync(queueFile, JSON.stringify(queueData, null, 2));

        log('INFO', `✓ Queued message ${messageId}`);

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
            .filter(f => f.startsWith('whatsapp_') && f.endsWith('.json'));

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
                                if (!fs.existsSync(file)) continue;
                                const media = MessageMedia.fromFilePath(file);
                                await pending.chat.sendMessage(media);
                                log('INFO', `Sent file to WhatsApp: ${path.basename(file)}`);
                            } catch (fileErr) {
                                log('ERROR', `Failed to send file ${file}: ${(fileErr as Error).message}`);
                            }
                        }
                    }

                    // Send text response
                    if (responseText) {
                        pending.message.reply(responseText);
                    }
                    log('INFO', `✓ Sent response to ${sender} (${responseText.length} chars${responseData.files ? `, ${responseData.files.length} file(s)` : ''})`);

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

// Error handlers
client.on('auth_failure', (msg: string) => {
    log('ERROR', `Authentication failure: ${msg}`);
    process.exit(1);
});

client.on('disconnected', (reason: string) => {
    log('WARN', `WhatsApp disconnected: ${reason}`);

    // Remove ready flag
    const readyFile = path.join(SCRIPT_DIR, '.tinyclaw/channels/whatsapp_ready');
    if (fs.existsSync(readyFile)) {
        fs.unlinkSync(readyFile);
    }
});

// Graceful shutdown
process.on('SIGINT', async () => {
    log('INFO', 'Shutting down WhatsApp client...');

    // Remove ready flag
    const readyFile = path.join(SCRIPT_DIR, '.tinyclaw/channels/whatsapp_ready');
    if (fs.existsSync(readyFile)) {
        fs.unlinkSync(readyFile);
    }

    await client.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    log('INFO', 'Shutting down WhatsApp client...');

    // Remove ready flag
    const readyFile = path.join(SCRIPT_DIR, '.tinyclaw/channels/whatsapp_ready');
    if (fs.existsSync(readyFile)) {
        fs.unlinkSync(readyFile);
    }

    await client.destroy();
    process.exit(0);
});

// Start client
log('INFO', 'Starting WhatsApp client...');
client.initialize();
