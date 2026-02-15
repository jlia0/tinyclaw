import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { AgentConfig, TeamConfig, InvokeResult } from './types';
import { SCRIPT_DIR, resolveClaudeModel, resolveCodexModel, getSettings } from './config';
import { QUESTION_PROMPT } from './question-bridge';
import { log } from './logging';
import { ensureAgentDirectory, updateAgentTeammates } from './agent-setup';

export interface CommandResult {
    stdout: string;
    stderr: string;
}

/**
 * Run a command with an optional timeout (in ms).
 * If the timeout fires, the child is killed (SIGTERM → SIGKILL) and the
 * promise rejects with a descriptive error.
 */
export async function runCommand(command: string, args: string[], cwd?: string, timeoutMs?: number): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
        // Strip CLAUDECODE env var so spawned Claude sessions don't think they're nested
        const env = { ...process.env };
        delete env.CLAUDECODE;

        const child = spawn(command, args, {
            cwd: cwd || SCRIPT_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
        });

        let stdout = '';
        let stderr = '';
        let killed = false;
        let timer: NodeJS.Timeout | undefined;
        let killTimer: NodeJS.Timeout | undefined;

        if (timeoutMs && timeoutMs > 0) {
            timer = setTimeout(() => {
                killed = true;
                log('WARN', `Command timed out after ${Math.round(timeoutMs / 1000)}s — sending SIGTERM (pid ${child.pid})`);
                child.kill('SIGTERM');
                // Force-kill if still alive after 5s
                killTimer = setTimeout(() => {
                    if (!child.killed) {
                        log('WARN', `Force-killing command (pid ${child.pid}) with SIGKILL`);
                        child.kill('SIGKILL');
                    }
                }, 5000);
            }, timeoutMs);
        }

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
        });

        child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
        });

        child.on('error', (error) => {
            if (timer) clearTimeout(timer);
            if (killTimer) clearTimeout(killTimer);
            reject(error);
        });

        child.on('close', (code) => {
            if (timer) clearTimeout(timer);
            if (killTimer) clearTimeout(killTimer);

            if (killed) {
                reject(new Error(`Command timed out after ${Math.round(timeoutMs! / 1000)} seconds and was terminated`));
                return;
            }

            if (code === 0) {
                resolve({ stdout, stderr });
                return;
            }

            const errorMessage = stderr.trim() || `Command exited with code ${code}`;
            reject(new Error(errorMessage));
        });
    });
}

/**
 * Invoke a single agent with a message. Contains all Claude/Codex invocation logic.
 * Returns the raw response text (or InvokeResult when interactive=true).
 *
 * @param interactive - Enable question bridge (disables AskUserQuestion, adds system prompt, captures session_id)
 * @param resumeSessionId - Resume a specific session instead of using -c (for question continuation rounds)
 */
export async function invokeAgent(
    agent: AgentConfig,
    agentId: string,
    message: string,
    workspacePath: string,
    shouldReset: boolean,
    agents: Record<string, AgentConfig> = {},
    teams: Record<string, TeamConfig> = {},
    interactive: boolean = false,
    resumeSessionId?: string
): Promise<InvokeResult> {
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

    // Read timeout from settings (default: 3 minutes)
    const settings = getSettings();
    const maxResponseTimeSec = settings?.monitoring?.max_response_time ?? 180;
    const timeoutMs = maxResponseTimeSec * 1000;

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

        const { stdout: codexOutput } = await runCommand('codex', codexArgs, workingDir, timeoutMs);

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

        return { response: response || 'Sorry, I could not generate a response from Codex.' };
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

        // Interactive mode: disable AskUserQuestion, inject question system prompt
        if (interactive) {
            claudeArgs.push(
                '--disallowed-tools', 'AskUserQuestion',
                '--append-system-prompt', QUESTION_PROMPT
            );
        }

        // Session resumption: --resume takes priority over -c
        if (resumeSessionId) {
            claudeArgs.push('--resume', resumeSessionId);
        } else if (continueConversation) {
            claudeArgs.push('-c');
        }

        // Use JSON output when interactive (to capture session_id)
        if (interactive) {
            claudeArgs.push('--output-format', 'json');
        }

        claudeArgs.push('-p', message);

        const { stdout, stderr } = await runCommand('claude', claudeArgs, workingDir, timeoutMs);

        // Parse response — JSON mode for interactive, plain text otherwise
        if (interactive && stdout.trim()) {
            try {
                const jsonResponse = JSON.parse(stdout.trim());
                const sessionId = jsonResponse.session_id || undefined;
                const responseText = jsonResponse.result || '';
                if (responseText) {
                    return { response: responseText, sessionId };
                }
                // Fall through to stderr extraction if result is empty
            } catch (e) {
                // JSON parse failed — treat as plain text
                log('WARN', `Failed to parse JSON output for agent ${agentId}, treating as plain text`);
                return { response: stdout };
            }
        }

        if (stdout.trim()) {
            return { response: stdout };
        }

        // Claude CLI sometimes outputs only to stderr when performing tool actions
        // (file edits, bash commands, etc.) without producing a text response on stdout.
        // Extract a meaningful summary from stderr as fallback.
        if (stderr.trim()) {
            log('WARN', `Claude returned empty stdout for agent ${agentId}, extracting from stderr (${stderr.length} chars)`);
            // stderr contains progress/status lines — return last meaningful portion
            const stderrLines = stderr.trim().split('\n').filter(l => l.trim());
            const lastLines = stderrLines.slice(-10).join('\n');
            return { response: lastLines || 'I completed the requested actions but had no text response to return.' };
        }

        return { response: 'I completed the requested actions but had no text response to return.' };
    }
}
