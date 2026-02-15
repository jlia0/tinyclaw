import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { AgentConfig, TeamConfig } from './types';
import { SCRIPT_DIR, resolveClaudeModel, resolveCodexModel } from './config';
import { log } from './logging';
import { ensureAgentDirectory, updateAgentTeammates } from './agent-setup';
import { cerebrasChatCompletion, resetCerebrasHistory } from './cerebras';

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

async function runCommandWithExitCode(
    command: string,
    args: string[],
    cwd?: string
): Promise<{ stdout: string; stderr: string; code: number | null }> {
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
            resolve({ stdout, stderr, code });
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

    if (provider === 'cerebras') {
        log('INFO', `Using Cerebras provider (agent: ${agentId})`);

        if (shouldReset) {
            resetCerebrasHistory(agentDir);
        }

        // Best-effort fallback: if user config requests an inaccessible model, fall back to qwen-3-32b.
        const preferredModel = agent.model || 'qwen-3-32b';
        try {
            return await cerebrasChatCompletion({
                agentDir,
                model: preferredModel,
                userMessage: message,
            });
        } catch (e) {
            const msg = (e as Error).message || '';
            const isModelNotFound = /does not exist|do not have access|model_not_found/i.test(msg);
            if (!isModelNotFound || preferredModel === 'qwen-3-32b') {
                throw e;
            }
            log('WARN', `Cerebras model "${preferredModel}" unavailable; falling back to qwen-3-32b (agent: ${agentId})`);
            return await cerebrasChatCompletion({
                agentDir,
                model: 'qwen-3-32b',
                userMessage: message,
            });
        }
    } else if (provider === 'openai') {
        log('INFO', `Using Codex CLI (agent: ${agentId})`);

        if (shouldReset) {
            log('INFO', `🔄 Resetting Codex conversation for agent: ${agentId}`);
        }

        const modelId = resolveCodexModel(agent.model);
        // Avoid `codex exec resume --last`: a corrupted local rollout state can make resume fail
        // and break the bot. Stateless `--ephemeral` is more reliable for chat bridges.
        const codexArgs = ['--ask-for-approval', 'never', 'exec', '--ephemeral'];
        if (modelId) {
            codexArgs.push('--model', modelId);
        }
        codexArgs.push('--skip-git-repo-check', '--sandbox', 'danger-full-access', '--json', message);

        const { stdout: codexStdout, stderr: codexStderr, code } = await runCommandWithExitCode('codex', codexArgs, workingDir);
        if (codexStderr.trim()) {
            const isRolloutWarn = /state db missing rollout path|codex_core::rollout::list/i.test(codexStderr);
            const level = isRolloutWarn ? 'WARN' : (code === 0 ? 'WARN' : 'ERROR');
            log(level as any, `Codex stderr (agent: ${agentId}): ${codexStderr.trim()}`);
        }

        // Parse JSONL output and extract final agent_message
        let response = '';
        const lines = codexStdout.trim().split('\n').filter(Boolean);
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

        if (response) return response;
        if (code && code !== 0) {
            throw new Error(codexStderr.trim() || `Codex exited with code ${code}`);
        }
        return 'Sorry, I could not generate a response from Codex.';
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
