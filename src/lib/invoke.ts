import fs from 'fs';
import path from 'path';
import { AgentConfig, Settings, TeamConfig } from './types';
import { getSandboxConfig, resolveClaudeModel, resolveCodexModel, getSettings } from './config';
import { log, emitEvent } from './logging';
import { ensureAgentDirectory, updateAgentTeammates } from './agent-setup';
import { runInSandbox, SandboxInvocationError, SandboxPathMapping } from './runner';

export interface AgentInvocationResult {
    response: string;
    pathMappings: SandboxPathMapping[];
    sandboxMode: 'host' | 'docker' | 'apple';
}

let sandboxActive = 0;
const sandboxWaiters: Array<() => void> = [];

async function withSandboxPermit<T>(limit: number, fn: () => Promise<T>): Promise<T> {
    if (limit <= 0) {
        return fn();
    }

    if (sandboxActive >= limit) {
        await new Promise<void>((resolve) => sandboxWaiters.push(resolve));
    }
    sandboxActive += 1;

    try {
        return await fn();
    } finally {
        sandboxActive = Math.max(0, sandboxActive - 1);
        const next = sandboxWaiters.shift();
        if (next) next();
    }
}

function parseCodexResponse(codexOutput: string): string {
    let response = '';
    const lines = codexOutput.trim().split('\n');
    for (const line of lines) {
        try {
            const json = JSON.parse(line);
            if (json.type === 'item.completed' && json.item?.type === 'agent_message') {
                response = json.item.text;
            }
        } catch {
            // Ignore lines that are not valid JSON.
        }
    }
    return response || 'Sorry, I could not generate a response from Codex.';
}

/**
 * Invoke a single agent with a message. Contains all Claude/Codex invocation logic.
 * Returns response text plus optional sandbox path mappings for containerized runs.
 */
export async function invokeAgent(
    agent: AgentConfig,
    agentId: string,
    message: string,
    workspacePath: string,
    shouldReset: boolean,
    agents: Record<string, AgentConfig> = {},
    teams: Record<string, TeamConfig> = {},
    settings?: Settings
): Promise<AgentInvocationResult> {
    // Ensure agent directory exists with config files.
    const agentDir = path.join(workspacePath, agentId);
    const isNewAgent = !fs.existsSync(agentDir);
    ensureAgentDirectory(agentDir);
    if (isNewAgent) {
        log('INFO', `Initialized agent directory with config files: ${agentDir}`);
    }

    // Update AGENTS.md with current teammate info.
    updateAgentTeammates(agentDir, agentId, agents, teams);

    // Resolve working directory.
    const workingDir = agent.working_directory
        ? (path.isAbsolute(agent.working_directory)
            ? agent.working_directory
            : path.join(workspacePath, agent.working_directory))
        : agentDir;

    const provider = (agent.provider || 'anthropic') as 'anthropic' | 'openai';
    const mergedSettings = settings || getSettings();
    const sandbox = getSandboxConfig(mergedSettings, agent);

    let command = '';
    let args: string[] = [];

    if (provider === 'openai') {
        log('INFO', `Using Codex provider (agent: ${agentId})`);

        if (shouldReset) {
            log('INFO', `🔄 Resetting Codex conversation for agent: ${agentId}`);
        }

        const modelId = resolveCodexModel(agent.model);
        const shouldResume = !shouldReset;
        const codexArgs = ['exec'];
        if (shouldResume) {
            codexArgs.push('resume', '--last');
        }
        if (modelId) {
            codexArgs.push('--model', modelId);
        }
        codexArgs.push('--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--json', message);
        command = 'codex';
        args = codexArgs;
    } else {
        log('INFO', `Using Claude provider (agent: ${agentId})`);

        if (shouldReset) {
            log('INFO', `🔄 Resetting conversation for agent: ${agentId}`);
        }

        const modelId = resolveClaudeModel(agent.model);
        const continueConversation = !shouldReset;
        const claudeArgs = ['--dangerously-skip-permissions'];
        if (modelId) {
            claudeArgs.push('--model', modelId);
        }
        if (continueConversation) {
            claudeArgs.push('-c');
        }
        claudeArgs.push('-p', message);
        command = 'claude';
        args = claudeArgs;
    }

    emitEvent('sandbox_invocation_start', {
        agentId,
        provider,
        mode: sandbox.mode,
        workingDir,
    });

    const startedAt = Date.now();

    try {
        const result = await withSandboxPermit(sandbox.mode === 'host' ? 0 : sandbox.max_concurrency, async () => {
            return runInSandbox({
                agentId,
                provider,
                command,
                args,
                workingDir,
                sandbox,
            });
        });

        emitEvent('sandbox_invocation_end', {
            agentId,
            provider,
            mode: result.mode,
            durationMs: result.durationMs,
            responseBytes: result.stdout.length,
        });

        const response = provider === 'openai'
            ? parseCodexResponse(result.stdout)
            : result.stdout;

        return {
            response,
            pathMappings: result.pathMappings,
            sandboxMode: result.mode,
        };
    } catch (error) {
        const durationMs = Date.now() - startedAt;
        const err = error instanceof SandboxInvocationError
            ? error
            : new SandboxInvocationError((error as Error).message, {
                classification: 'transient',
                mode: sandbox.mode,
                userMessage: 'Sandbox execution failed unexpectedly. Please retry.',
            });

        emitEvent('sandbox_invocation_error', {
            agentId,
            provider,
            mode: err.mode,
            durationMs,
            classification: err.classification,
            message: err.message.slice(0, 240),
        });
        throw err;
    }
}
