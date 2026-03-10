import { spawn } from 'child_process';
import { createInterface } from 'readline';
import fs from 'fs';
import path from 'path';
import { AgentConfig, TeamConfig } from './types';
import { SCRIPT_DIR, resolveClaudeModel, resolveCodexModel, resolveOpenCodeModel } from './config';
import { log } from './logging';
import { ensureAgentDirectory, updateAgentTeammates } from './agent';

export async function runCommand(command: string, args: string[], cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const env = { ...process.env };
        delete env.CLAUDECODE;
        const child = spawn(command, args, {
            cwd: cwd || SCRIPT_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
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
 * Returns the raw response text.
 */
export async function invokeAgent(
    agent: AgentConfig,
    agentId: string,
    message: string,
    workspacePath: string,
    shouldReset: boolean,
    agents: Record<string, AgentConfig> = {},
    teams: Record<string, TeamConfig> = {}
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

        const opencodeOutput = await runCommand('opencode', opencodeArgs, workingDir);

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

        return await runCommand('claude', claudeArgs, workingDir);
    }
}

/**
 * Run a command and stream stdout line-by-line as data arrives.
 * Uses `script -qec` to allocate a PTY so the child process flushes
 * output line-by-line instead of buffering until exit.
 * Calls onLine(line) for each complete line. Returns full output on close.
 */
export async function runCommandStreaming(
    command: string,
    args: string[],
    cwd: string | undefined,
    onLine: (line: string) => void
): Promise<string> {
    return new Promise((resolve, reject) => {
        const env = { ...process.env };
        delete env.CLAUDECODE;

        // Build the full command string for script -qec
        const escapedArgs = args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
        const fullCmd = `${command} ${escapedArgs}`;

        const child = spawn('script', ['-qec', fullCmd, '/dev/null'], {
            cwd: cwd || SCRIPT_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
        });

        let allLines = '';

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        // With PTY via script, all output comes through stdout
        const rl = createInterface({ input: child.stdout });
        rl.on('line', (line) => {
            // Filter out script control sequences and non-JSON lines
            const trimmed = line.replace(/\r$/, '').replace(/[\x00-\x09\x0b-\x1f]|\x1b\[[^a-zA-Z]*[a-zA-Z]|\x1b\][^\x07]*\x07/g, '').trim();
            if (!trimmed || !trimmed.startsWith('{')) return;
            allLines += trimmed + '\n';
            onLine(trimmed);
        });

        let stderr = '';
        child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
        });

        child.on('error', (error) => {
            rl.close();
            reject(error);
        });

        child.on('close', (code) => {
            rl.close();
            // stream-json may exit non-zero; check if we got a result line
            const hasResult = allLines.includes('"type":"result"');
            if (code === 0 || hasResult) {
                resolve(allLines);
                return;
            }
            const errorMessage = stderr.trim() || allLines.trim() || `Command exited with code ${code}`;
            reject(new Error(errorMessage));
        });
    });
}

/**
 * Invoke a Claude/Anthropic agent with streaming JSON output.
 * Each stdout line is passed to onStreamLine for real-time processing.
 * Falls back to invokeAgent for non-Anthropic providers.
 */
export async function invokeAgentStreaming(
    agent: AgentConfig,
    agentId: string,
    message: string,
    workspacePath: string,
    shouldReset: boolean,
    agents: Record<string, AgentConfig>,
    teams: Record<string, TeamConfig>,
    onStreamLine: (line: string) => void
): Promise<string> {
    const provider = agent.provider || 'anthropic';

    // Only Anthropic/Claude supports stream-json; fall back for others
    if (provider !== 'anthropic') {
        return invokeAgent(agent, agentId, message, workspacePath, shouldReset, agents, teams);
    }

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

    log('INFO', `Using Claude provider with streaming (agent: ${agentId})`);

    const continueConversation = !shouldReset;
    if (shouldReset) {
        log('INFO', `🔄 Resetting conversation for agent: ${agentId}`);
    }

    const modelId = resolveClaudeModel(agent.model);
    const claudeArgs = ['--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose'];
    if (modelId) {
        claudeArgs.push('--model', modelId);
    }
    if (continueConversation) {
        claudeArgs.push('-c');
    }
    claudeArgs.push('-p', message);

    const fullOutput = await runCommandStreaming('claude', claudeArgs, workingDir, onStreamLine);

    // Extract final response from the result line
    const lines = fullOutput.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        try {
            const json = JSON.parse(lines[i]);
            if (json.type === 'result' && json.subtype === 'success' && json.result) {
                return json.result;
            }
        } catch {
            // not JSON, skip
        }
    }

    // Fallback: look for the last assistant text content
    for (let i = lines.length - 1; i >= 0; i--) {
        try {
            const json = JSON.parse(lines[i]);
            if (json.type === 'assistant' && Array.isArray(json.content)) {
                for (const block of json.content) {
                    if (block.type === 'text' && block.text) {
                        return block.text;
                    }
                }
            }
        } catch {
            // not JSON, skip
        }
    }

    return fullOutput;
}
