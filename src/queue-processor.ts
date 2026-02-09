#!/usr/bin/env node
/**
 * Queue Processor - Handles messages from all channels (WhatsApp, Telegram, etc.)
 * Processes one message at a time to avoid race conditions
 *
 * Supports multi-agent routing:
 *   - Messages prefixed with @agent_id are routed to that agent
 *   - Unrouted messages go to the "default" agent
 *   - Each agent has its own provider, model, working directory, and system prompt
 *   - Conversation isolation via per-agent working directories
 */

import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import path from 'path';
import crypto from 'crypto';

const SCRIPT_DIR = path.resolve(__dirname, '..');
const TINYCLAW_HOME = path.join(require('os').homedir(), '.tinyclaw');
const QUEUE_INCOMING = path.join(TINYCLAW_HOME, 'queue/incoming');
const QUEUE_OUTGOING = path.join(TINYCLAW_HOME, 'queue/outgoing');
const QUEUE_PROCESSING = path.join(TINYCLAW_HOME, 'queue/processing');
const LOG_FILE = path.join(TINYCLAW_HOME, 'logs/queue.log');
const RESET_FLAG = path.join(TINYCLAW_HOME, 'reset_flag');
const SETTINGS_FILE = path.join(TINYCLAW_HOME, 'settings.json');
const DEFAULT_WEBHOOK_PORT = 3077;

// Model name mapping
const CLAUDE_MODEL_IDS: Record<string, string> = {
    'sonnet': 'claude-sonnet-4-5',
    'opus': 'claude-opus-4-6',
    'claude-sonnet-4-5': 'claude-sonnet-4-5',
    'claude-opus-4-6': 'claude-opus-4-6'
};

const CODEX_MODEL_IDS: Record<string, string> = {
    'gpt-5.2': 'gpt-5.2',
    'gpt-5.3-codex': 'gpt-5.3-codex',
};

interface AgentConfig {
    name: string;
    provider: string;       // 'anthropic' or 'openai'
    model: string;           // e.g. 'sonnet', 'opus', 'gpt-5.3-codex'
    working_directory: string;
}

interface Settings {
    workspace?: {
        path?: string;
        name?: string;
    };
    channels?: {
        enabled?: string[];
        discord?: { bot_token?: string };
        telegram?: { bot_token?: string };
        whatsapp?: {};
    };
    models?: {
        provider?: string; // 'anthropic' or 'openai'
        anthropic?: {
            model?: string;
        };
        openai?: {
            model?: string;
        };
    };
    teams?: Record<string, AgentConfig>;
    agents?: Record<string, AgentConfig>; // Legacy fallback
    monitoring?: {
        heartbeat_interval?: number;
    };
}

function getSettings(): Settings {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const settings: Settings = JSON.parse(settingsData);

        // Auto-detect provider if not specified
        if (!settings?.models?.provider) {
            if (settings?.models?.openai) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'openai';
            } else if (settings?.models?.anthropic) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'anthropic';
            }
        }

        return settings;
    } catch {
        return {};
    }
}

/**
 * Build the default agent config from the legacy models section.
 * Used when no agents are configured, for backwards compatibility.
 */
function getDefaultAgentFromModels(settings: Settings): AgentConfig {
    const provider = settings?.models?.provider || 'anthropic';
    let model = '';
    if (provider === 'openai') {
        model = settings?.models?.openai?.model || 'gpt-5.3-codex';
    } else {
        model = settings?.models?.anthropic?.model || 'sonnet';
    }

    // Get workspace path from settings or use default
    const workspacePath = settings?.workspace?.path || path.join(require('os').homedir(), 'tinyclaw-workspace');
    const defaultAgentDir = path.join(workspacePath, 'default');

    // Ensure default team directory exists with copied configs
    ensureTeamDirectory(defaultAgentDir);

    return {
        name: 'Default',
        provider,
        model,
        working_directory: defaultAgentDir,
    };
}

/**
 * Recursively copy directory
 */
function copyDirSync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

