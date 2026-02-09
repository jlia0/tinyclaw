import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { QueueMessage, ResponseMessage, LogLevel } from './types';

const SCRIPT_DIR = path.resolve(__dirname, '..');
const QUEUE_INCOMING = path.join(SCRIPT_DIR, '.tinyclaw/queue/incoming');
const QUEUE_OUTGOING = path.join(SCRIPT_DIR, '.tinyclaw/queue/outgoing');
const QUEUE_PROCESSING = path.join(SCRIPT_DIR, '.tinyclaw/queue/processing');
const LOG_FILE = path.join(SCRIPT_DIR, '.tinyclaw/logs/queue.log');
const RESET_FLAG = path.join(SCRIPT_DIR, '.tinyclaw/reset_flag');

// Ensure directories exist
[QUEUE_INCOMING, QUEUE_OUTGOING, QUEUE_PROCESSING, path.dirname(LOG_FILE)].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

function log(level: LogLevel, message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(LOG_FILE, logMessage);
}

async function processMessage(messageFile: string): Promise<void> {
    const processingFile = path.join(QUEUE_PROCESSING, path.basename(messageFile));

    try {
        fs.renameSync(messageFile, processingFile);

        const messageData: QueueMessage = JSON.parse(fs.readFileSync(processingFile, 'utf8'));
        const { channel, sender, message, messageId } = messageData;

        log('INFO', `Processing [${channel}] from ${sender}: ${message.substring(0, 50)}...`);

        const shouldReset = fs.existsSync(RESET_FLAG);
        const continueFlag = shouldReset ? '' : '-c ';

        if (shouldReset) {
            log('INFO', '🔄 Resetting conversation (starting fresh without -c)');
            fs.unlinkSync(RESET_FLAG);
        }

        let response: string;
        try {
            response = execSync(
                `cd "${SCRIPT_DIR}" && claude --dangerously-skip-permissions ${continueFlag}-p "${message.replace(/"/g, '\\"')}"`,
                {
                    encoding: 'utf-8',
                    timeout: 120000,
                    maxBuffer: 10 * 1024 * 1024,
                },
            );
        } catch (error) {
            log('ERROR', `Claude error: ${(error as Error).message}`);
            response = 'Sorry, I encountered an error processing your request.';
        }

        response = response.trim();

        if (response.length > 4000) {
            response = response.substring(0, 3900) + '\n\n[Response truncated...]';
        }

        // Suppress silent heartbeat responses
        if (channel === 'heartbeat' && response.includes('HEARTBEAT_OK')) {
            log('INFO', 'Heartbeat: all clear, no action needed');
            fs.unlinkSync(processingFile);
            return;
        }

        const responseData: ResponseMessage = {
            channel,
            sender,
            message: response,
            originalMessage: message,
            timestamp: Date.now(),
            messageId,
        };

        const responseFile = channel === 'heartbeat'
            ? path.join(QUEUE_OUTGOING, `${messageId}.json`)
            : path.join(QUEUE_OUTGOING, `${channel}_${messageId}_${Date.now()}.json`);

        fs.writeFileSync(responseFile, JSON.stringify(responseData, null, 2));

        log('INFO', `✓ Response ready [${channel}] ${sender} (${response.length} chars)`);

        fs.unlinkSync(processingFile);

    } catch (error) {
        log('ERROR', `Processing error: ${(error as Error).message}`);

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

async function processQueue(): Promise<void> {
    try {
        const files: QueueFile[] = fs.readdirSync(QUEUE_INCOMING)
            .filter(f => f.endsWith('.json'))
            .map(f => ({
                name: f,
                path: path.join(QUEUE_INCOMING, f),
                time: fs.statSync(path.join(QUEUE_INCOMING, f)).mtimeMs,
            }))
            .sort((a, b) => a.time - b.time);

        if (files.length > 0) {
            log('DEBUG', `Found ${files.length} message(s) in queue`);

            for (const file of files) {
                await processMessage(file.path);
            }
        }
    } catch (error) {
        log('ERROR', `Queue processing error: ${(error as Error).message}`);
    }
}

log('INFO', 'Queue processor started');
log('INFO', `Watching: ${QUEUE_INCOMING}`);

setInterval(processQueue, 1000);

process.on('SIGINT', () => {
    log('INFO', 'Shutting down queue processor...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('INFO', 'Shutting down queue processor...');
    process.exit(0);
});
