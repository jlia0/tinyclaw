#!/usr/bin/env node
/**
 * Microsoft Teams Client for TinyClaw
 * Receives bot messages via Bot Framework and writes them to queue.
 * Reads queue responses and sends them back proactively to Teams users.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';
import {
    ActivityHandler,
    CloudAdapter,
    ConversationReference,
    TurnContext,
} from 'botbuilder';
import { ensureSenderPaired } from '../lib/pairing';

const SCRIPT_DIR = path.resolve(__dirname, '..', '..');
const _localTinyclaw = path.join(SCRIPT_DIR, '.tinyclaw');
const TINYCLAW_HOME = fs.existsSync(path.join(_localTinyclaw, 'settings.json'))
    ? _localTinyclaw
    : path.join(require('os').homedir(), '.tinyclaw');
const QUEUE_INCOMING = path.join(TINYCLAW_HOME, 'queue/incoming');
const QUEUE_OUTGOING = path.join(TINYCLAW_HOME, 'queue/outgoing');
const LOG_FILE = path.join(TINYCLAW_HOME, 'logs/msteams.log');
const SETTINGS_FILE = path.join(TINYCLAW_HOME, 'settings.json');
const PAIRING_FILE = path.join(TINYCLAW_HOME, 'pairing.json');

[QUEUE_INCOMING, QUEUE_OUTGOING, path.dirname(LOG_FILE)].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

interface PendingMessage {
    reference: Partial<ConversationReference>;
    sender: string;
    originalMessage: string;
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

function log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(LOG_FILE, logMessage);
}

function getTeamsConfig(): { appId: string; appPassword: string; port: number } {
    const envAppId = process.env.MSTEAMS_APP_ID || process.env.MICROSOFT_APP_ID || '';
    const envAppPassword = process.env.MSTEAMS_APP_PASSWORD || process.env.MICROSOFT_APP_PASSWORD || '';
    const envPort = parseInt(process.env.MSTEAMS_PORT || process.env.PORT || '3978', 10);

    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const settingsRaw = fs.readFileSync(SETTINGS_FILE, 'utf8');
            const settings = JSON.parse(settingsRaw) as {
                channels?: {
                    teams?: {
                        app_id?: string;
                        app_password?: string;
                        port?: number;
                    };
                };
            };
            const cfg = settings.channels?.teams;
            return {
                appId: envAppId || cfg?.app_id || '',
                appPassword: envAppPassword || cfg?.app_password || '',
                port: Number.isFinite(envPort) ? envPort : (cfg?.port || 3978),
            };
        }
    } catch (error) {
        log('WARN', `Failed to parse settings.json for Teams config: ${(error as Error).message}`);
    }

    return {
        appId: envAppId,
        appPassword: envAppPassword,
        port: Number.isFinite(envPort) ? envPort : 3978,
    };
}

function splitMessage(text: string, maxLength = 3500): string[] {
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

        let splitIndex = remaining.lastIndexOf('\n', maxLength);
        if (splitIndex <= 0) {
            splitIndex = remaining.lastIndexOf(' ', maxLength);
        }
        if (splitIndex <= 0) {
            splitIndex = maxLength;
        }

        chunks.push(remaining.substring(0, splitIndex));
        remaining = remaining.substring(splitIndex).replace(/^\n/, '');
    }

    return chunks;
}

function getTeamListText(): string {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const settings = JSON.parse(settingsData) as { teams?: Record<string, { name: string; agents: string[]; leader_agent: string }> };
        const teams = settings.teams;
        if (!teams || Object.keys(teams).length === 0) {
            return 'No teams configured.\n\nCreate a team with: tinyclaw team add';
        }
        let text = 'Available Teams:\n';
        for (const [id, team] of Object.entries(teams)) {
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

function getAgentListText(): string {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const settings = JSON.parse(settingsData) as {
            agents?: Record<string, { name: string; provider: string; model: string; working_directory: string; system_prompt?: string; prompt_file?: string }>;
        };
        const agents = settings.agents;
        if (!agents || Object.keys(agents).length === 0) {
            return 'No agents configured. Using default single-agent mode.\n\nConfigure agents in .tinyclaw/settings.json or run: tinyclaw agent add';
        }
        let text = 'Available Agents:\n';
        for (const [id, agent] of Object.entries(agents)) {
            text += `\n@${id} - ${agent.name}`;
            text += `\n  Provider: ${agent.provider}/${agent.model}`;
            text += `\n  Directory: ${agent.working_directory}`;
            if (agent.system_prompt) text += '\n  Has custom system prompt';
            if (agent.prompt_file) text += `\n  Prompt file: ${agent.prompt_file}`;
        }
        text += '\n\nUsage: Start your message with @agent_id to route to a specific agent.';
        return text;
    } catch {
        return 'Could not load agent configuration.';
    }
}

function pairingMessage(code: string): string {
    return [
        'This sender is not paired yet.',
        `Your pairing code: ${code}`,
        'Ask the TinyClaw owner to approve you with:',
        `tinyclaw pairing approve ${code}`,
    ].join('\n');
}

function cleanTeamsText(raw: string): string {
    return raw
        .replace(/<at>.*?<\/at>/gi, '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

const teamsConfig = getTeamsConfig();
if (!teamsConfig.appId || !teamsConfig.appPassword) {
    console.error('ERROR: Microsoft Teams app credentials are missing.');
    console.error('Set channels.teams.app_id and channels.teams.app_password via tinyclaw setup.');
    process.exit(1);
}

// CloudAdapter reads MicrosoftAppId/MicrosoftAppPassword from process.env via
// the default BotFrameworkAuthenticationFactory. Set them from our resolved config
// so credentials from settings.json or MSTEAMS_* env vars are picked up.
process.env.MicrosoftAppId = teamsConfig.appId;
process.env.MicrosoftAppPassword = teamsConfig.appPassword;
const adapter = new CloudAdapter();

adapter.onTurnError = async (_context, error) => {
    log('ERROR', `Bot adapter error: ${error.message}`);
};

const pendingMessages = new Map<string, PendingMessage>();
let processingOutgoingQueue = false;

class TeamsQueueBot extends ActivityHandler {
    constructor() {
        super();

        this.onMessage(async (context, next) => {
            try {
                const activity = context.activity;
                const conversationType = activity.conversation?.conversationType;

                // Only process direct user chats (personal scope).
                // Ignore team/channel/group contexts to avoid accidental channel posting.
                if (conversationType && conversationType !== 'personal') {
                    log('INFO', `Ignoring non-personal Teams conversation type: ${conversationType}`);
                    return;
                }

                const senderId = activity.from?.aadObjectId || activity.from?.id || 'unknown';
                const senderName = activity.from?.name || senderId;
                const text = cleanTeamsText(activity.text || '');
                const hasAttachments = Array.isArray(activity.attachments) && activity.attachments.length > 0;

                if (!text && !hasAttachments) {
                    return;
                }

                const pairing = ensureSenderPaired(PAIRING_FILE, 'msteams', senderId, senderName);
                if (!pairing.approved && pairing.code) {
                    if (pairing.isNewPending) {
                        log('INFO', `Blocked unpaired Teams sender ${senderName} (${senderId}) with code ${pairing.code}`);
                        await context.sendActivity(pairingMessage(pairing.code));
                    } else {
                        log('INFO', `Blocked pending Teams sender ${senderName} (${senderId}) without re-sending pairing message`);
                    }
                    return;
                }

                if (text.match(/^[!/]agent$/i)) {
                    await context.sendActivity(getAgentListText());
                    return;
                }

                if (text.match(/^[!/]team$/i)) {
                    await context.sendActivity(getTeamListText());
                    return;
                }

                const messageId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
                let messageText = text;

                if (hasAttachments) {
                    const attachmentLabels = activity.attachments!.map((att, idx) => {
                        const name = att.name || `attachment_${idx + 1}`;
                        return `[Attachment: ${name}]`;
                    });
                    messageText = [messageText, ...attachmentLabels].filter(Boolean).join('\n');
                }

                const queueData: QueueData = {
                    channel: 'msteams',
                    sender: senderName,
                    senderId,
                    message: messageText,
                    timestamp: Date.now(),
                    messageId,
                };

                const queueFile = path.join(QUEUE_INCOMING, `msteams_${messageId}.json`);
                fs.writeFileSync(queueFile, JSON.stringify(queueData, null, 2));

                const reference = TurnContext.getConversationReference(activity);
                pendingMessages.set(messageId, {
                    reference,
                    sender: senderName,
                    originalMessage: messageText,
                    timestamp: Date.now(),
                });

                log('INFO', `Message from Teams ${senderName}: ${messageText.substring(0, 80)}...`);
            } catch (error) {
                log('ERROR', `Failed to process Teams message: ${(error as Error).message}`);
            } finally {
                // Always continue middleware pipeline even when we return early.
                await next();
            }
        });
    }
}

const bot = new TeamsQueueBot();
const app = express();
app.use(express.json());

app.post('/api/messages', async (req, res) => {
    await adapter.process(req, res, async (context) => {
        await bot.run(context);
    });
});

app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', channel: 'msteams' });
});

async function processOutgoingQueue(): Promise<void> {
    if (processingOutgoingQueue) {
        return;
    }

    processingOutgoingQueue = true;
    try {
        const files = fs.readdirSync(QUEUE_OUTGOING)
            .filter(file => file.startsWith('msteams_') && file.endsWith('.json'))
            .sort();

        for (const fileName of files) {
            const filePath = path.join(QUEUE_OUTGOING, fileName);
            try {
                const data: ResponseData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                const pending = pendingMessages.get(data.messageId);
                if (!pending) {
                    log('WARN', `No pending Teams message found for response ${data.messageId}`);
                    fs.unlinkSync(filePath);
                    continue;
                }

                await adapter.continueConversationAsync(teamsConfig.appId, pending.reference, async (context) => {
                    const chunks = splitMessage(data.message);
                    for (const chunk of chunks) {
                        await context.sendActivity(chunk);
                    }

                    if (data.files && data.files.length > 0) {
                        await context.sendActivity(
                            `Files generated by TinyClaw:\n${data.files.map(f => `- ${f}`).join('\n')}`
                        );
                    }
                });

                pendingMessages.delete(data.messageId);
                fs.unlinkSync(filePath);
                log('INFO', `Sent Teams response to ${pending.sender}`);
            } catch (error) {
                log('ERROR', `Failed processing Teams outgoing ${fileName}: ${(error as Error).message}`);
            }
        }

        const staleThresholdMs = 30 * 60 * 1000;
        const now = Date.now();
        for (const [id, pending] of pendingMessages.entries()) {
            if (now - pending.timestamp > staleThresholdMs) {
                pendingMessages.delete(id);
                log('INFO', `Removed stale Teams pending message ${id}`);
            }
        }
    } finally {
        processingOutgoingQueue = false;
    }
}

setInterval(() => {
    processOutgoingQueue().catch(err => {
        log('ERROR', `Teams outgoing queue loop error: ${(err as Error).message}`);
    });
}, 1000);

app.listen(teamsConfig.port, () => {
    log('INFO', `Microsoft Teams client listening on port ${teamsConfig.port}`);
    log('INFO', 'Bot endpoint: POST /api/messages');
});