/**
 * Ensure team directory exists with template files copied from TINYCLAW_HOME.
 * Creates directory if it doesn't exist and copies .claude/, heartbeat.md, and AGENTS.md.
 */
function ensureTeamDirectory(teamDir: string): void {
    if (fs.existsSync(teamDir)) {
        return; // Directory already exists
    }

    fs.mkdirSync(teamDir, { recursive: true });

    // Copy .claude directory
    const sourceClaudeDir = path.join(TINYCLAW_HOME, '.claude');
    const targetClaudeDir = path.join(teamDir, '.claude');
    if (fs.existsSync(sourceClaudeDir)) {
        copyDirSync(sourceClaudeDir, targetClaudeDir);
    }

    // Copy heartbeat.md
    const sourceHeartbeat = path.join(TINYCLAW_HOME, 'heartbeat.md');
    const targetHeartbeat = path.join(teamDir, 'heartbeat.md');
    if (fs.existsSync(sourceHeartbeat)) {
        fs.copyFileSync(sourceHeartbeat, targetHeartbeat);
    }

    // Copy AGENTS.md
    const sourceAgents = path.join(TINYCLAW_HOME, 'AGENTS.md');
    const targetAgents = path.join(teamDir, 'AGENTS.md');
    if (fs.existsSync(sourceAgents)) {
        fs.copyFileSync(sourceAgents, targetAgents);
    }
}

/**
 * Get all configured teams. Falls back to a single "default" team
 * derived from the legacy models section if no teams are configured.
 */
function getAgents(settings: Settings): Record<string, AgentConfig> {
    // Check for teams first
    if (settings.teams && Object.keys(settings.teams).length > 0) {
        return settings.teams;
    }
    // Backwards compatibility: check legacy "agents" field
    if (settings.agents && Object.keys(settings.agents).length > 0) {
        return settings.agents;
    }
    // Fall back to default team from models section
    return { default: getDefaultAgentFromModels(settings) };
}

/**
 * Resolve the model ID for Claude (Anthropic).
 */
function resolveClaudeModel(model: string): string {
    return CLAUDE_MODEL_IDS[model] || model || '';
}

/**
 * Resolve the model ID for Codex (OpenAI).
 */
function resolveCodexModel(model: string): string {
    return CODEX_MODEL_IDS[model] || model || '';
}

/**
 * Get the reset flag path for a specific team.
 */
function getAgentResetFlag(agentId: string, workspacePath: string): string {
    return path.join(workspacePath, agentId, 'reset_flag');
}


/**
 * Detect if message mentions multiple teams (easter egg for future feature)
 */
function detectMultipleTeams(message: string, agents: Record<string, AgentConfig>): string[] {
    const mentions = message.match(/@(\S+)/g) || [];
    const validTeams: string[] = [];

    for (const mention of mentions) {
        const teamId = mention.slice(1).toLowerCase();
        if (agents[teamId]) {
            validTeams.push(teamId);
        }
    }

    return validTeams;
}

/**
 * Parse @agent_id prefix from a message.
 * Returns { agentId, message } where message has the prefix stripped.
 * Returns { agentId: 'error', message: '...' } if multiple teams detected.
 */
function parseAgentRouting(rawMessage: string, agents: Record<string, AgentConfig>): { agentId: string; message: string } {
    // Easter egg: Check for multiple team mentions
    const mentionedTeams = detectMultipleTeams(rawMessage, agents);
    if (mentionedTeams.length > 1) {
        const teamList = mentionedTeams.map(t => `@${t}`).join(', ');
        return {
            agentId: 'error',
            message: `🚀 **Team-to-Team Collaboration - Coming Soon!**\n\n` +
                     `You mentioned multiple teams: ${teamList}\n\n` +
                     `Right now, I can only route to one team at a time. But we're working on something cool:\n\n` +
                     `✨ **Multi-Team Coordination** - Teams will be able to collaborate on complex tasks!\n` +
                     `✨ **Smart Routing** - Send instructions to multiple teams at once!\n` +
                     `✨ **Team Handoffs** - One team can delegate to another!\n\n` +
                     `For now, please send separate messages to each team:\n` +
                     mentionedTeams.map(t => `• \`@${t} [your message]\``).join('\n') + '\n\n' +
                     `_Stay tuned for updates! 🎉_`
        };
    }

    const match = rawMessage.match(/^@(\S+)\s+([\s\S]*)$/);
    if (match) {
        const candidateId = match[1].toLowerCase();
        if (agents[candidateId]) {
            return { agentId: candidateId, message: match[2] };
        }
        // Also match by agent name (case-insensitive)
        for (const [id, config] of Object.entries(agents)) {
            if (config.name.toLowerCase() === candidateId) {
                return { agentId: id, message: match[2] };
            }
        }
    }
    return { agentId: 'default', message: rawMessage };
}

