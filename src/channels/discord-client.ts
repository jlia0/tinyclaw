#!/usr/bin/env node
/**
 * Discord Client for TinyClaw Simple
 * Writes DM messages to queue and reads responses
 * Does NOT call Claude directly - that's handled by queue-processor
 */

import { Client, Events, GatewayIntentBits, Partials, Message, DMChannel, AttachmentBuilder } from 'discord.js';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { ensureSenderPaired } from '../lib/pairing';
import { createLogger, excerptText, logError } from '../lib/logging';

const API_PORT = parseInt(process.env.TINYCLAW_API_PORT || '3777', 10);
const API_BASE = `http://localhost:${API_PORT}`;

const SCRIPT_DIR = path.resolve(__dirname, '..', '..');
const _localTinyclaw = path.join(SCRIPT_DIR, '.tinyclaw');
const TINYCLAW_HOME = process.env.TINYCLAW_HOME
    || (fs.existsSync(path.join(_localTinyclaw, 'settings.json'))
        ? _localTinyclaw
        : path.join(require('os').homedir(), '.tinyclaw'));
const SETTINGS_FILE = path.join(TINYCLAW_HOME, 'settings.json');
const FILES_DIR = path.join(TINYCLAW_HOME, 'files');
const PAIRING_FILE = path.join(TINYCLAW_HOME, 'pairing.json');
const logger = createLogger({ runtime: 'discord', source: 'discord', component: 'client' });

// Ensure directories exist
[FILES_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Validate bot token
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!DISCORD_BOT_TOKEN || DISCORD_BOT_TOKEN === 'your_token_here') {
    logger.error('DISCORD_BOT_TOKEN is not set in .env file');
    process.exit(1);
}

interface PendingMessage {
    message: Message;
    channel: DMChannel;
    timestamp: number;
}

function sanitizeFileName(fileName: string): string {
    const baseName = path.basename(fileName).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
    return baseName.length > 0 ? baseName : 'file.bin';
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
            fs.unlink(destPath, () => {});
            reject(err);
        });
    });
}

// Track pending messages (waiting for response)
const pendingMessages = new Map<string, PendingMessage>();
let processingOutgoingQueue = false;

// Load teams from settings for /team command
function getTeamListText(): string {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const settings = JSON.parse(settingsData);
        const teams = settings.teams;
        if (!teams || Object.keys(teams).length === 0) {
            return 'No teams configured.\n\nCreate a team with `tinyclaw team add`.';
        }
        let text = '**Available Teams:**\n';
        for (const [id, team] of Object.entries(teams) as [string, any][]) {
            text += `\n**@${id}** - ${team.name}`;
            text += `\n  Agents: ${team.agents.join(', ')}`;
            text += `\n  Leader: @${team.leader_agent}`;
        }
        text += '\n\nUsage: Start your message with `@team_id` to route to a team.';
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
            return 'No agents configured. Using default single-agent mode.\n\nConfigure agents in `.tinyclaw/settings.json` or run `tinyclaw agent add`.';
        }
        let text = '**Available Agents:**\n';
        for (const [id, agent] of Object.entries(agents) as [string, any][]) {
            text += `\n**@${id}** - ${agent.name}`;
            text += `\n  Provider: ${agent.provider}/${agent.model}`;
            text += `\n  Directory: ${agent.working_directory}`;
            if (agent.system_prompt) text += `\n  Has custom system prompt`;
            if (agent.prompt_file) text += `\n  Prompt file: ${agent.prompt_file}`;
        }
        text += '\n\nUsage: Start your message with `@agent_id` to route to a specific agent.';
        return text;
    } catch {
        return 'Could not load agent configuration.';
    }
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

