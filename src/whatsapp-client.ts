import { Client, LocalAuth, Message, Chat } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import { QueueMessage, ResponseMessage, LogLevel } from './types';

const SCRIPT_DIR = path.resolve(__dirname, '..');
const QUEUE_INCOMING = path.join(SCRIPT_DIR, '.tinyclaw/queue/incoming');
const QUEUE_OUTGOING = path.join(SCRIPT_DIR, '.tinyclaw/queue/outgoing');
const LOG_FILE = path.join(SCRIPT_DIR, '.tinyclaw/logs/whatsapp.log');
const SESSION_DIR = path.join(SCRIPT_DIR, '.tinyclaw/whatsapp-session');

// Ensure directories exist
[QUEUE_INCOMING, QUEUE_OUTGOING, path.dirname(LOG_FILE), SESSION_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

interface PendingMessage {
    message: Message;
    chat: Chat;
    timestamp: number;
}

const pendingMessages = new Map<string, PendingMessage>();

function log(level: LogLevel, message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(LOG_FILE, logMessage);
}

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: SESSION_DIR,
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
            '--disable-gpu',
        ],
    },
});

client.on('qr', (qr: string) => {
    log('INFO', 'Scan this QR code with WhatsApp:');
    console.log('\n');
    qrcode.generate(qr, { small: true });
    console.log('\n');
    log('INFO', 'Open WhatsApp → Settings → Linked Devices → Link a Device');
});

client.on('authenticated', () => {
    log('INFO', 'WhatsApp authenticated successfully!');
});

client.on('ready', () => {
    log('INFO', '✓ WhatsApp client connected and ready!');
    log('INFO', 'Listening for messages...');
});

client.on('message_create', async (message: Message) => {
    try {
        if (message.fromMe) return;
        if (message.type !== 'chat') return;
        if (!message.body || message.body.trim().length === 0) return;

        const chat = await message.getChat();
        const contact = await message.getContact();
        const sender = contact.pushname || contact.name || message.from;

        if (chat.isGroup) return;

        log('INFO', `📱 Message from ${sender}: ${message.body.substring(0, 50)}...`);

        // Check for reset command
        if (/^[!/]reset$/i.test(message.body.trim())) {
            log('INFO', '🔄 Reset command received');
            const resetFlagPath = path.join(SCRIPT_DIR, '.tinyclaw/reset_flag');
            fs.writeFileSync(resetFlagPath, 'reset');
            await message.reply('✅ Conversation reset! Next message will start a fresh conversation.');
            return;
        }

        await chat.sendStateTyping();

        const messageId = `${Date.now()}_${Math.random().toString(36).substring(7)}`;

        const queueData: QueueMessage = {
            channel: 'whatsapp',
            sender,
            senderId: message.from,
            message: message.body,
            timestamp: Date.now(),
            messageId,
        };

        const queueFile = path.join(QUEUE_INCOMING, `whatsapp_${messageId}.json`);
        fs.writeFileSync(queueFile, JSON.stringify(queueData, null, 2));

        log('INFO', `✓ Queued message ${messageId}`);

        pendingMessages.set(messageId, {
            message,
            chat,
            timestamp: Date.now(),
        });

        // Clean up old pending messages (older than 5 minutes)
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        for (const [id, data] of pendingMessages.entries()) {
            if (data.timestamp < fiveMinutesAgo) {
                pendingMessages.delete(id);
            }
        }
    } catch (error) {
        log('ERROR', `Message handling error: ${(error as Error).message}`);
    }
});

function checkOutgoingQueue(): void {
    try {
        const files = fs.readdirSync(QUEUE_OUTGOING)
            .filter(f => f.startsWith('whatsapp_') && f.endsWith('.json'));

        for (const file of files) {
            const filePath = path.join(QUEUE_OUTGOING, file);

            try {
                const responseData: ResponseMessage = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                const { messageId, message: responseText, sender } = responseData;

                const pending = pendingMessages.get(messageId);
                if (pending) {
                    pending.message.reply(responseText);
                    log('INFO', `✓ Sent response to ${sender} (${responseText.length} chars)`);
                    pendingMessages.delete(messageId);
                    fs.unlinkSync(filePath);
                } else {
                    log('WARN', `No pending message for ${messageId}, cleaning up`);
                    fs.unlinkSync(filePath);
                }
            } catch (error) {
                log('ERROR', `Error processing response file ${file}: ${(error as Error).message}`);
            }
        }
    } catch (error) {
        log('ERROR', `Outgoing queue error: ${(error as Error).message}`);
    }
}

setInterval(checkOutgoingQueue, 1000);

client.on('auth_failure', (msg: string) => {
    log('ERROR', `Authentication failure: ${msg}`);
    process.exit(1);
});

client.on('disconnected', (reason: string) => {
    log('WARN', `WhatsApp disconnected: ${reason}`);
});

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

log('INFO', 'Starting WhatsApp client...');
client.initialize();
