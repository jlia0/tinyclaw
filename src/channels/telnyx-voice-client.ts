#!/usr/bin/env node
/**
 * Telnyx Voice Client for TinyClaw
 * Enables voice calling capabilities via Telnyx/ClawdTalk
 * 
 * This channel allows AI agents to make and receive phone calls.
 * It integrates with ClawdTalk (https://clawdtalk.com) for voice AI capabilities.
 * 
 * Setup:
 *   1. Create a Telnyx account at https://telnyx.com
 *   2. Create a Telnyx API key at https://portal.telnyx.com/#/app/api-keys
 *   3. Configure a voice profile and phone number
 *   4. Set TELNYX_API_KEY in environment or .env file
 */

import Telnyx from 'telnyx';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';

const SCRIPT_DIR = path.resolve(__dirname, '..', '..');
const _localTinyclaw = path.join(SCRIPT_DIR, '.tinyclaw');
const TINYCLAW_HOME = fs.existsSync(path.join(_localTinyclaw, 'settings.json'))
    ? _localTinyclaw
    : path.join(require('os').homedir(), '.tinyclaw');
const QUEUE_INCOMING = path.join(TINYCLAW_HOME, 'queue/incoming');
const QUEUE_OUTGOING = path.join(TINYCLAW_HOME, 'queue/outgoing');
const LOG_FILE = path.join(TINYCLAW_HOME, 'logs/voice.log');
const SETTINGS_FILE = path.join(TINYCLAW_HOME, 'settings.json');
const FILES_DIR = path.join(TINYCLAW_HOME, 'files');

// Ensure directories exist
[QUEUE_INCOMING, QUEUE_OUTGOING, path.dirname(LOG_FILE), FILES_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Configuration
const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_PUBLIC_KEY = process.env.TELNYX_PUBLIC_KEY;
const TELNYX_CONNECTION_ID = process.env.TELNYX_CONNECTION_ID;
const TELNYX_PHONE_NUMBER = process.env.TELNYX_PHONE_NUMBER;
const WEBHOOK_PORT = parseInt(process.env.TELNYX_WEBHOOK_PORT || '8080');
const WEBHOOK_PATH = process.env.TELNYX_WEBHOOK_PATH || '/telnyx-webhook';

// Validate configuration
if (!TELNYX_API_KEY || TELNYX_API_KEY === 'your_api_key_here') {
    console.error('ERROR: TELNYX_API_KEY is not set in .env file');
    console.error('Get your API key from https://portal.telnyx.com/#/app/api-keys');
    process.exit(1);
}

// Initialize Telnyx client
const telnyx = new Telnyx({ apiKey: TELNYX_API_KEY });

interface PendingCall {
    callControlId: string;
    callerNumber: string;
    callerName: string;
    timestamp: number;
    status: 'ringing' | 'answered' | 'ended';
    audioBuffer: Buffer[];
}

interface QueueData {
    channel: string;
    sender: string;
    senderId: string;
    message: string;
    timestamp: number;
    messageId: string;
    files?: string[];
    metadata?: {
        callControlId?: string;
        callType?: 'inbound' | 'outbound';
        duration?: number;
    };
}

interface ResponseData {
    channel: string;
    sender: string;
    message: string;
    originalMessage: string;
    timestamp: number;
    messageId: string;
    files?: string[];
    metadata?: {
        speak?: string;
        hangup?: boolean;
        gather?: boolean;
    };
}

// Track active calls
const activeCalls = new Map<string, PendingCall>();
let processingOutgoingQueue = false;

// Logger
function log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(LOG_FILE, logMessage);
}

// Load teams from settings
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

// Load agents from settings
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
        }
        text += '\n\nUsage: Start your message with @agent_id to route to a specific agent.';
        return text;
    } catch {
        return 'Could not load agent configuration.';
    }
}

/**
 * Make an outbound call
 */