function pairingMessage(code: string): string {
    return [
        'This sender is not paired yet.',
        `Your pairing code: ${code}`,
        'Ask the TinyClaw owner to approve you with:',
        `tinyclaw pairing approve ${code}`,
    ].join('\n');
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
    logger.info({ context: { userTag: readyClient.user.tag } }, 'Discord bot connected');
    logger.info('Listening for DMs');
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

        const hasAttachments = message.attachments.size > 0;
        const hasContent = message.content && message.content.trim().length > 0;

        // Skip messages with no content and no attachments
        if (!hasContent && !hasAttachments) {
            return;
        }

        const sender = message.author.username;

        // Generate unique message ID
        const messageId = `${Date.now()}_${Math.random().toString(36).substring(7)}`;

        // Download any attachments
        const downloadedFiles: string[] = [];
        if (hasAttachments) {
            for (const [, attachment] of message.attachments) {
                try {
                    const attachmentName = attachment.name || `discord_${messageId}_${Date.now()}.bin`;
                    const filename = `discord_${messageId}_${attachmentName}`;
                    const localPath = buildUniqueFilePath(FILES_DIR, filename);

                    await downloadFile(attachment.url, localPath);
                    downloadedFiles.push(localPath);
                    logger.info({ messageId, context: { file: path.basename(localPath), contentType: attachment.contentType || 'unknown' } }, 'Downloaded attachment');
                } catch (dlErr) {
                    logError(logger, dlErr, 'Failed to download attachment', { messageId, attachmentName: attachment.name || undefined });
                }
            }
        }

        let messageText = message.content || '';

        logger.info({
            channel: 'discord',
            sender,
            messageId,
            excerpt: excerptText(messageText || '[attachment only]'),
            context: { fileCount: downloadedFiles.length, senderId: message.author.id },
        }, 'Message received');

        const pairing = ensureSenderPaired(PAIRING_FILE, 'discord', message.author.id, sender);
        if (!pairing.approved && pairing.code) {
            if (pairing.isNewPending) {
                logger.info({ channel: 'discord', sender, context: { senderId: message.author.id, pairingCode: pairing.code } }, 'Blocked unpaired sender');
                await message.reply(pairingMessage(pairing.code));
            } else {
                logger.info({ channel: 'discord', sender, context: { senderId: message.author.id } }, 'Blocked pending sender without re-sending pairing message');
            }
            return;
        }

        // Check for agent list command
        if (message.content.trim().match(/^[!/]agent$/i)) {
            logger.info({ channel: 'discord', sender, messageId }, 'Agent list command received');
            const agentList = getAgentListText();
            await message.reply(agentList);
            return;
        }

        // Check for team list command
        if (message.content.trim().match(/^[!/]team$/i)) {
            logger.info({ channel: 'discord', sender, messageId }, 'Team list command received');
            const teamList = getTeamListText();
            await message.reply(teamList);
            return;
        }

        // Check for reset command: /reset @agent_id [@agent_id2 ...]
        const resetMatch = messageText.trim().match(/^[!/]reset\s+(.+)$/i);
        if (messageText.trim().match(/^[!/]reset$/i)) {
            await message.reply('Usage: `/reset @agent_id [@agent_id2 ...]`\nSpecify which agent(s) to reset.');
            return;
        }
        if (resetMatch) {
            logger.info({ channel: 'discord', sender, messageId }, 'Per-agent reset command received');
            const agentArgs = resetMatch[1].split(/\s+/).map(a => a.replace(/^@/, '').toLowerCase());
            try {
                const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
                const settings = JSON.parse(settingsData);
                const agents = settings.agents || {};
                const workspacePath = settings?.workspace?.path || path.join(require('os').homedir(), 'tinyclaw-workspace');
                const resetResults: string[] = [];
                for (const agentId of agentArgs) {
                    if (!agents[agentId]) {
                        resetResults.push(`Agent '${agentId}' not found.`);
                        continue;
                    }
                    const flagDir = path.join(workspacePath, agentId);
                    if (!fs.existsSync(flagDir)) fs.mkdirSync(flagDir, { recursive: true });
                    fs.writeFileSync(path.join(flagDir, 'reset_flag'), 'reset');
                    resetResults.push(`Reset @${agentId} (${agents[agentId].name}).`);
                }
                await message.reply(resetResults.join('\n'));
            } catch {
                await message.reply('Could not process reset command. Check settings.');
            }
            return;
        }

        // Check for restart command
        if (message.content.trim().match(/^[!/]restart$/i)) {
            logger.info({ channel: 'discord', sender, messageId }, 'Restart command received');
            await message.reply('Restarting TinyClaw...');
            const { exec } = require('child_process');
            exec(`"${path.join(SCRIPT_DIR, 'tinyclaw.sh')}" restart`, { detached: true, stdio: 'ignore' });
            return;
        }

        // Show typing indicator
        await (message.channel as DMChannel).sendTyping();

        // Build message text with file references
        let fullMessage = messageText;
        if (downloadedFiles.length > 0) {
            const fileRefs = downloadedFiles.map(f => `[file: ${f}]`).join('\n');
            fullMessage = fullMessage ? `${fullMessage}\n\n${fileRefs}` : fileRefs;
        }

        // Write to queue via API
        await fetch(`${API_BASE}/api/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                channel: 'discord',
                sender,
                senderId: message.author.id,
                message: fullMessage,
                messageId,
                files: downloadedFiles.length > 0 ? downloadedFiles : undefined,
            }),
        });

        logger.info({ channel: 'discord', sender, messageId, context: { fileCount: downloadedFiles.length, senderId: message.author.id } }, 'Queued message');

        // Store pending message for response
        pendingMessages.set(messageId, {
            message: message,
            channel: message.channel as DMChannel,
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
        logError(logger, error, 'Message handling error');
    }
});

// Watch for responses via API
async function checkOutgoingQueue(): Promise<void> {
    if (processingOutgoingQueue) {
        return;
    }

    processingOutgoingQueue = true;

    try {
        const res = await fetch(`${API_BASE}/api/responses/pending?channel=discord`);
        if (!res.ok) return;
        const responses = await res.json() as any[];

        for (const resp of responses) {
            try {
                const responseText = resp.message;
                const messageId = resp.messageId;
                const sender = resp.sender;
                const senderId = resp.senderId;
                const files: string[] = resp.files || [];

                // Find pending message, or fall back to senderId for proactive messages
                const pending = pendingMessages.get(messageId);
                let dmChannel = pending?.channel ?? null;

                if (!dmChannel && senderId) {
                    try {
                        const user = await client.users.fetch(senderId);
                        dmChannel = await user.createDM();
                    } catch (err) {
                        logError(logger, err, 'Could not open DM for senderId', { senderId, messageId });
                    }
                }

                if (dmChannel) {
                    // Send any attached files
                    if (files.length > 0) {
                        const attachments: AttachmentBuilder[] = [];
                        for (const file of files) {
                            try {
                                if (!fs.existsSync(file)) continue;
                                attachments.push(new AttachmentBuilder(file));
                            } catch (fileErr) {
                                logError(logger, fileErr, 'Failed to prepare file for Discord', { messageId, file });
                            }
                        }
                        if (attachments.length > 0) {
                            await dmChannel.send({ files: attachments });
                            logger.info({ channel: 'discord', sender, messageId, context: { fileCount: attachments.length } }, 'Sent files to Discord');
                        }
                    }

                    // Split message if needed (Discord 2000 char limit)
                    if (responseText) {
                        const chunks = splitMessage(responseText);

                        if (chunks.length > 0) {
                            if (pending) {
                                await pending.message.reply(chunks[0]!);
                            } else {
                                await dmChannel.send(chunks[0]!);
                            }
                        }
                        for (let i = 1; i < chunks.length; i++) {
                            await dmChannel.send(chunks[i]!);
                        }
                    }

                    logger.info({
                        channel: 'discord',
                        sender,
                        messageId,
                        context: {
                            kind: pending ? 'response' : 'proactive message',
                            responseLength: responseText.length,
                            fileCount: files.length,
                        },
                    }, 'Sent outbound message');

                    if (pending) pendingMessages.delete(messageId);
                    await fetch(`${API_BASE}/api/responses/${resp.id}/ack`, { method: 'POST' });
                } else {
                    logger.warn({ channel: 'discord', sender, messageId, context: { senderId } }, 'No pending message and no senderId; acking');
                    await fetch(`${API_BASE}/api/responses/${resp.id}/ack`, { method: 'POST' });
                }
            } catch (error) {
                logError(logger, error, 'Error processing Discord response', { responseId: resp.id });
                // Don't ack on error, will retry next poll
            }
        }
    } catch (error) {
        logError(logger, error, 'Outgoing queue error');
    } finally {
        processingOutgoingQueue = false;
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

function shutdownDiscord(exitCode: number): void {
    logger.info({ context: { exitCode } }, 'Shutting down Discord client');
    client.destroy();
    process.exit(exitCode);
}

// Catch unhandled errors so we can see what kills the bot
process.on('unhandledRejection', (reason) => {
    logError(logger, reason, 'Unhandled rejection');
});
process.on('uncaughtException', (error) => {
    logError(logger, error, 'Uncaught exception');
    shutdownDiscord(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
    shutdownDiscord(0);
});

process.on('SIGTERM', () => {
    shutdownDiscord(0);
});

// Start client
logger.info('Starting Discord client');
client.login(DISCORD_BOT_TOKEN);
