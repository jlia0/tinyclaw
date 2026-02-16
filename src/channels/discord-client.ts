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

const SCRIPT_DIR = path.resolve(__dirname, '..', '..');
const _localTinyclaw = path.join(SCRIPT_DIR, '.tinyclaw');
const TINYCLAW_HOME = process.env.TINYCLAW_HOME
    || (fs.existsSync(path.join(_localTinyclaw, 'settings.json'))
        ? _localTinyclaw
        : path.join(require('os').homedir(), '.tinyclaw'));
const QUEUE_INCOMING = path.join(TINYCLAW_HOME, 'queue/incoming');
const QUEUE_OUTGOING = path.join(TINYCLAW_HOME, 'queue/outgoing');
const LOG_FILE = path.join(TINYCLAW_HOME, 'logs/discord.log');
const SETTINGS_FILE = path.join(TINYCLAW_HOME, 'settings.json');
const FILES_DIR = path.join(TINYCLAW_HOME, 'files');
const PAIRING_FILE = path.join(TINYCLAW_HOME, 'pairing.json');

// Ensure directories exist
[QUEUE_INCOMING, QUEUE_OUTGOING, path.dirname(LOG_FILE), FILES_DIR].forEach(dir => {
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
                    log('INFO', `Downloaded attachment: ${path.basename(localPath)} (${attachment.contentType || 'unknown'})`);
                } catch (dlErr) {
                    log('ERROR', `Failed to download attachment ${attachment.name}: ${(dlErr as Error).message}`);
                }
            }
        }

        let messageText = message.content || '';

        log('INFO', `Message from ${sender}: ${messageText.substring(0, 50)}${downloadedFiles.length > 0 ? ` [+${downloadedFiles.length} file(s)]` : ''}...`);

        const pairing = ensureSenderPaired(PAIRING_FILE, 'discord', message.author.id, sender);
        if (!pairing.approved && pairing.code) {
            if (pairing.isNewPending) {
                log('INFO', `Blocked unpaired Discord sender ${sender} (${message.author.id}) with code ${pairing.code}`);
                await message.reply(pairingMessage(pairing.code));
            } else {
                log('INFO', `Blocked pending Discord sender ${sender} (${message.author.id}) without re-sending pairing message`);
            }
            return;
        }

        // Check for agent list command
        if (message.content.trim().match(/^[!/]agent$/i)) {
            log('INFO', 'Agent list command received');
            const agentList = getAgentListText();
            await message.reply(agentList);
            return;
        }

        // Check for team list command
        if (message.content.trim().match(/^[!/]team$/i)) {
            log('INFO', 'Team list command received');
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
            log('INFO', 'Per-agent reset command received');
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

        // Show typing indicator
        await (message.channel as DMChannel).sendTyping();

        // Build message text with file references
        let fullMessage = messageText;
        if (downloadedFiles.length > 0) {
            const fileRefs = downloadedFiles.map(f => `[file: ${f}]`).join('\n');
            fullMessage = fullMessage ? `${fullMessage}\n\n${fileRefs}` : fileRefs;
        }

        // Write to incoming queue
        const queueData: QueueData = {
            channel: 'discord',
            sender: sender,
            senderId: message.author.id,
            message: fullMessage,
            timestamp: Date.now(),
            messageId: messageId,
            files: downloadedFiles.length > 0 ? downloadedFiles : undefined,
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
            .filter(f => f.startsWith('discord_') && f.endsWith('.json'));

        for (const file of files) {
            const filePath = path.join(QUEUE_OUTGOING, file);

            try {
                const responseData: ResponseData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                const { messageId, message: responseText, sender, senderId } = responseData;

                // Find pending message, or fall back to senderId for proactive messages
                const pending = pendingMessages.get(messageId);
                let channel = pending?.channel ?? null;

                if (!channel && senderId) {
                    try {
                        const user = await client.users.fetch(senderId);
                        channel = await user.createDM();
                    } catch (err) {
                        log('ERROR', `Could not open DM for senderId ${senderId}: ${(err as Error).message}`);
                    }
                }

                if (channel) {
                    // Send any attached files
                    if (responseData.files && responseData.files.length > 0) {
                        const attachments: AttachmentBuilder[] = [];
                        for (const file of responseData.files) {
                            try {
                                if (!fs.existsSync(file)) continue;
                                attachments.push(new AttachmentBuilder(file));
                            } catch (fileErr) {
                                log('ERROR', `Failed to prepare file ${file}: ${(fileErr as Error).message}`);
                            }
                        }
                        if (attachments.length > 0) {
                            await channel.send({ files: attachments });
                            log('INFO', `Sent ${attachments.length} file(s) to Discord`);
                        }
                    }

                    // Split message if needed (Discord 2000 char limit)
                    if (responseText) {
                        const chunks = splitMessage(responseText);

                        if (chunks.length > 0) {
                            if (pending) {
                                await pending.message.reply(chunks[0]!);
                            } else {
                                await channel.send(chunks[0]!);
                            }
                        }
                        for (let i = 1; i < chunks.length; i++) {
                            await channel.send(chunks[i]!);
                        }
                    }

                    log('INFO', `Sent ${pending ? 'response' : 'proactive message'} to ${sender} (${responseText.length} chars${responseData.files ? `, ${responseData.files.length} file(s)` : ''})`);

                    if (pending) pendingMessages.delete(messageId);
                    fs.unlinkSync(filePath);
                } else {
                    log('WARN', `No pending message for ${messageId} and no senderId, cleaning up`);
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
