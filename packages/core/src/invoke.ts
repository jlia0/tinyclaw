import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { AgentConfig, CustomProvider, TeamConfig } from './types';
import { SCRIPT_DIR, resolveClaudeModel, resolveCodexModel, resolveOpenCodeModel, getSettings } from './config';
import { log } from './logging';
import { ensureAgentDirectory, buildSystemPrompt } from './agent';

export async function runCommand(command: string, args: string[], cwd?: string, envOverrides?: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
        const env = { ...process.env, ...envOverrides };
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

    // Build system prompt in-memory (built-in instructions + teammates + user customization)
    const systemPrompt = buildSystemPrompt(agentId, agentDir, agents, teams, agent.system_prompt, agent.prompt_file);

    // Resolve working directory
    const workingDir = agent.working_directory
        ? (path.isAbsolute(agent.working_directory)
            ? agent.working_directory
            : path.join(workspacePath, agent.working_directory))
        : agentDir;

    const rawProvider = agent.provider || 'anthropic';

    // Resolve custom provider if using "custom:<id>" prefix
    let provider = rawProvider;
    let customProvider: CustomProvider | undefined;
    let envOverrides: Record<string, string> = {
        TINYCLAW_AGENT_ID: agentId,
    };

    if (rawProvider.startsWith('custom:')) {
        const customId = rawProvider.slice('custom:'.length);
        const settings = getSettings();
        customProvider = settings.custom_providers?.[customId];
        if (!customProvider) {
            throw new Error(`Custom provider '${customId}' not found in settings.custom_providers`);
        }
        // Map harness back to built-in provider for CLI selection
        provider = customProvider.harness === 'codex' ? 'openai' : 'anthropic';

        // Build env overrides based on harness
        if (customProvider.harness === 'claude') {
            envOverrides.ANTHROPIC_BASE_URL = customProvider.base_url;
            envOverrides.ANTHROPIC_AUTH_TOKEN = customProvider.api_key;
            envOverrides.ANTHROPIC_API_KEY = '';
        } else if (customProvider.harness === 'codex') {
            envOverrides.OPENAI_API_KEY = customProvider.api_key;
            envOverrides.OPENAI_BASE_URL = customProvider.base_url;
        }

        log('INFO', `Using custom provider '${customId}' (harness: ${customProvider.harness}, base_url: ${customProvider.base_url})`);
    } else {
        // For built-in providers, check if auth_token is configured in settings
        const settings = getSettings();
        if (provider === 'anthropic' && settings.models?.anthropic?.auth_token) {
            envOverrides.ANTHROPIC_API_KEY = settings.models.anthropic.auth_token;
        } else if (provider === 'openai' && settings.models?.openai?.auth_token) {
            envOverrides.OPENAI_API_KEY = settings.models.openai.auth_token;
        }
    }

    // Use model from custom provider if agent doesn't specify one
    const effectiveModel = agent.model || customProvider?.model || '';

    if (provider === 'openai') {
        log('INFO', `Using Codex CLI (agent: ${agentId})`);

        const shouldResume = !shouldReset;

        if (shouldReset) {
            log('INFO', `Resetting Codex conversation for agent: ${agentId}`);
        }

        const modelId = customProvider ? effectiveModel : resolveCodexModel(effectiveModel);
        const codexArgs = ['exec'];
        if (shouldResume) {
            codexArgs.push('resume', '--last');
        }
        if (modelId) {
            codexArgs.push('--model', modelId);
        }
        if (systemPrompt) {
            codexArgs.push('-c', `developer_instructions=${systemPrompt}`);
        }
        codexArgs.push('--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--json', message);

        const codexOutput = await runCommand('codex', codexArgs, workingDir, envOverrides);

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
        const modelId = resolveOpenCodeModel(effectiveModel);
        log('INFO', `Using OpenCode CLI (agent: ${agentId}, model: ${modelId})`);

        const continueConversation = !shouldReset;

        if (shouldReset) {
            log('INFO', `Resetting OpenCode conversation for agent: ${agentId}`);
        }

        // Pass system prompt via OPENCODE_CONFIG_CONTENT env var using a custom agent
        if (systemPrompt) {
            const configContent = JSON.stringify({
                agent: {
                    [agentId]: {
                        prompt: systemPrompt
                    }
                }
            });
            envOverrides.OPENCODE_CONFIG_CONTENT = configContent;
        }

        const opencodeArgs = ['run', '--format', 'json'];
        if (modelId) {
            opencodeArgs.push('--model', modelId);
        }
        if (systemPrompt) {
            opencodeArgs.push('--agent', agentId);
        }
        if (continueConversation) {
            opencodeArgs.push('-c');
        }
        opencodeArgs.push(message);

        const opencodeOutput = await runCommand('opencode', opencodeArgs, workingDir, envOverrides);

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
            log('INFO', `Resetting conversation for agent: ${agentId}`);
        }

        const modelId = customProvider ? effectiveModel : resolveClaudeModel(effectiveModel);
        const claudeArgs = ['--dangerously-skip-permissions'];
        if (modelId) {
            claudeArgs.push('--model', modelId);
        }
        if (systemPrompt) {
            claudeArgs.push('--system-prompt', systemPrompt);
        }
        if (continueConversation) {
            claudeArgs.push('-c');
        }
        claudeArgs.push('-p', message);

        return await runCommand('claude', claudeArgs, workingDir, envOverrides);
    }
}
