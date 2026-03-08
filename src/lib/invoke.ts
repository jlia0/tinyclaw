import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { AgentConfig, TeamConfig } from './types';
import { SCRIPT_DIR, resolveClaudeModel, resolveCodexModel, resolveOpenCodeModel, resolveApiKey, getProviderBaseUrl, getSettings } from './config';
import { log } from './logging';
import { ensureAgentDirectory, updateAgentTeammates } from './agent';

export async function runCommand(
    command: string,
    args: string[],
    cwd?: string,
    extraEnv?: Record<string, string | undefined>
): Promise<string> {
    return new Promise((resolve, reject) => {
        const env: Record<string, string | undefined> = { ...process.env, ...extraEnv };
        delete env.CLAUDECODE;

        const child = spawn(command, args, {
            cwd: cwd || SCRIPT_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: env as NodeJS.ProcessEnv,
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
    } else if (provider === 'kimi' || provider === 'minimax') {
        // Kimi/MiniMax - Claude Code with custom API endpoint
        const providerName = provider === 'kimi' ? 'Kimi' : 'MiniMax';
        log('INFO', `Using ${providerName} provider (agent: ${agentId})`);

        const continueConversation = !shouldReset;

        if (shouldReset) {
            log('INFO', `🔄 Resetting ${providerName} conversation for agent: ${agentId}`);
        }

        // Resolve API key with two-level fallback
        const settings = getSettings();
        const apiKey = resolveApiKey(agent, settings);

        if (!apiKey) {
            throw new Error(
                `No API key found for ${providerName}.\n` +
                `Run: tinyclaw provider ${provider} --api-key <key>\n` +
                `Or: tinyclaw agent provider ${agentId} ${provider} --api-key <key>`
            );
        }

        // Set up environment for Kimi/MiniMax
        const baseUrl = getProviderBaseUrl(provider);
        const modelId = agent.model;

        // Build extra env vars for runCommand
        const extraEnv: Record<string, string | undefined> = {
            ANTHROPIC_API_KEY: apiKey,
            ANTHROPIC_AUTH_TOKEN: undefined,  // clear any inherited value
            ANTHROPIC_BASE_URL: baseUrl,
            ANTHROPIC_MODEL: modelId,
            ANTHROPIC_DEFAULT_SONNET_MODEL: modelId,
            ANTHROPIC_DEFAULT_OPUS_MODEL: modelId,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: modelId,
            ANTHROPIC_SMALL_FAST_MODEL: modelId,
            API_TIMEOUT_MS: '3000000',
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
            CLAUDE_CONFIG_DIR: path.join(agentDir, '.claude'),
        };

        const claudeArgs = ['--dangerously-skip-permissions'];
        if (modelId) {
            claudeArgs.push('--model', modelId);
        }
        if (continueConversation) {
            claudeArgs.push('-c');
        }
        claudeArgs.push('-p', message);

        // Run claude with custom env using runCommand
        try {
            return await runCommand('claude', claudeArgs, workingDir, extraEnv);
        } catch (error) {
            const errorMsg = (error as Error).message;
            if (errorMsg.includes('401') || errorMsg.includes('authentication') || errorMsg.includes('Unauthorized')) {
                throw new Error(
                    `${providerName} API authentication failed.\n` +
                    `Your API key may be invalid or expired.\n` +
                    `Run: tinyclaw provider ${provider} --api-key <new-key>`
                );
            }
            throw error;
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

        return await runCommand('claude', claudeArgs, workingDir);
    }
}
