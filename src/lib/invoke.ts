import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AgentConfig, TeamConfig } from './types';
import { SCRIPT_DIR, resolveClaudeModel, resolveCodexModel } from './config';
import { log } from './logging';
import { ensureAgentDirectory, updateAgentTeammates } from './agent-setup';

type JsonObject = Record<string, unknown>;
type ActivityCallback = (activity: string) => void;

export interface AgentInvokeResult {
    text: string;
    sessionId?: string;
}

function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toObject(value: unknown): JsonObject | null {
    return isObject(value) ? value : null;
}

function getString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function getArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function truncateText(text: string, maxLength = 120): string {
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, maxLength - 3)}...`;
}

function pickInputString(input: JsonObject, keys: string[]): string | null {
    for (const key of keys) {
        const value = getString(input[key]);
        if (value && value.trim()) {
            return value.trim();
        }
    }
    return null;
}

function summarizeToolUse(toolName: string, input: JsonObject | null): string {
    const normalized = toolName.trim();
    const lower = normalized.toLowerCase();
    const safeInput = input || {};

    if (lower === 'read') {
        const filePath = pickInputString(safeInput, ['file_path', 'path', 'file']);
        return filePath ? `Read ${truncateText(filePath, 90)}` : 'Read a file';
    }
    if (lower === 'write') {
        const filePath = pickInputString(safeInput, ['file_path', 'path', 'file']);
        return filePath ? `Wrote ${truncateText(filePath, 90)}` : 'Wrote a file';
    }
    if (lower === 'edit') {
        const filePath = pickInputString(safeInput, ['file_path', 'path', 'file']);
        return filePath ? `Edited ${truncateText(filePath, 90)}` : 'Edited a file';
    }
    if (lower === 'bash') {
        const command = pickInputString(safeInput, ['command', 'cmd']);
        return command ? `Ran ${truncateText(command, 90)}` : 'Ran a shell command';
    }
    if (lower === 'grep') {
        const pattern = pickInputString(safeInput, ['pattern', 'query']);
        return pattern ? `Searched for "${truncateText(pattern, 70)}"` : 'Searched with grep';
    }
    if (lower === 'glob') {
        const pattern = pickInputString(safeInput, ['pattern']);
        return pattern ? `Matched files with "${truncateText(pattern, 70)}"` : 'Matched files';
    }
    if (lower === 'webfetch') {
        const url = pickInputString(safeInput, ['url']);
        return url ? `Fetched ${truncateText(url, 90)}` : 'Fetched a URL';
    }
    if (lower === 'websearch') {
        const query = pickInputString(safeInput, ['query']);
        return query ? `Searched web for "${truncateText(query, 70)}"` : 'Searched the web';
    }

    return `Used ${normalized || 'a tool'}`;
}

function recordActivity(
    summary: string,
    seenActivities: Set<string>,
    onActivity?: ActivityCallback,
    collectedActivities?: string[],
    dedupe = true
): void {
    const trimmed = summary.trim();
    if (!trimmed) {
        return;
    }
    if (dedupe && seenActivities.has(trimmed)) {
        return;
    }
    if (dedupe) {
        seenActivities.add(trimmed);
    }
    if (collectedActivities) {
        collectedActivities.push(trimmed);
    }
    if (onActivity) {
        try {
            onActivity(trimmed);
        } catch {
            // Ignore callback failures
        }
    }
}

function processClaudeEvent(
    eventObj: JsonObject,
    seenActivities: Set<string>,
    toolSummaryById: Map<string, string>,
    onActivity?: ActivityCallback,
    collectedActivities?: string[]
): string {
    let latestResponse = '';
    const eventType = getString(eventObj.type) || '';
    const eventSubtype = getString(eventObj.subtype) || '';

    if (eventType === 'result') {
        const resultText = getString(eventObj.result);
        if (resultText && resultText.trim()) {
            latestResponse = resultText.trim();
        }
    }

    if (eventType === 'assistant') {
        const messageObj = toObject(eventObj.message);
        const contentBlocks = getArray(messageObj?.content);
        for (const block of contentBlocks) {
            const blockObj = toObject(block);
            if (!blockObj) {
                continue;
            }

            const blockType = getString(blockObj.type) || '';
            if (blockType === 'text') {
                const text = getString(blockObj.text);
                if (text && text.trim()) {
                    latestResponse = text.trim();
                }
            }
            if (blockType === 'tool_use') {
                const toolName = getString(blockObj.name) || 'tool';
                const summary = summarizeToolUse(toolName, toObject(blockObj.input));
                const toolUseId = getString(blockObj.id);
                if (toolUseId) {
                    toolSummaryById.set(toolUseId, summary);
                }
                recordActivity(summary, seenActivities, onActivity, collectedActivities, true);
            }
        }
    }

    if (eventType === 'user') {
        const messageObj = toObject(eventObj.message);
        const contentBlocks = getArray(messageObj?.content);
        for (const block of contentBlocks) {
            const blockObj = toObject(block);
            if (!blockObj) {
                continue;
            }
            if ((getString(blockObj.type) || '') !== 'tool_result') {
                continue;
            }
            const toolUseId = getString(blockObj.tool_use_id) || '';
            const priorSummary = toolSummaryById.get(toolUseId);
            const completion = priorSummary
                ? `Completed ${priorSummary.toLowerCase()}`
                : 'Tool result received';
            // Tool results should stream even if text repeats.
            recordActivity(completion, seenActivities, onActivity, collectedActivities, false);
        }
    }

    if (eventType.includes('tool') || eventSubtype.includes('tool')) {
        const toolName = getString(eventObj.tool_name)
            || getString(eventObj.name)
            || getString(toObject(eventObj.tool)?.name)
            || 'tool';
        const input = toObject(eventObj.input) || toObject(eventObj.arguments) || toObject(eventObj.tool_input);
        const summary = summarizeToolUse(toolName, input);
        recordActivity(summary, seenActivities, onActivity, collectedActivities, true);
    }

    return latestResponse;
}

function parseSessionId(value: unknown): string | null {
    const raw = getString(value);
    if (!raw) return null;
    const trimmed = raw.trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
        ? trimmed
        : null;
}

function tryExtractSessionId(eventObj: JsonObject): string | null {
    const direct = parseSessionId(eventObj.sessionId) || parseSessionId(eventObj.session_id);
    if (direct) return direct;

    const messageObj = toObject(eventObj.message);
    const fromMessage = messageObj
        ? (parseSessionId(messageObj.sessionId) || parseSessionId(messageObj.session_id))
        : null;
    if (fromMessage) return fromMessage;

    const payload = toObject(eventObj.payload);
    if (!payload) return null;
    return parseSessionId(payload.sessionId) || parseSessionId(payload.session_id);
}

function getLatestClaudeSessionId(workingDir: string): string | undefined {
    try {
        const projectKey = workingDir.replace(/\//g, '-');
        const projectDir = path.join(os.homedir(), '.claude', 'projects', projectKey);
        if (!fs.existsSync(projectDir)) return undefined;

        const latest = fs.readdirSync(projectDir)
            .filter(name => name.endsWith('.jsonl'))
            .map(name => {
                const fullPath = path.join(projectDir, name);
                return { name, mtimeMs: fs.statSync(fullPath).mtimeMs };
            })
            .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];

        if (!latest) return undefined;
        return latest.name.replace(/\.jsonl$/, '');
    } catch {
        return undefined;
    }
}

async function runClaudeCommand(
    args: string[],
    cwd: string,
    onActivity?: ActivityCallback
): Promise<{ output: string; parsed: { response: string; activities: string[] }; sessionId?: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn('claude', args, {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let stdoutBuffer = '';
        let stderrBuffer = '';
        let finalResponse = '';
        let sessionId: string | undefined;
        const activities: string[] = [];
        const seenActivities = new Set<string>();
        const toolSummaryById = new Map<string, string>();

        function processLine(line: string): void {
            const trimmed = line.trim();
            if (!trimmed) {
                return;
            }
            let event: unknown;
            try {
                event = JSON.parse(trimmed);
            } catch {
                return;
            }
            const eventObj = toObject(event);
            if (!eventObj) {
                return;
            }
            const extractedSessionId = tryExtractSessionId(eventObj);
            if (extractedSessionId) {
                sessionId = extractedSessionId;
            }
            const responseUpdate = processClaudeEvent(eventObj, seenActivities, toolSummaryById, onActivity, activities);
            if (responseUpdate) {
                finalResponse = responseUpdate;
            }
        }

        function consumeChunk(chunk: string, isStdout: boolean): void {
            if (isStdout) {
                stdout += chunk;
                stdoutBuffer += chunk;
                while (stdoutBuffer.includes('\n')) {
                    const idx = stdoutBuffer.indexOf('\n');
                    const line = stdoutBuffer.slice(0, idx);
                    stdoutBuffer = stdoutBuffer.slice(idx + 1);
                    processLine(line);
                }
            } else {
                stderr += chunk;
                stderrBuffer += chunk;
                while (stderrBuffer.includes('\n')) {
                    const idx = stderrBuffer.indexOf('\n');
                    const line = stderrBuffer.slice(0, idx);
                    stderrBuffer = stderrBuffer.slice(idx + 1);
                    processLine(line);
                }
            }
        }

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => consumeChunk(chunk, true));
        child.stderr.on('data', (chunk: string) => consumeChunk(chunk, false));

        child.on('error', (error) => {
            reject(error);
        });

        child.on('close', (code) => {
            if (stdoutBuffer.trim()) {
                processLine(stdoutBuffer);
            }
            if (stderrBuffer.trim()) {
                processLine(stderrBuffer);
            }

            if (code === 0) {
                resolve({
                    output: stdout,
                    parsed: {
                        response: finalResponse,
                        activities: activities.slice(0, 20),
                    },
                    sessionId,
                });
                return;
            }

            const errorMessage = stderr.trim() || stdout.trim() || `Command exited with code ${code}`;
            reject(new Error(errorMessage));
        });
    });
}

export async function runCommand(command: string, args: string[], cwd?: string): Promise<string> {
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

/**
 * Invoke a single agent with a message. Contains all Claude/Codex invocation logic.
 * Returns the response text and optional session ID.
 */
export async function invokeAgent(
    agent: AgentConfig,
    agentId: string,
    message: string,
    workspacePath: string,
    shouldReset: boolean,
    agents: Record<string, AgentConfig> = {},
    teams: Record<string, TeamConfig> = {},
    options?: { onActivity?: ActivityCallback }
): Promise<AgentInvokeResult> {
    // Ensure agent directory exists with config files
    const agentDir = path.join(workspacePath, agentId);
    const isNewAgent = !fs.existsSync(agentDir);
    ensureAgentDirectory(agentDir);
    if (isNewAgent) {
        log('INFO', `Initialized agent directory with config files: ${agentDir}`);
    }

    // Update AGENTS.md with current teammate info
    updateAgentTeammates(agentDir, agentId, agents, teams);

    // Resolve working directory
    const workingDir = agent.working_directory
        ? (path.isAbsolute(agent.working_directory)
            ? agent.working_directory
            : path.join(workspacePath, agent.working_directory))
        : agentDir;

    const provider = agent.provider || 'anthropic';

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
        let response = '';
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

        return {
            text: response || 'Sorry, I could not generate a response from Codex.',
        };
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
        claudeArgs.push('--verbose', '--output-format', 'stream-json', '-p', message);

        const runResult = await runClaudeCommand(claudeArgs, workingDir, options?.onActivity);
        const parsed = runResult.parsed;
        const hasActivities = parsed.activities.length > 0;
        const hasResponse = parsed.response.trim().length > 0;

        if (hasActivities && hasResponse && !options?.onActivity) {
            const activityLines = parsed.activities.map(item => `- ${item}`).join('\n');
            return {
                text: `Activity:\n${activityLines}\n\n${parsed.response}`,
                sessionId: runResult.sessionId || getLatestClaudeSessionId(workingDir),
            };
        }
        if (hasActivities && !options?.onActivity) {
            return {
                text: `Activity:\n${parsed.activities.map(item => `- ${item}`).join('\n')}`,
                sessionId: runResult.sessionId || getLatestClaudeSessionId(workingDir),
            };
        }
        return {
            text: parsed.response || 'Sorry, I could not generate a response from Claude.',
            sessionId: runResult.sessionId || getLatestClaudeSessionId(workingDir),
        };
    }
}