async function makeOutboundCall(to: string, message: string): Promise<string> {
    try {
        if (!TELNYX_CONNECTION_ID || !TELNYX_PHONE_NUMBER) {
            throw new Error('TELNYX_CONNECTION_ID and TELNYX_PHONE_NUMBER must be configured');
        }

        log('INFO', `Making outbound call to ${to}`);

        const call = await telnyx.calls.dial({
            connection_id: TELNYX_CONNECTION_ID,
            to: to,
            from: TELNYX_PHONE_NUMBER,
        });

        const callControlId = call.data.call_control_id;
        
        // Store call info
        const messageId = `voice_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        activeCalls.set(callControlId, {
            callControlId,
            callerNumber: to,
            callerName: 'Outbound',
            timestamp: Date.now(),
            status: 'ringing',
            audioBuffer: [],
        });

        log('INFO', `Call initiated: ${callControlId}`);

        // Queue message for agent to handle
        const queueData: QueueData = {
            channel: 'voice',
            sender: to,
            senderId: to,
            message: `[Outbound call initiated to ${to}]: ${message}`,
            timestamp: Date.now(),
            messageId,
            metadata: {
                callControlId,
                callType: 'outbound',
            },
        };

        const queueFile = path.join(QUEUE_INCOMING, `voice_${messageId}.json`);
        fs.writeFileSync(queueFile, JSON.stringify(queueData, null, 2));

        return callControlId;
    } catch (error) {
        log('ERROR', `Failed to make outbound call: ${(error as Error).message}`);
        throw error;
    }
}

/**
 * Speak text on an active call
 */
async function speakOnCall(callControlId: string, text: string): Promise<void> {
    try {
        await telnyx.calls.speak({
            call_control_id: callControlId,
            payload: text,
            voice: 'female',
            language: 'en-US',
        });
        log('INFO', `Speaking on call ${callControlId}: "${text.substring(0, 50)}..."`);
    } catch (error) {
        log('ERROR', `Failed to speak on call: ${(error as Error).message}`);
        throw error;
    }
}

/**
 * Hang up a call
 */
async function hangupCall(callControlId: string): Promise<void> {
    try {
        await telnyx.calls.hangup({
            call_control_id: callControlId,
        });
        log('INFO', `Hung up call ${callControlId}`);
        activeCalls.delete(callControlId);
    } catch (error) {
        log('ERROR', `Failed to hang up call: ${(error as Error).message}`);
    }
}

/**
 * Gather DTMF input from caller
 */
async function gatherInput(callControlId: string): Promise<void> {
    try {
        await telnyx.calls.gather({
            call_control_id: callControlId,
            inter_digit_timeout_millis: 5000,
            max_digits: 20,
            timeout_millis: 30000,
        });
        log('INFO', `Gathering input on call ${callControlId}`);
    } catch (error) {
        log('ERROR', `Failed to gather input: ${(error as Error).message}`);
    }
}

/**
 * Verify Telnyx webhook signature
 */
function verifyWebhookSignature(payload: string, signature: string, timestamp: string): boolean {
    if (!TELNYX_PUBLIC_KEY) {
        log('WARN', 'TELNYX_PUBLIC_KEY not set, skipping signature verification');
        return true;
    }

    try {
        const payloadToSign = timestamp + '|' + payload;
        const expectedSignature = crypto
            .createHmac('sha256', TELNYX_PUBLIC_KEY)
            .update(payloadToSign)
            .digest('hex');
        
        return signature === expectedSignature;
    } catch (error) {
        log('ERROR', `Signature verification failed: ${(error as Error).message}`);
        return false;
    }
}

/**
 * Handle incoming webhook from Telnyx
 */
async function handleWebhook(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body = '';
    
    req.on('data', chunk => {
        body += chunk.toString();
    });

    req.on('end', async () => {
        try {
            const signature = req.headers['telnyx-signature-ed25519'] as string;
            const timestamp = req.headers['telnyx-timestamp'] as string;

            // Verify signature if public key is set
            if (TELNYX_PUBLIC_KEY && !verifyWebhookSignature(body, signature, timestamp)) {
                log('WARN', 'Invalid webhook signature, rejecting');
                res.writeHead(401);
                res.end('Unauthorized');
                return;
            }

            const event = JSON.parse(body);
            const eventType = event.data.event_type;
            const payload = event.data.payload;

            log('INFO', `Received webhook event: ${eventType}`);

            // Handle different call events
            switch (eventType) {
                case 'call.initiated': {
                    // Incoming call ringing
                    const callControlId = payload.call_control_id;
                    const callerNumber = payload.from;
                    const callerName = payload.caller_name || callerNumber;

                    log('INFO', `Incoming call from ${callerNumber}`);

                    activeCalls.set(callControlId, {
                        callControlId,
                        callerNumber,
                        callerName,
                        timestamp: Date.now(),
                        status: 'ringing',
                        audioBuffer: [],
                    });

                    // Auto-answer the call
                    try {
                        await telnyx.calls.answer({
                            call_control_id: callControlId,
                        });
                        log('INFO', `Answered incoming call ${callControlId}`);
                    } catch (answerError) {
                        log('ERROR', `Failed to answer call: ${(answerError as Error).message}`);
                    }
                    break;
                }

                case 'call.answered': {
                    const callControlId = payload.call_control_id;
                    const call = activeCalls.get(callControlId);
                    
                    if (call) {
                        call.status = 'answered';
                        log('INFO', `Call ${callControlId} answered`);

                        // Queue message for agent
                        const messageId = `voice_${Date.now()}_${Math.random().toString(36).substring(7)}`;
                        const queueData: QueueData = {
                            channel: 'voice',
                            sender: call.callerNumber,
                            senderId: call.callerNumber,
                            message: `[Incoming call from ${call.callerName} (${call.callerNumber})]: Caller is connected`,
                            timestamp: Date.now(),
                            messageId,
                            metadata: {
                                callControlId,
                                callType: 'inbound',
                            },
                        };

                        const queueFile = path.join(QUEUE_INCOMING, `voice_${messageId}.json`);
                        fs.writeFileSync(queueFile, JSON.stringify(queueData, null, 2));
                        log('INFO', `Queued incoming call message ${messageId}`);

                        // Store mapping for response handling
                        pendingMessages.set(messageId, {
                            callControlId,
                            callerNumber: call.callerNumber,
                            timestamp: Date.now(),
                        });

                        // Greet the caller
                        await speakOnCall(callControlId, 'Hello! I\'m your AI assistant. How can I help you today?');
                        await gatherInput(callControlId);
                    }
                    break;
                }

                case 'call.hangup': {
                    const callControlId = payload.call_control_id;
                    const call = activeCalls.get(callControlId);
                    
                    if (call) {
                        call.status = 'ended';
                        const duration = Math.floor((Date.now() - call.timestamp) / 1000);
                        log('INFO', `Call ${callControlId} ended. Duration: ${duration}s`);
                        activeCalls.delete(callControlId);
                    }
                    break;
                }

                case 'call.speak.ended': {
                    // Speech finished, ready for next action
                    const callControlId = payload.call_control_id;
                    log('INFO', `Speech ended on call ${callControlId}`);
                    break;
                }

                case 'call.gather.ended': {
                    // DTMF input received
                    const callControlId = payload.call_control_id;
                    const digits = payload.digits;
                    
                    log('INFO', `Gathered input on call ${callControlId}: ${digits}`);

                    // Queue the input for agent
                    const messageId = `voice_${Date.now()}_${Math.random().toString(36).substring(7)}`;
                    const queueData: QueueData = {
                        channel: 'voice',
                        sender: activeCalls.get(callControlId)?.callerNumber || 'unknown',
                        senderId: activeCalls.get(callControlId)?.callerNumber || 'unknown',
                        message: `[Voice input]: ${digits}`,
                        timestamp: Date.now(),
                        messageId,
                        metadata: {
                            callControlId,
                            callType: 'inbound',
                        },
                    };

                    const queueFile = path.join(QUEUE_INCOMING, `voice_${messageId}.json`);
                    fs.writeFileSync(queueFile, JSON.stringify(queueData, null, 2));

                    // Continue gathering
                    const call = activeCalls.get(callControlId);
                    if (call && call.status === 'answered') {
                        await gatherInput(callControlId);
                    }
                    break;
                }

                case 'call.dtmf.received': {
                    // Real-time DTMF
                    const callControlId = payload.call_control_id;
                    const digit = payload.digit;
                    log('INFO', `DTMF received on call ${callControlId}: ${digit}`);
                    break;
                }

                case 'call.recording.saved': {
                    // Recording available
                    const recordingUrl = payload.recording_urls?.[0];
                    if (recordingUrl) {
                        log('INFO', `Recording saved: ${recordingUrl}`);
                    }
                    break;
                }

                default:
                    log('DEBUG', `Unhandled event type: ${eventType}`);
            }

            res.writeHead(200);
            res.end('OK');
        } catch (error) {
            log('ERROR', `Webhook handling error: ${(error as Error).message}`);
            res.writeHead(500);
            res.end('Error');
        }
    });
}

interface PendingMessage {
    callControlId: string;
    callerNumber: string;
    timestamp: number;
}

const pendingMessages = new Map<string, PendingMessage>();

/**
 * Check outgoing queue for responses to send
 */
async function checkOutgoingQueue(): Promise<void> {
    if (processingOutgoingQueue) {
        return;
    }

    processingOutgoingQueue = true;

    try {
        const files = fs.readdirSync(QUEUE_OUTGOING)
            .filter(f => f.startsWith('voice_') && f.endsWith('.json'));

        for (const file of files) {
            const filePath = path.join(QUEUE_OUTGOING, file);

            try {
                const responseData: ResponseData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                const { messageId, message, metadata } = responseData;

                const pending = pendingMessages.get(messageId);
                if (pending) {
                    // Handle voice response
                    if (metadata?.speak) {
                        await speakOnCall(pending.callControlId, metadata.speak);
                    } else if (message) {
                        // Default: speak the message
                        await speakOnCall(pending.callControlId, message);
                    }

                    if (metadata?.hangup) {
                        await hangupCall(pending.callControlId);
                    }

                    log('INFO', `Sent voice response for ${messageId}`);
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
    } finally {
        processingOutgoingQueue = false;
    }
}

// Create HTTP server for webhooks
const server = http.createServer((req, res) => {
    if (req.url === WEBHOOK_PATH && req.method === 'POST') {
        handleWebhook(req, res);
    } else if (req.url === '/health') {
        res.writeHead(200);
        res.end('OK');
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// Start server
server.listen(WEBHOOK_PORT, () => {
    log('INFO', `Telnyx webhook server listening on port ${WEBHOOK_PORT}`);
    log('INFO', `Webhook URL: http://your-server:${WEBHOOK_PORT}${WEBHOOK_PATH}`);
});

