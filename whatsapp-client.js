#!/usr/bin/env node
/**
 * WhatsApp Client for TinyClaw Simple
 * Writes messages to queue and reads responses
 * Does NOT call Claude directly - that's handled by queue-processor
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// Load .env file
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const match = line.match(/^([^#=]+)=(.*)$/);
        if (match) process.env[match[1].trim()] = match[2].trim();
    });
}

const SCRIPT_DIR = __dirname;
const QUEUE_INCOMING = path.join(SCRIPT_DIR, '.tinyclaw/queue/incoming');
const QUEUE_OUTGOING = path.join(SCRIPT_DIR, '.tinyclaw/queue/outgoing');
const LOG_FILE = path.join(SCRIPT_DIR, '.tinyclaw/logs/whatsapp.log');
const SESSION_DIR = path.join(SCRIPT_DIR, '.tinyclaw/whatsapp-session');
const CONFIG_FILE = path.join(SCRIPT_DIR, '.tinyclaw/config.json');

// Load config with defaults
function loadConfig() {
    const defaults = {
        allowlistEnabled: true,
        rateLimitEnabled: true,
        rateLimit: { maxMessages: 10, windowMs: 60000 }
    };
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return { ...defaults, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
        }
    } catch (e) {
        log('WARN', `Failed to load config: ${e.message}`);
    }
    return defaults;
}

// Get allowed senders from environment variable
function getAllowedSenders() {
    const envValue = process.env.TINYCLAW_ALLOWED_SENDERS;
    if (!envValue) return [];
    return envValue.split(',').map(s => s.trim()).filter(Boolean);
}

// Rate limiting with Retry-After support
const rateLimits = new Map();

function checkRateLimit(senderId, config) {
    if (!config.rateLimitEnabled) return { limited: false };

    const now = Date.now();
    const limit = rateLimits.get(senderId);
    const { maxMessages, windowMs } = config.rateLimit;

    if (!limit || now - limit.windowStart > windowMs) {
        rateLimits.set(senderId, { count: 1, windowStart: now });
        return { limited: false };
    }

    limit.count++;
    if (limit.count > maxMessages) {
        const retryAfterMs = windowMs - (now - limit.windowStart);
        const retryAfterSec = Math.ceil(retryAfterMs / 1000);
        return { limited: true, retryAfterSec };
    }
    return { limited: false };
}

// Ensure directories exist
[QUEUE_INCOMING, QUEUE_OUTGOING, path.dirname(LOG_FILE), SESSION_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Track pending messages (waiting for response)
const pendingMessages = new Map(); // messageId -> {message, chat, timestamp}

// Logger
function log(level, message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(LOG_FILE, logMessage);
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
client.on('qr', (qr) => {
    log('INFO', 'Scan this QR code with WhatsApp:');
    console.log('\n');
    qrcode.generate(qr, { small: true });
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
});

// Message received - Write to queue
client.on('message_create', async (message) => {
    try {
        // Skip outgoing messages
        if (message.fromMe) {
            return;
        }

        // Skip non-chat messages
        if (message.type !== 'chat') {
            return;
        }

        // Skip empty messages
        if (!message.body || message.body.trim().length === 0) {
            return;
        }

        const chat = await message.getChat();
        const contact = await message.getContact();
        const sender = contact.pushname || contact.name || message.from;

        // Skip group messages
        if (chat.isGroup) {
            return;
        }

        // Security: Load config and check allowlist
        const config = loadConfig();
        const allowedSenders = getAllowedSenders();

        if (config.allowlistEnabled && allowedSenders.length > 0) {
            const phoneNumber = message.from.replace('@c.us', '');
            if (!allowedSenders.includes(phoneNumber)) {
                log('WARN', `🚫 Blocked message from non-allowlisted sender: ${phoneNumber}`);
                return;
            }
        }

        // Security: Rate limiting with helpful feedback
        const rateCheck = checkRateLimit(message.from, config);
        if (rateCheck.limited) {
            log('WARN', `🚫 Rate limited: ${sender} (retry in ${rateCheck.retryAfterSec}s)`);
            await message.reply(`⏳ Slow down! Please wait ${rateCheck.retryAfterSec} seconds before sending another message.`);
            return;
        }

        log('INFO', `📱 Message from ${sender}: ${message.body.substring(0, 50)}...`);

        // Check for reset command
        if (message.body.trim().match(/^[!/]reset$/i)) {
            log('INFO', '🔄 Reset command received');

            // Create reset flag
            const resetFlagPath = path.join(SCRIPT_DIR, '.tinyclaw/reset_flag');
            fs.writeFileSync(resetFlagPath, 'reset');

            // Reply immediately
            await message.reply('✅ Conversation reset! Next message will start a fresh conversation.');
            return;
        }

        // Show typing indicator
        await chat.sendStateTyping();

        // Generate unique message ID
        const messageId = `${Date.now()}_${Math.random().toString(36).substring(7)}`;

        // Write to incoming queue
        const queueData = {
            channel: 'whatsapp',
            sender: sender,
            senderId: message.from,
            message: message.body,
            timestamp: Date.now(),
            messageId: messageId
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

        // Clean up old pending messages (older than 5 minutes)
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        for (const [id, data] of pendingMessages.entries()) {
            if (data.timestamp < fiveMinutesAgo) {
                pendingMessages.delete(id);
            }
        }

    } catch (error) {
        log('ERROR', `Message handling error: ${error.message}`);
    }
});

// Watch for responses in outgoing queue
function checkOutgoingQueue() {
    try {
        const files = fs.readdirSync(QUEUE_OUTGOING)
            .filter(f => f.startsWith('whatsapp_') && f.endsWith('.json'));

        for (const file of files) {
            const filePath = path.join(QUEUE_OUTGOING, file);

            try {
                const responseData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                const { messageId, message: responseText, sender } = responseData;

                // Find pending message
                const pending = pendingMessages.get(messageId);
                if (pending) {
                    // Send response
                    pending.message.reply(responseText);
                    log('INFO', `✓ Sent response to ${sender} (${responseText.length} chars)`);

                    // Clean up
                    pendingMessages.delete(messageId);
                    fs.unlinkSync(filePath);
                } else {
                    // Message too old or already processed
                    log('WARN', `No pending message for ${messageId}, cleaning up`);
                    fs.unlinkSync(filePath);
                }
            } catch (error) {
                log('ERROR', `Error processing response file ${file}: ${error.message}`);
                // Don't delete file on error, might retry
            }
        }
    } catch (error) {
        log('ERROR', `Outgoing queue error: ${error.message}`);
    }
}

// Check outgoing queue every second
setInterval(checkOutgoingQueue, 1000);

// Error handlers
client.on('auth_failure', (msg) => {
    log('ERROR', `Authentication failure: ${msg}`);
    process.exit(1);
});

client.on('disconnected', (reason) => {
    log('WARN', `WhatsApp disconnected: ${reason}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    log('INFO', 'Shutting down WhatsApp client...');
    await client.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    log('INFO', 'Shutting down WhatsApp client...');
    await client.destroy();
    process.exit(0);
});

// Start client
log('INFO', 'Starting WhatsApp client...');
client.initialize();