async function runCommand(command: string, args: string[], cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: cwd || SCRIPT_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
        });

        child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
        });

        child.on('error', (error) => {
            reject(error);
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
                return;
            }

            const errorMessage = stderr.trim() || `Command exited with code ${code}`;
            reject(new Error(errorMessage));
        });
    });
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
    agent?: string; // optional: pre-routed agent id from channel client
    files?: string[];
}

interface ResponseData {
    channel: string;
    sender: string;
    message: string;
    originalMessage: string;
    timestamp: number;
    messageId: string;
    agent?: string; // which agent handled this
    files?: string[];
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
        const { channel, sender, message: rawMessage, timestamp, messageId } = messageData;

        log('INFO', `Processing [${channel}] from ${sender}: ${rawMessage.substring(0, 50)}...`);

        // Get settings and agents
        const settings = getSettings();
        const agents = getAgents(settings);

        // Get workspace path from settings
        const workspacePath = settings?.workspace?.path || path.join(require('os').homedir(), 'tinyclaw-workspace');

        // Route message to agent
        let agentId: string;
        let message: string;

        if (messageData.agent && agents[messageData.agent]) {
            // Pre-routed by channel client
            agentId = messageData.agent;
            message = rawMessage;
        } else {
            // Parse @agent prefix
            const routing = parseAgentRouting(rawMessage, agents);
            agentId = routing.agentId;
            message = routing.message;
        }

        // Easter egg: Handle multiple team mentions
        if (agentId === 'error') {
            log('INFO', `Multiple teams detected, sending easter egg message`);

            // Send error message directly as response
            const responseFile = path.join(QUEUE_OUTGOING, path.basename(processingFile));
            const responseData: ResponseData = {
                channel,
                sender,
                message: message, // Contains the easter egg message
                originalMessage: rawMessage,
                timestamp: Date.now(),
                messageId,
            };

            fs.writeFileSync(responseFile, JSON.stringify(responseData, null, 2));
            fs.unlinkSync(processingFile);
            log('INFO', `✓ Easter egg sent to ${sender}`);
            return;
        }

        // Fall back to default if agent not found
        if (!agents[agentId]) {
            agentId = 'default';
            message = rawMessage;
        }

        // Final fallback: use first available agent if no default
        if (!agents[agentId]) {
            agentId = Object.keys(agents)[0];
        }

        const agent = agents[agentId];
        log('INFO', `Routing to team: ${agent.name} (${agentId}) [${agent.provider}/${agent.model}]`);

        // Ensure team directory exists with config files
        const teamDir = path.join(workspacePath, agentId);
        const isNewTeam = !fs.existsSync(teamDir);
        ensureTeamDirectory(teamDir);
        if (isNewTeam) {
            log('INFO', `Initialized team directory with config files: ${teamDir}`);
        }

        // Resolve working directory - use team directory
        const workingDir = agent.working_directory
            ? (path.isAbsolute(agent.working_directory)
                ? agent.working_directory
                : path.join(workspacePath, agent.working_directory))
            : teamDir;

        // Check for reset (per-team or global)
        const agentResetFlag = getAgentResetFlag(agentId, workspacePath);
        const shouldReset = fs.existsSync(RESET_FLAG) || fs.existsSync(agentResetFlag);

