import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AgentConfig, TeamConfig } from './types';
import { SCRIPT_DIR, resolveClaudeModel, resolveCodexModel, resolveOpenCodeModel } from './config';
import { log } from './logging';
import { ensureAgentDirectory, updateAgentTeammates } from './agent';

const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface RunCommandOptions {
    cwd?: string;
    timeoutMs?: number;
    onOutput?: (chunk: string) => void; // called on each stdout chunk
}

// Ensure ~/.local/bin and ~/bin are in PATH for spawned processes
const HOME = os.homedir();
const extraPaths = [
    path.join(HOME, '.local', 'bin'),
    path.join(HOME, 'bin'),
    '/usr/local/bin',
].filter(p => fs.existsSync(p));
const spawnPath = [...extraPaths, process.env.PATH].join(':');

export async function runCommand(command: string, args: string[], cwd?: string, timeoutMs?: number): Promise<string>;
export async function runCommand(command: string, args: string[], opts?: RunCommandOptions): Promise<string>;
export async function runCommand(command: string, args: string[], cwdOrOpts?: string | RunCommandOptions, timeoutMs?: number): Promise<string> {
    const opts: RunCommandOptions = typeof cwdOrOpts === 'string'
        ? { cwd: cwdOrOpts, timeoutMs }
        : (cwdOrOpts || {});

    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: opts.cwd || SCRIPT_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, PATH: spawnPath },
        });

        let stdout = '';
        let stderr = '';
        let killed = false;

        const effectiveTimeout = opts.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;

        const timeout = setTimeout(() => {
            killed = true;
            child.kill('SIGTERM');
            // Force kill if SIGTERM doesn't work after 5s
            setTimeout(() => {
                if (!child.killed) child.kill('SIGKILL');
            }, 5000);
        }, effectiveTimeout);

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
            if (opts.onOutput) opts.onOutput(chunk);
        });

        child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
        });

        child.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });

        child.on('close', (code) => {
            clearTimeout(timeout);

            if (killed) {
                reject(new Error(`Command timed out after ${effectiveTimeout / 1000}s and was killed`));
                return;
            }

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
 * Returns the raw response text.
 */
export interface InvokeOptions {
    onOutput?: (chunk: string) => void;
}

export async function invokeAgent(
    agent: AgentConfig,
    agentId: string,
    message: string,
    workspacePath: string,
    shouldReset: boolean,
    agents: Record<string, AgentConfig> = {},
    teams: Record<string, TeamConfig> = {},
    options: InvokeOptions = {}
): Promise<string> {
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

        const codexOutput = await runCommand('codex', codexArgs, { cwd: workingDir, timeoutMs: (agent.timeout || 300) * 1000, onOutput: options.onOutput });

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

        return response || 'Sorry, I could not generate a response from Codex.';
    } else if (provider === 'opencode') {
        // OpenCode CLI — non-interactive mode via `opencode run`.
        // Outputs JSONL with --format json; extract "text" type events for the response.
        // Model passed via --model in provider/model format (e.g. opencode/claude-sonnet-4-5).
        // Supports -c flag for conversation continuation (resumes last session).
        const modelId = resolveOpenCodeModel(agent.model);
        log('INFO', `Using OpenCode CLI (agent: ${agentId}, model: ${modelId})`);

        const continueConversation = !shouldReset;

        if (shouldReset) {
            log('INFO', `🔄 Resetting OpenCode conversation for agent: ${agentId}`);
        }

        const opencodeArgs = ['run', '--format', 'json'];
        if (modelId) {
            opencodeArgs.push('--model', modelId);
        }
        if (continueConversation) {
            opencodeArgs.push('-c');
        }
        opencodeArgs.push(message);

        const opencodeOutput = await runCommand('opencode', opencodeArgs, { cwd: workingDir, timeoutMs: (agent.timeout || 300) * 1000, onOutput: options.onOutput });

        // Parse JSONL output and collect all text parts
        let response = '';
        const lines = opencodeOutput.trim().split('\n');
        for (const line of lines) {
            try {
                const json = JSON.parse(line);
                if (json.type === 'text' && json.part?.text) {
                    response = json.part.text;
                }
            } catch (e) {
                // Ignore lines that aren't valid JSON
            }
        }

        return response || 'Sorry, I could not generate a response from OpenCode.';
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

        return await runCommand('claude', claudeArgs, { cwd: workingDir, timeoutMs: (agent.timeout || 300) * 1000, onOutput: options.onOutput });
    }
}
