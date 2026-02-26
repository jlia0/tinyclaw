#!/usr/bin/env node
/**
 * Discord Client for TinyClaw Simple
 * Writes DM messages to queue and reads responses
 * Does NOT call Claude directly - that's handled by queue-processor
 */

import { Client, Events, GatewayIntentBits, Partials, Message, DMChannel, TextChannel, AttachmentBuilder, REST, Routes, SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { ensureSenderPaired } from '../lib/pairing';

const API_PORT = parseInt(process.env.TINYCLAW_API_PORT || '3777', 10);
const API_BASE = `http://localhost:${API_PORT}`;

const SCRIPT_DIR = path.resolve(__dirname, '..', '..');
const _localTinyclaw = path.join(SCRIPT_DIR, '.tinyclaw');
const TINYCLAW_HOME = process.env.TINYCLAW_HOME
    || (fs.existsSync(path.join(_localTinyclaw, 'settings.json'))
        ? _localTinyclaw
        : path.join(require('os').homedir(), '.tinyclaw'));
const LOG_FILE = path.join(TINYCLAW_HOME, 'logs/discord.log');
const SETTINGS_FILE = path.join(TINYCLAW_HOME, 'settings.json');
const FILES_DIR = path.join(TINYCLAW_HOME, 'files');
const PAIRING_FILE = path.join(TINYCLAW_HOME, 'pairing.json');

// Ensure directories exist
[path.dirname(LOG_FILE), FILES_DIR].forEach(dir => {
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
    channel: DMChannel | TextChannel;
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

// Logger
function log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(LOG_FILE, logMessage);
}

// Cached settings reader — single parse shared by all consumers
let _cachedSettings: any = null;
let _settingsMtime = 0;

function getCachedSettings(): any {
    try {
        const mtime = fs.statSync(SETTINGS_FILE).mtimeMs;
        if (!_cachedSettings || mtime !== _settingsMtime) {
            _cachedSettings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
            _settingsMtime = mtime;
        }
        return _cachedSettings;
    } catch {
        return null;
    }
}

function getTeamListText(): string {
    const settings = getCachedSettings();
    if (!settings) return 'Could not load team configuration.';
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
}

function getAgentListText(): string {
    const settings = getCachedSettings();
    if (!settings) return 'Could not load agent configuration.';
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
}

// Shared reset logic
function resetAgents(agentArgs: string[]): string[] {
    const settings = getCachedSettings();
    if (!settings) return ['Could not load settings.'];
    const agents = settings.agents || {};
    const workspacePath = settings?.workspace?.path || path.join(require('os').homedir(), 'tinyclaw-workspace');
    const results: string[] = [];
    for (const agentId of agentArgs) {
        if (!agents[agentId]) {
            results.push(`Agent '${agentId}' not found.`);
            continue;
        }
        const flagDir = path.join(workspacePath, agentId);
        if (!fs.existsSync(flagDir)) fs.mkdirSync(flagDir, { recursive: true });
        fs.writeFileSync(path.join(flagDir, 'reset_flag'), 'reset');
        results.push(`Reset @${agentId} (${agents[agentId].name}).`);
    }
    return results;
}

// Reply with message splitting for slash commands
async function interactionReplySplit(interaction: ChatInputCommandInteraction, text: string): Promise<void> {
    const chunks = splitMessage(text);
    await interaction.reply(chunks[0]!);
    for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp(chunks[i]!);
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

// Guild channel configuration
type GuildChannelConfig = Record<string, { default_agent?: string }>;
let guildChannels: GuildChannelConfig = {};

function loadGuildChannels(): void {
    const settings = getCachedSettings();
    guildChannels = settings?.channels?.discord?.guild_channels || {};
}

// Load on startup
loadGuildChannels();

// Reload every 30 seconds to pick up config changes
setInterval(loadGuildChannels, 30_000);

// Slash command definitions
const slashCommands = [
    new SlashCommandBuilder()
        .setName('agent')
        .setDescription('List all configured agents'),
    new SlashCommandBuilder()
        .setName('team')
        .setDescription('List all configured teams'),
    new SlashCommandBuilder()
        .setName('reset')
        .setDescription('Reset one or more agents')
        .addStringOption(option =>
            option
                .setName('agent_ids')
                .setDescription('Space-separated agent IDs to reset (e.g. "coder writer")')
                .setRequired(true)
                .setAutocomplete(true)
        ),
];

// Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [
        Partials.Channel,
        Partials.Message,
    ],
});

// Register slash commands for a single guild
const commandData = slashCommands.map(cmd => cmd.toJSON());