// Check outgoing queue periodically
setInterval(checkOutgoingQueue, 1000);

// Graceful shutdown
process.on('SIGINT', () => {
    log('INFO', 'Shutting down Telnyx voice client...');
    server.close();
    
    // Hang up all active calls
    for (const [callControlId] of activeCalls) {
        hangupCall(callControlId).catch(() => {});
    }
    
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('INFO', 'Shutting down Telnyx voice client...');
    server.close();
    process.exit(0);
});

// Export for programmatic use
export {
    makeOutboundCall,
    speakOnCall,
    hangupCall,
    gatherInput,
    activeCalls,
};

// CLI interface for making outbound calls
if (process.argv[2] === 'call' && process.argv[3]) {
    const to = process.argv[3];
    const message = process.argv[4] || 'Hello, this is your AI assistant calling.';
    
    makeOutboundCall(to, message)
        .then(callControlId => {
            console.log(`Call initiated: ${callControlId}`);
        })
        .catch(error => {
            console.error('Failed to make call:', error.message);
            process.exit(1);
        });
}

log('INFO', 'Telnyx voice client started');
log('INFO', `API Key configured: ${TELNYX_API_KEY ? 'Yes' : 'No'}`);
log('INFO', `Phone number: ${TELNYX_PHONE_NUMBER || 'Not configured'}`);
log('INFO', `Connection ID: ${TELNYX_CONNECTION_ID || 'Not configured'}`);
log('INFO', '');
log('INFO', 'To make an outbound call:');
log('INFO', '  node dist/channels/telnyx-voice-client.js call +1234567890 "Hello, this is a test call"');
log('INFO', '');
log('INFO', 'Configure webhook URL in Telnyx portal to receive inbound calls');
