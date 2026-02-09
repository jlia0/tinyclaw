#!/usr/bin/env node
/**
 * Queue Processor - Handles messages from all channels (WhatsApp, Telegram, etc.)
 * Processes one message at a time to avoid race conditions
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const SCRIPT_DIR = path.resolve(__dirname, '..');
const QUEUE_INCOMING = path.join(SCRIPT_DIR, '.tinyclaw/queue/incoming');
const QUEUE_OUTGOING = path.join(SCRIPT_DIR, '.tinyclaw/queue/outgoing');
const QUEUE_PROCESSING = path.join(SCRIPT_DIR, '.tinyclaw/queue/processing');
const LOG_FILE = path.join(SCRIPT_DIR, '.tinyclaw/logs/queue.log');
const RESET_FLAG = path.join(SCRIPT_DIR, '.tinyclaw/reset_flag');
const MODEL_CONFIG = path.join(SCRIPT_DIR, '.tinyclaw/model');

// Model name mapping
const MODEL_IDS: Record<string, string> = {
    'sonnet': 'claude-sonnet-4-5-20250929',
    'opus': 'claude-opus-4-6',
};

function getModelFlag(): string {
    try {
        const model = fs.readFileSync(MODEL_CONFIG, 'utf8').trim();
        const modelId = MODEL_IDS[model];
        if (modelId) {
            return `--model ${modelId} `;
        }
    } catch {}
    return '';
}

// Ensure directories exist
[QUEUE_INCOMING, QUEUE_OUTGOING, QUEUE_PROCESSING, path.dirname(LOG_FILE)].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

interface MessageData {
    channel: string;
    sender: string;
    senderId?: string;
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

// Logger
function log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(LOG_FILE, logMessage);
}

// Process a single message
async function processMessage(messageFile: string): Promise<void> {
    const processingFile = path.join(QUEUE_PROCESSING, path.basename(messageFile));

    try {
        // Move to processing to mark as in-progress
        fs.renameSync(messageFile, processingFile);

        // Read message
        const messageData: MessageData = JSON.parse(fs.readFileSync(processingFile, 'utf8'));
        const { channel, sender, message, timestamp, messageId } = messageData;

        log('INFO', `Processing [${channel}] from ${sender}: ${message.substring(0, 50)}...`);

        // Check if we should reset conversation (start fresh without -c)
        const shouldReset = fs.existsSync(RESET_FLAG);
        const continueFlag = shouldReset ? '' : '-c ';

        if (shouldReset) {
            log('INFO', '🔄 Resetting conversation (starting fresh without -c)');
            fs.unlinkSync(RESET_FLAG);
        }

        // Call Claude
        let response: string;
        try {
            const modelFlag = getModelFlag();
            response = execSync(
              `cd "${SCRIPT_DIR}" && claude --dangerously-skip-permissions ${modelFlag}${continueFlag}-p "${message.replace(/"/g, '\\"')}"`,
              {
                encoding: "utf-8",
                timeout: 120000, // 2 minute timeout
                maxBuffer: 10 * 1024 * 1024, // 10MB buffer
              },
            );
        } catch (error) {
            log('ERROR', `Claude error: ${(error as Error).message}`);
            response = "Sorry, I encountered an error processing your request.";
        }

        // Clean response
        response = response.trim();

        // Limit response length
        if (response.length > 4000) {
            response = response.substring(0, 3900) + '\n\n[Response truncated...]';
        }

        // Write response to outgoing queue
        const responseData: ResponseData = {
            channel,
            sender,
            message: response,
            originalMessage: message,
            timestamp: Date.now(),
            messageId
        };

        // For heartbeat messages, write to a separate location (they handle their own responses)
        const responseFile = channel === 'heartbeat'
            ? path.join(QUEUE_OUTGOING, `${messageId}.json`)
            : path.join(QUEUE_OUTGOING, `${channel}_${messageId}_${Date.now()}.json`);

        fs.writeFileSync(responseFile, JSON.stringify(responseData, null, 2));

        log('INFO', `✓ Response ready [${channel}] ${sender} (${response.length} chars)`);

        // Clean up processing file
        fs.unlinkSync(processingFile);

    } catch (error) {
        log('ERROR', `Processing error: ${(error as Error).message}`);

        // Move back to incoming for retry
        if (fs.existsSync(processingFile)) {
            try {
                fs.renameSync(processingFile, messageFile);
            } catch (e) {
                log('ERROR', `Failed to move file back: ${(e as Error).message}`);
            }
        }
    }
}

interface QueueFile {
    name: string;
    path: string;
    time: number;
}

// Main processing loop
async function processQueue(): Promise<void> {
    try {
        // Get all files from incoming queue, sorted by timestamp
        const files: QueueFile[] = fs.readdirSync(QUEUE_INCOMING)
            .filter(f => f.endsWith('.json'))
            .map(f => ({
                name: f,
                path: path.join(QUEUE_INCOMING, f),
                time: fs.statSync(path.join(QUEUE_INCOMING, f)).mtimeMs
            }))
            .sort((a, b) => a.time - b.time);

        if (files.length > 0) {
            log('DEBUG', `Found ${files.length} message(s) in queue`);

            // Process one at a time
            for (const file of files) {
                await processMessage(file.path);
            }
        }
    } catch (error) {
        log('ERROR', `Queue processing error: ${(error as Error).message}`);
    }
}

// Main loop
log('INFO', 'Queue processor started');
log('INFO', `Watching: ${QUEUE_INCOMING}`);

// Process queue every 1 second
setInterval(processQueue, 1000);

// Graceful shutdown
process.on('SIGINT', () => {
    log('INFO', 'Shutting down queue processor...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('INFO', 'Shutting down queue processor...');
    process.exit(0);
});