async function registerGuildCommands(appId: string, guildId: string, guildName: string): Promise<void> {
    const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN!);
    try {
        await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commandData });
        log('INFO', `Registered ${commandData.length} slash commands for guild "${guildName}" (${guildId})`);
    } catch (err) {
        log('ERROR', `Failed to register slash commands for guild "${guildName}" (${guildId}): ${(err as Error).message}`);
    }
}

// Client ready
client.on(Events.ClientReady, async (readyClient) => {
    log('INFO', `Discord bot connected as ${readyClient.user.tag}`);
    log('INFO', 'Listening for DMs...');

    for (const [guildId, guild] of readyClient.guilds.cache) {
        await registerGuildCommands(readyClient.user.id, guildId, guild.name);
    }
});

// Register slash commands when bot joins a new guild
client.on(Events.GuildCreate, async (guild) => {
    if (!client.user) return;
    log('INFO', `Joined new guild "${guild.name}" (${guild.id})`);
    await registerGuildCommands(client.user.id, guild.id, guild.name);
});

// Slash command interactions
client.on(Events.InteractionCreate, async (interaction) => {
    try {
        // Handle autocomplete for /reset
        if (interaction.isAutocomplete()) {
            if (interaction.commandName !== 'reset') return;

            const focusedValue = interaction.options.getFocused();
            try {
                const settings = getCachedSettings();
                const agentIds = Object.keys(settings?.agents || {});

                // Support space-separated multi-agent input: autocomplete the last token
                const tokens = focusedValue.split(/\s+/);
                const prefix = tokens.length > 1 ? tokens.slice(0, -1).join(' ') + ' ' : '';
                const lastToken = (tokens[tokens.length - 1] || '').toLowerCase();
                const alreadySelected = new Set(tokens.slice(0, -1).map((t: string) => t.toLowerCase()));

                const choices = agentIds
                    .filter(id => !alreadySelected.has(id) && id.toLowerCase().startsWith(lastToken))
                    .slice(0, 25)
                    .map(id => ({ name: prefix + id, value: prefix + id }));

                await interaction.respond(choices);
            } catch {
                await interaction.respond([]);
            }
            return;
        }

        // Handle slash commands
        if (!interaction.isChatInputCommand()) return;

        const { commandName } = interaction;

        if (commandName === 'agent') {
            log('INFO', 'Slash command /agent received');
            await interactionReplySplit(interaction, getAgentListText());
            return;
        }

        if (commandName === 'team') {
            log('INFO', 'Slash command /team received');
            await interactionReplySplit(interaction, getTeamListText());
            return;
        }

        if (commandName === 'reset') {
            log('INFO', 'Slash command /reset received');
            const agentIdsRaw = interaction.options.getString('agent_ids', true);
            const agentArgs = agentIdsRaw.split(/\s+/).map(a => a.replace(/^@/, '').toLowerCase()).filter(Boolean);

            if (agentArgs.length === 0) {
                await interaction.reply({ content: 'Please specify at least one agent ID to reset.', ephemeral: true });
                return;
            }

            await interactionReplySplit(interaction, resetAgents(agentArgs).join('\n'));
            return;
        }
    } catch (error) {
        log('ERROR', `Interaction handling error: ${(error as Error).message}`);
        try {
            if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'An error occurred processing this command.', ephemeral: true });
            }
        } catch { /* ignore reply failure */ }
    }
});

