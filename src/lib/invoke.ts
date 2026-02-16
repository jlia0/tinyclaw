import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { AgentConfig, TeamConfig } from './types';
import { SCRIPT_DIR, getProviderConfig, resolveProviderModel } from './config';
import { log } from './logging';
import { ensureAgentDirectory, updateAgentTeammates } from './agent-setup';

type ArgContext = {
    message: string;
    model: string;
    cwd: string;
    resume: boolean;
};

function renderArg(arg: string, ctx: ArgContext): string {
    const conditional = arg.match(/^\{\{\?([a-zA-Z0-9_]+)\}\}(.*)$/);
    if (conditional) {
        const key = conditional[1]!;
        const value = (ctx as unknown as Record<string, unknown>)[key];
        if (!value) return '';
        arg = conditional[2] || '';
    }
    return arg
        .replace(/\{\{message\}\}/g, ctx.message)
        .replace(/\{\{model\}\}/g, ctx.model)
        .replace(/\{\{cwd\}\}/g, ctx.cwd)
        .replace(/\{\{resume\}\}/g, ctx.resume ? 'true' : '');
}

function buildArgs(baseArgs: string[], conditionalArgs: Record<string, string[]> | undefined, ctx: ArgContext): string[] {
    const args: string[] = [];
    for (const a of baseArgs) {
        const rendered = renderArg(a, ctx).trim();
        if (rendered) args.push(rendered);
    }
    if (conditionalArgs) {
        for (const [cond, list] of Object.entries(conditionalArgs)) {
            const condValue = (ctx as unknown as Record<string, unknown>)[cond];
            if (condValue) {
                for (const a of list) {
                    const rendered = renderArg(a, ctx).trim();
                    if (rendered) args.push(rendered);
                }
            }
        }
    }
    return args;
}

function getByPath(obj: unknown, pathStr: string): unknown {
    if (!obj || !pathStr) return undefined;
    const parts = pathStr.split('.');
    let cur: any = obj;
    for (const p of parts) {
        if (cur == null) return undefined;
        cur = cur[p];
    }
    return cur;
}

function parseJsonlOutput(output: string, match: Record<string, string> | undefined, field: string | undefined): string {
    if (!field) return '';
    let response = '';
    const lines = output.trim().split('\n');
    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const json = JSON.parse(line);
            let ok = true;
            if (match) {
                for (const [k, v] of Object.entries(match)) {
                    if (getByPath(json, k) !== v) {
                        ok = false;
                        break;
                    }
                }
            }
            if (ok) {
                const value = getByPath(json, field);
                if (typeof value === 'string') response = value;
            }
        } catch {
            // Ignore lines that aren't valid JSON
        }
    }
    return response;
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
    if (!fs.existsSync(workingDir)) {
        fs.mkdirSync(workingDir, { recursive: true });
        log('WARN', `Working directory did not exist; created: ${workingDir}`);
    }

    const provider = agent.provider || 'anthropic';
    const providerConfig = getProviderConfig(provider);
    if (!providerConfig) {
        throw new Error(`Unknown provider: ${provider}`);
    }

    const continueConversation = !shouldReset;
    if (shouldReset) {
        log('INFO', `🔄 Resetting conversation for agent: ${agentId}`);
    }

    log('INFO', `Using ${providerConfig.display_name} provider (agent: ${agentId})`);

    const modelId = resolveProviderModel(provider, agent.model);
    const ctx: ArgContext = {
        message,
        model: modelId,
        cwd: workingDir,
        resume: continueConversation,
    };

    const args = buildArgs(providerConfig.args, providerConfig.conditional_args, ctx);
    log('INFO', `Invoking ${providerConfig.display_name}: ${providerConfig.executable} ${args.join(' ')}`);
    const output = await runCommand(providerConfig.executable, args, workingDir);

    if (providerConfig.output?.type === 'jsonl') {
        const response = parseJsonlOutput(output, providerConfig.output.select?.match, providerConfig.output.select?.field);
        return response || `Sorry, I could not generate a response from ${providerConfig.display_name}.`;
    }

    return output;
}