        if (shouldReset) {
            // Clean up both flags
            if (fs.existsSync(RESET_FLAG)) fs.unlinkSync(RESET_FLAG);
            if (fs.existsSync(agentResetFlag)) fs.unlinkSync(agentResetFlag);
        }

        const provider = agent.provider || 'anthropic';

        // Call AI provider
        let response: string;
        try {
            if (provider === 'openai') {
                log('INFO', `Using Codex CLI (agent: ${agentId})`);

                const shouldResume = !shouldReset;

                if (shouldReset) {
                    log('INFO', `🔄 Resetting Codex conversation for agent: ${agentId}`);
                }

                const modelId = resolveCodexModel(agent.model);
                const codexArgs = ['exec'];
                if (shouldResume) {
                    codexArgs.push('resume', '--last');
                }
                if (modelId) {
                    codexArgs.push('--model', modelId);
                }
                codexArgs.push('--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--json', message);

                const codexOutput = await runCommand('codex', codexArgs, workingDir);

                // Parse JSONL output and extract final agent_message
                response = '';
                const lines = codexOutput.trim().split('\n');
                for (const line of lines) {
                    try {
                        const json = JSON.parse(line);
                        if (json.type === 'item.completed' && json.item?.type === 'agent_message') {
                            response = json.item.text;
                        }
                    } catch (e) {
                        // Ignore lines that aren't valid JSON
                    }
                }

                if (!response) {
                    response = 'Sorry, I could not generate a response from Codex.';
                }
            } else {
                // Default to Claude (Anthropic)
                log('INFO', `Using Claude provider (agent: ${agentId})`);

                const continueConversation = !shouldReset;

                if (shouldReset) {
                    log('INFO', `🔄 Resetting conversation for agent: ${agentId}`);
                }

                const modelId = resolveClaudeModel(agent.model);
                const claudeArgs = ['--dangerously-skip-permissions'];
                if (modelId) {
                    claudeArgs.push('--model', modelId);
                }
                if (continueConversation) {
                    claudeArgs.push('-c');
                }
                claudeArgs.push('-p', message);

                response = await runCommand('claude', claudeArgs, workingDir);
            }
        } catch (error) {
            log('ERROR', `${provider === 'openai' ? 'Codex' : 'Claude'} error (agent: ${agentId}): ${(error as Error).message}`);
            response = "Sorry, I encountered an error processing your request. Please check the queue logs.";
        }

        // Detect file references in the response: [send_file: /path/to/file]
        response = response.trim();
        const outboundFilesSet = new Set<string>();
        const fileRefRegex = /\[send_file:\s*([^\]]+)\]/g;
        let fileMatch: RegExpExecArray | null;
        while ((fileMatch = fileRefRegex.exec(response)) !== null) {
            const filePath = fileMatch[1].trim();
            if (fs.existsSync(filePath)) {
                outboundFilesSet.add(filePath);
            }
        }
        const outboundFiles = Array.from(outboundFilesSet);

        // Remove the [send_file: ...] tags from the response text
        if (outboundFiles.length > 0) {
            response = response.replace(fileRefRegex, '').trim();
        }

        // Limit response length after tags are parsed and removed
        if (response.length > 4000) {
            response = response.substring(0, 3900) + '\n\n[Response truncated...]';
        }

        // Write response to outgoing queue
        const responseData: ResponseData = {
            channel,
            sender,
            message: response,
            originalMessage: rawMessage,
            timestamp: Date.now(),
            messageId,
            agent: agentId,
            files: outboundFiles.length > 0 ? outboundFiles : undefined,
        };

        // For heartbeat messages, write to a separate location (they handle their own responses)
        const responseFile = channel === 'heartbeat'
            ? path.join(QUEUE_OUTGOING, `${messageId}.json`)
            : path.join(QUEUE_OUTGOING, `${channel}_${messageId}_${Date.now()}.json`);

        fs.writeFileSync(responseFile, JSON.stringify(responseData, null, 2));

        log('INFO', `✓ Response ready [${channel}] ${sender} via agent:${agentId} (${response.length} chars)`);

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