// Message received - Write to queue
client.on(Events.MessageCreate, async (message: Message) => {
    try {
        // Skip bot messages
        if (message.author.bot) {
            return;
        }

        // Determine if this is a guild (server) message and whether to process it
        const isGuild = !!message.guild;
        const botMentioned = isGuild && client.user ? message.mentions.has(client.user) : false;
        const isDesignatedChannel = isGuild && Object.prototype.hasOwnProperty.call(guildChannels, message.channel.id);

        if (isGuild && !botMentioned && !isDesignatedChannel) {
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

        // Strip bot @mention and role mentions from guild messages
        if (isGuild) {
            if (client.user) {
                messageText = messageText.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '');
            }
            messageText = messageText.replace(/<@&\d+>/g, '').trim();
        }

        log('INFO', `Message from ${sender}${isGuild ? ` in #${(message.channel as TextChannel).name}` : ''}: ${messageText.substring(0, 50)}${downloadedFiles.length > 0 ? ` [+${downloadedFiles.length} file(s)]` : ''}...`);

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

        // Show typing indicator
        if ('sendTyping' in message.channel) {
            await message.channel.sendTyping();
        }

        // Build message text with file references
        let fullMessage = messageText;
        if (downloadedFiles.length > 0) {
            const fileRefs = downloadedFiles.map(f => `[file: ${f}]`).join('\n');
            fullMessage = fullMessage ? `${fullMessage}\n\n${fileRefs}` : fileRefs;
        }

        // Encode senderId: for guild messages use userId:channelId, for DMs just userId
        const senderId = isGuild
            ? `${message.author.id}:${message.channel.id}`
            : message.author.id;

        // Determine default agent for designated channels (if no explicit @agent prefix)
        let agent: string | undefined;
        if (isDesignatedChannel) {
            const channelConfig = guildChannels[message.channel.id];
            if (channelConfig?.default_agent && !fullMessage.match(/^@\S+/)) {
                agent = channelConfig.default_agent;
            }
        }

        // Write to queue via API
        await fetch(`${API_BASE}/api/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                channel: 'discord',
                sender,
                senderId,
                message: fullMessage,
                messageId,
                agent,
                files: downloadedFiles.length > 0 ? downloadedFiles : undefined,
            }),
        });

        log('INFO', `Queued message ${messageId}${agent ? ` (default agent: ${agent})` : ''}`);

        // Store pending message for response
        pendingMessages.set(messageId, {
            message: message,
            channel: message.channel as DMChannel | TextChannel,
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
                const responseText: string = resp.message;
                const messageId: string = resp.messageId;
                const sender: string = resp.sender;
                const senderId: string | undefined = resp.senderId;
                const agentId: string | undefined = resp.agent;
                const files: string[] = resp.files || [];

                // Find pending message, or fall back to senderId for proactive messages
                const pending = pendingMessages.get(messageId);
                let targetChannel: DMChannel | TextChannel | null = pending?.channel ?? null;

                if (!targetChannel && senderId) {
                    try {
                        if (senderId.includes(':')) {
                            // Guild message: senderId is userId:channelId
                            const channelId = senderId.split(':')[1];
                            const ch = await client.channels.fetch(channelId);
                            if (ch && ch.isTextBased() && !ch.isDMBased()) {
                                targetChannel = ch as TextChannel;
                            }
                        } else {
                            // DM: senderId is just userId
                            const user = await client.users.fetch(senderId);
                            targetChannel = await user.createDM();
                        }
                    } catch (err) {
                        log('ERROR', `Could not resolve channel for senderId ${senderId}: ${(err as Error).message}`);
                    }
                }

                if (targetChannel) {
                    // Send any attached files
                    if (files.length > 0) {
                        const attachments: AttachmentBuilder[] = [];
                        for (const file of files) {
                            try {
                                if (!fs.existsSync(file)) continue;
                                attachments.push(new AttachmentBuilder(file));
                            } catch (fileErr) {
                                log('ERROR', `Failed to prepare file ${file}: ${(fileErr as Error).message}`);
                            }
                        }
                        if (attachments.length > 0) {
                            await targetChannel.send({ files: attachments });
                            log('INFO', `Sent ${attachments.length} file(s) to Discord`);
                        }
                    }

                    // Append agent signature to response
                    let signedText = responseText;
                    if (agentId) {
                        const settings = getCachedSettings();
                        const agentName = settings?.agents?.[agentId]?.name;
                        if (agentName) signedText = `${responseText}\n\n— ${agentName}`;
                    }

                    // Split message if needed (Discord 2000 char limit)
                    if (signedText) {
                        const chunks = splitMessage(signedText);

                        if (chunks.length > 0) {
                            if (pending) {
                                await pending.message.reply(chunks[0]!);
                            } else {
                                await targetChannel.send(chunks[0]!);
                            }
                        }
                        for (let i = 1; i < chunks.length; i++) {
                            await targetChannel.send(chunks[i]!);
                        }
                    }

                    log('INFO', `Sent ${pending ? 'response' : 'proactive message'} to ${sender} (${responseText.length} chars${files.length > 0 ? `, ${files.length} file(s)` : ''})`);

                    if (pending) pendingMessages.delete(messageId);
                    await fetch(`${API_BASE}/api/responses/${resp.id}/ack`, { method: 'POST' });
                } else {
                    log('WARN', `No pending message for ${messageId} and no senderId, acking`);
                    await fetch(`${API_BASE}/api/responses/${resp.id}/ack`, { method: 'POST' });
                }
            } catch (error) {
                log('ERROR', `Error processing response ${resp.id}: ${(error as Error).message}`);
                // Don't ack on error, will retry next poll
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
