#!/usr/bin/env node
/**
 * Discord Client for TinyClaw Simple
 * Writes DM messages to queue and reads responses
 * Does NOT call Claude directly - that's handled by queue-processor
 */

import { Client, Events, GatewayIntentBits, Partials, Message, DMChannel } from 'discord.js';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const SCRIPT_DIR = path.resolve(__dirname, '..');
const QUEUE_INCOMING = path.join(SCRIPT_DIR, '.tinyclaw/queue/incoming');
const QUEUE_OUTGOING = path.join(SCRIPT_DIR, '.tinyclaw/queue/outgoing');
const LOG_FILE = path.join(SCRIPT_DIR, '.tinyclaw/logs/discord.log');

// Ensure directories exist
[QUEUE_INCOMING, QUEUE_OUTGOING, path.dirname(LOG_FILE)].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Validate bot token
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!DISCORD_BOT_TOKEN || DISCORD_BOT_TOKEN === 'your_token_here') {
    console.error('ERROR: DISCORD_BOT_TOKEN is not set in .env file');
    process.exit(1);
}

interface PendingMessage {
    message: Message;
    channel: DMChannel;
    timestamp: number;
}

interface QueueData {
    channel: string;
    sender: string;
    senderId: string;
    message: string;
    timestamp: number;
    messageId: string;
}

interface ResponseData {
    channel: string;
    sender: string;
    message: string;
    originalMessage: string;
    timestamp: number;
    messageId: string;
}

// Track pending messages (waiting for response)
const pendingMessages = new Map<string, PendingMessage>();

// Logger
function log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(LOG_FILE, logMessage);
}

// Split long messages for Discord's 2000 char limit
function splitMessage(text: string, maxLength = 2000): string[] {
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

// Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [
        Partials.Channel,
        Partials.Message,
    ],
});

// Client ready
client.on(Events.ClientReady, (readyClient) => {
    log('INFO', `Discord bot connected as ${readyClient.user.tag}`);
    log('INFO', 'Listening for DMs...');
});

// Message received - Write to queue
client.on(Events.MessageCreate, async (message: Message) => {
    try {
        // Skip bot messages
        if (message.author.bot) {
            return;
        }

        // Skip non-DM messages (guild = server channel)
        if (message.guild) {
            return;
        }

        // Skip empty messages
        if (!message.content || message.content.trim().length === 0) {
            return;
        }

        const sender = message.author.displayName || message.author.username;

        log('INFO', `Message from ${sender}: ${message.content.substring(0, 50)}...`);

        // Check for reset command
        if (message.content.trim().match(/^[!/]reset$/i)) {
            log('INFO', 'Reset command received');

            // Create reset flag
            const resetFlagPath = path.join(SCRIPT_DIR, '.tinyclaw/reset_flag');
            fs.writeFileSync(resetFlagPath, 'reset');

            // Reply immediately
            await message.reply('Conversation reset! Next message will start a fresh conversation.');
            return;
        }

        // Show typing indicator
        await (message.channel as DMChannel).sendTyping();

        // Generate unique message ID
        const messageId = `${Date.now()}_${Math.random().toString(36).substring(7)}`;

        // Write to incoming queue
        const queueData: QueueData = {
            channel: 'discord',
            sender: sender,
            senderId: message.author.id,
            message: message.content,
            timestamp: Date.now(),
            messageId: messageId,
        };

        const queueFile = path.join(QUEUE_INCOMING, `discord_${messageId}.json`);
        fs.writeFileSync(queueFile, JSON.stringify(queueData, null, 2));

        log('INFO', `Queued message ${messageId}`);

        // Store pending message for response
        pendingMessages.set(messageId, {
            message: message,
            channel: message.channel as DMChannel,
            timestamp: Date.now(),
        });

        // Clean up old pending messages (older than 5 minutes)
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        for (const [id, data] of pendingMessages.entries()) {
            if (data.timestamp < fiveMinutesAgo) {
                pendingMessages.delete(id);
            }
        }

    } catch (error) {
        log('ERROR', `Message handling error: ${(error as Error).message}`);
    }
});

// Watch for responses in outgoing queue
function checkOutgoingQueue(): void {
    try {
        const files = fs.readdirSync(QUEUE_OUTGOING)
            .filter(f => f.startsWith('discord_') && f.endsWith('.json'));

        for (const file of files) {
            const filePath = path.join(QUEUE_OUTGOING, file);

            try {
                const responseData: ResponseData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                const { messageId, message: responseText, sender } = responseData;

                // Find pending message
                const pending = pendingMessages.get(messageId);
                if (pending) {
                    // Split message if needed (Discord 2000 char limit)
                    const chunks = splitMessage(responseText);

                    // First chunk as reply, rest as follow-up messages
                    pending.message.reply(chunks[0]);
                    for (let i = 1; i < chunks.length; i++) {
                        pending.channel.send(chunks[i]);
                    }

                    log('INFO', `Sent response to ${sender} (${responseText.length} chars, ${chunks.length} message(s))`);

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
    }
}

// Check outgoing queue every second
setInterval(checkOutgoingQueue, 1000);

// Refresh typing indicator every 8 seconds (Discord typing expires after ~10s)
setInterval(() => {
    for (const [, data] of pendingMessages.entries()) {
        data.channel.sendTyping().catch(() => {
            // Ignore typing errors silently
        });
    }
}, 8000);

// Graceful shutdown
process.on('SIGINT', () => {
    log('INFO', 'Shutting down Discord client...');
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('INFO', 'Shutting down Discord client...');
    client.destroy();
    process.exit(0);
});

// Start client
log('INFO', 'Starting Discord client...');
client.login(DISCORD_BOT_TOKEN);