// Per-team processing chains - ensures messages to same team are sequential
const teamProcessingChains = new Map<string, Promise<void>>();

/**
 * Peek at a message file to determine which team it's routed to
 */
function peekTeamId(filePath: string): string {
    try {
        const messageData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const settings = getSettings();
        const agents = getAgents(settings);

        // Check for pre-routed agent
        if (messageData.agent && agents[messageData.agent]) {
            return messageData.agent;
        }

        // Parse @team_id prefix
        const routing = parseAgentRouting(messageData.message || '', agents);
        return routing.agentId || 'default';
    } catch {
        return 'default';
    }
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

            // Process messages in parallel by team (sequential within each team)
            for (const file of files) {
                // Determine target team
                const teamId = peekTeamId(file.path);

                // Get or create promise chain for this team
                const currentChain = teamProcessingChains.get(teamId) || Promise.resolve();

                // Chain this message to the team's promise
                const newChain = currentChain
                    .then(() => processMessage(file.path))
                    .catch(error => {
                        log('ERROR', `Error processing message for team ${teamId}: ${error.message}`);
                    });

                // Update the chain
                teamProcessingChains.set(teamId, newChain);

                // Clean up completed chains to avoid memory leaks
                newChain.finally(() => {
                    if (teamProcessingChains.get(teamId) === newChain) {
                        teamProcessingChains.delete(teamId);
                    }
                });
            }
        }
    } catch (error) {
        log('ERROR', `Queue processing error: ${(error as Error).message}`);
    }
}

// Log agent configuration on startup
function logAgentConfig(): void {
    const settings = getSettings();
    const agents = getAgents(settings);
    const agentCount = Object.keys(agents).length;
    log('INFO', `Loaded ${agentCount} agent(s):`);
    for (const [id, agent] of Object.entries(agents)) {
        log('INFO', `  ${id}: ${agent.name} [${agent.provider}/${agent.model}] cwd=${agent.working_directory}`);
    }
}

// ─── Webhook HTTP Server ───────────────────────────────────────────────────

interface WebhookMessageBody {
    channel: string;
    sender: string;
    senderId?: string;
    message: string;
    timestamp?: number;
    messageId?: string;
}

interface WebhookResponse {
    success: boolean;
    messageId?: string;
    error?: string;
}

function getWebhookPort(): number {
    try {
        const settings = getSettings();
        const port = (settings as Record<string, unknown>)['webhook_port'];
        if (port && typeof port === 'number') {
            return port;
        }
    } catch { }
    return DEFAULT_WEBHOOK_PORT;
}

function readRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const MAX_BODY = 1024 * 1024; // 1MB limit

        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY) {
                req.destroy();
                reject(new Error('Request body too large'));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function sendJson(res: http.ServerResponse, statusCode: number, data: object): void {
    const body = JSON.stringify(data, null, 2);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
}

function handleWebhookMessage(body: WebhookMessageBody): WebhookResponse {
    // Validate required fields
    if (!body.channel || typeof body.channel !== 'string') {
        return { success: false, error: 'Missing or invalid "channel" field' };
    }
    if (!body.sender || typeof body.sender !== 'string') {
        return { success: false, error: 'Missing or invalid "sender" field' };
    }
    if (!body.message || typeof body.message !== 'string') {
        return { success: false, error: 'Missing or invalid "message" field' };
    }

    const timestamp = body.timestamp || Date.now();
    const messageId = body.messageId || `${body.channel}_${timestamp}_${crypto.randomBytes(4).toString('hex')}`;

    const messageData: MessageData = {
        channel: body.channel,
        sender: body.sender,
        senderId: body.senderId || `webhook_${body.sender}`,
        message: body.message,
        timestamp,
        messageId,
    };

    const filename = `${body.channel}_${timestamp}_${crypto.randomBytes(4).toString('hex')}.json`;
    const filePath = path.join(QUEUE_INCOMING, filename);

    fs.writeFileSync(filePath, JSON.stringify(messageData, null, 2));

    log('INFO', `[webhook] Queued message [${body.channel}] from ${body.sender}: ${body.message.substring(0, 50)}...`);

    return { success: true, messageId };
}

function getMessageStatus(messageId: string): { status: string; data?: object } {
    // Check outgoing (completed)
    const outFiles = fs.readdirSync(QUEUE_OUTGOING).filter(f => f.endsWith('.json'));
    for (const f of outFiles) {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(QUEUE_OUTGOING, f), 'utf8'));
            if (data.messageId === messageId) {
                return { status: 'completed', data };
            }
        } catch { }
    }

    // Check processing (in progress)
    const procFiles = fs.readdirSync(QUEUE_PROCESSING).filter(f => f.endsWith('.json'));
    for (const f of procFiles) {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(QUEUE_PROCESSING, f), 'utf8'));
            if (data.messageId === messageId) {
                return { status: 'processing' };
            }
        } catch { }
    }

    // Check incoming (queued)
    const inFiles = fs.readdirSync(QUEUE_INCOMING).filter(f => f.endsWith('.json'));
    for (const f of inFiles) {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(QUEUE_INCOMING, f), 'utf8'));
            if (data.messageId === messageId) {
                return { status: 'queued' };
            }
        } catch { }
    }

    return { status: 'not_found' };
}

function startWebhookServer(): void {
    const port = getWebhookPort();

    const server = http.createServer(async (req, res) => {
        const url = req.url || '/';
        const method = req.method || 'GET';

        // CORS headers for broad compatibility
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // POST /webhook/message — queue a new message
        if (method === 'POST' && url === '/webhook/message') {
            try {
                const rawBody = await readRequestBody(req);
                const body: WebhookMessageBody = JSON.parse(rawBody);
                const result = handleWebhookMessage(body);
                sendJson(res, result.success ? 200 : 400, result);
            } catch (error) {
                sendJson(res, 400, { success: false, error: 'Invalid JSON body' });
            }
            return;
        }

        // GET /webhook/health — health check
        if (method === 'GET' && url === '/webhook/health') {
            const incomingCount = fs.readdirSync(QUEUE_INCOMING).filter(f => f.endsWith('.json')).length;
            const processingCount = fs.readdirSync(QUEUE_PROCESSING).filter(f => f.endsWith('.json')).length;
            const outgoingCount = fs.readdirSync(QUEUE_OUTGOING).filter(f => f.endsWith('.json')).length;

            sendJson(res, 200, {
                status: 'ok',
                uptime: process.uptime(),
                queue: {
                    incoming: incomingCount,
                    processing: processingCount,
                    outgoing: outgoingCount,
                },
            });
            return;
        }

        // GET /webhook/status/:messageId — check message status
        const statusMatch = url.match(/^\/webhook\/status\/(.+)$/);
        if (method === 'GET' && statusMatch) {
            const messageId = decodeURIComponent(statusMatch[1]);
            const result = getMessageStatus(messageId);
            const statusCode = result.status === 'not_found' ? 404 : 200;
            sendJson(res, statusCode, result);
            return;
        }

        // 404 for everything else
        sendJson(res, 404, { error: 'Not found' });
    });

    server.listen(port, () => {
        log('INFO', `Webhook server listening on port ${port}`);
        log('INFO', `  POST http://localhost:${port}/webhook/message`);
        log('INFO', `  GET  http://localhost:${port}/webhook/health`);
        log('INFO', `  GET  http://localhost:${port}/webhook/status/:messageId`);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
            log('ERROR', `Webhook port ${port} is already in use. Webhook server disabled.`);
        } else {
            log('ERROR', `Webhook server error: ${err.message}`);
        }
    });
}

// ─── Main Loop ─────────────────────────────────────────────────────────────


log('INFO', 'Queue processor started');
log('INFO', `Watching: ${QUEUE_INCOMING}`);
logAgentConfig();

// Start webhook HTTP server
startWebhookServer();

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
