import { spawn } from 'child_process';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { AgentConfig, TeamConfig } from './types';
import { SCRIPT_DIR, resolveClaudeModel, resolveCodexModel } from './config';
import { log, emitEvent } from './logging';
import { ensureAgentDirectory, updateAgentTeammates } from './agent-setup';
import { estimateTokens, insertTokenUsage, updateTokenUsageResponse, insertRateLimitCheck } from './db';

export async function runCommand(command: string, args: string[], cwd?: string, env?: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: cwd || SCRIPT_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: env ? { ...process.env, ...env } : undefined,
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

function inferTier(requestsLimit: number | null): string | null {
    if (requestsLimit === null) return null;
    if (requestsLimit <= 50) return 'Tier 1';
    if (requestsLimit <= 1000) return 'Tier 2';
    if (requestsLimit <= 2000) return 'Tier 3';
    if (requestsLimit <= 4000) return 'Tier 4';
    return `Unknown (RPM=${requestsLimit})`;
}

function parseIntOrNull(value: string | undefined): number | null {
    if (!value) return null;
    const n = parseInt(value, 10);
    return isNaN(n) ? null : n;
}

export async function checkAnthropicRateLimits(apiKey: string, model: string, agentId: string): Promise<void> {
    const body = JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
    });

    const headers = await new Promise<Record<string, string>>((resolve, reject) => {
        const req = https.request(
            {
                hostname: 'api.anthropic.com',
                path: '/v1/messages',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                },
            },
            (res) => {
                // Consume the body so the socket is freed
                res.resume();
                const h: Record<string, string> = {};
                for (const [key, val] of Object.entries(res.headers)) {
                    if (key.startsWith('anthropic-ratelimit-') && typeof val === 'string') {
                        h[key] = val;
                    }
                }
                resolve(h);
            }
        );

        req.on('error', reject);
        req.write(body);
        req.end();
    });

    const requestsLimit = parseIntOrNull(headers['anthropic-ratelimit-requests-limit']);
    const requestsRemaining = parseIntOrNull(headers['anthropic-ratelimit-requests-remaining']);
    const requestsReset = headers['anthropic-ratelimit-requests-reset'] || null;
    const inputTokensLimit = parseIntOrNull(headers['anthropic-ratelimit-input-tokens-limit']);
    const inputTokensRemaining = parseIntOrNull(headers['anthropic-ratelimit-input-tokens-remaining']);
    const inputTokensReset = headers['anthropic-ratelimit-input-tokens-reset'] || null;
    const outputTokensLimit = parseIntOrNull(headers['anthropic-ratelimit-output-tokens-limit']);
    const outputTokensRemaining = parseIntOrNull(headers['anthropic-ratelimit-output-tokens-remaining']);
    const outputTokensReset = headers['anthropic-ratelimit-output-tokens-reset'] || null;

    const inferredTier = inferTier(requestsLimit);

    insertRateLimitCheck({
        agentId,
        model,
        requestsLimit,
        requestsRemaining,
        requestsReset,
        inputTokensLimit,
        inputTokensRemaining,
        inputTokensReset,
        outputTokensLimit,
        outputTokensRemaining,
        outputTokensReset,
        inferredTier,
    });

    log('INFO', `Rate limits checked — agent: ${agentId}, tier: ${inferredTier ?? 'unknown'}, RPM: ${requestsLimit ?? '?'}`);

    emitEvent('rate_limits_updated', {
        agentId,
        model,
        inferredTier,
        requestsLimit,
        requestsRemaining,
        requestsReset,
        inputTokensLimit,
        inputTokensRemaining,
        inputTokensReset,
        outputTokensLimit,
        outputTokensRemaining,
        outputTokensReset,
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

    // Token usage tracking — pre-invocation
    let usageRowId: number | null = null;
    const startTime = Date.now();
    try {
        const inputTokens = estimateTokens(message);
        usageRowId = insertTokenUsage({
            agentId,
            provider,
            model: agent.model || '',
            messageCharCount: message.length,
            estimatedInputTokens: inputTokens,
        });
    } catch (e) {
        log('WARN', `Token tracking insert failed: ${(e as Error).message}`);
    }

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

        const codexOutput = await runCommand('codex', codexArgs, workingDir, agent.env);

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

        const finalResponse = response || 'Sorry, I could not generate a response from Codex.';

        // Token usage tracking — post-invocation
        if (usageRowId !== null) {
            try {
                const durationMs = Date.now() - startTime;
                updateTokenUsageResponse(usageRowId, finalResponse.length, estimateTokens(finalResponse), durationMs);
            } catch (e) {
                log('WARN', `Token tracking update failed: ${(e as Error).message}`);
            }
        }

        return finalResponse;
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

        const claudeResponse = await runCommand('claude', claudeArgs, workingDir, agent.env);

        // Token usage tracking — post-invocation
        if (usageRowId !== null) {
            try {
                const durationMs = Date.now() - startTime;
                updateTokenUsageResponse(usageRowId, claudeResponse.length, estimateTokens(claudeResponse), durationMs);
            } catch (e) {
                log('WARN', `Token tracking update failed: ${(e as Error).message}`);
            }
        }

        // Check API rate limits after invocation (only when no custom env is set)
        if (!agent.env) {
            const apiKey = process.env.ANTHROPIC_API_KEY;
            if (apiKey) {
                try {
                    await checkAnthropicRateLimits(apiKey, modelId || 'claude-sonnet-4-20250514', agentId);
                } catch (e) {
                    log('WARN', `Rate limit check failed: ${(e as Error).message}`);
                }
            }
        }

        return claudeResponse;
    }
}
