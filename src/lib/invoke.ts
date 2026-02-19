import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { AgentConfig, Settings, TeamConfig } from './types';
import { SCRIPT_DIR, resolveClaudeModel, resolveCodexModel } from './config';
import { log } from './logging';
import { ensureAgentDirectory, updateAgentTeammates } from './agent-setup';
import { buildMemoryBlock } from './memory';

const CLAUDE_SYSTEM_FILENAME = 'CLAUDE.md';

function getClaudeSystemFilePath(workingDir: string): string {
    return path.join(workingDir, '.claude', CLAUDE_SYSTEM_FILENAME);
}

function injectClaudeMemory(systemFilePath: string, memoryBlock: string, agentId: string): () => void {
    const claudeDir = path.dirname(systemFilePath);
    fs.mkdirSync(claudeDir, { recursive: true });

    const existed = fs.existsSync(systemFilePath);
    const original = existed ? fs.readFileSync(systemFilePath, 'utf8') : '';
    const markerId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startMarker = `<!-- TINYCLAW_MEMORY_START:${markerId} -->`;
    const endMarker = `<!-- TINYCLAW_MEMORY_END:${markerId} -->`;
    const body = memoryBlock.trim();
    const runtimeSection = [
        startMarker,
        '## Runtime Memory Context',
        '',
        'Auto-generated for current invocation only.',
        '',
        body,
        '',
        endMarker,
    ].join('\n');
    const merged = original.trim().length > 0
        ? `${original.trimEnd()}\n\n${runtimeSection}`
        : runtimeSection;

    fs.writeFileSync(systemFilePath, merged, 'utf8');

    return () => {
        if (!fs.existsSync(systemFilePath)) {
            if (existed) {
                log('WARN', `Memory cleanup marker missing for @${agentId}: .claude/${CLAUDE_SYSTEM_FILENAME} disappeared during invoke`);
            }
            return;
        }

        const current = fs.readFileSync(systemFilePath, 'utf8');
        const startIdx = current.indexOf(startMarker);
        const endIdx = current.indexOf(endMarker, startIdx >= 0 ? startIdx : 0);
        if (startIdx < 0 || endIdx < 0) {
            log('WARN', `Memory cleanup marker missing for @${agentId}: skipped restore to avoid overwriting .claude/${CLAUDE_SYSTEM_FILENAME}`);
            return;
        }

        const endExclusive = endIdx + endMarker.length;
        const stripped = `${current.slice(0, startIdx)}${current.slice(endExclusive)}`;
        const normalized = stripped
            .replace(/\n{3,}/g, '\n\n')
            .replace(/^\s+|\s+$/g, '');

        if (!normalized) {
            if (existed) {
                fs.writeFileSync(systemFilePath, original, 'utf8');
            } else {
                fs.unlinkSync(systemFilePath);
            }
            return;
        }

        fs.writeFileSync(systemFilePath, `${normalized}\n`, 'utf8');
    };
}

function deleteLegacyClaudeMemoryFile(workingDir: string): void {
    const legacyPath = path.join(workingDir, '.claude', 'MEMORY.md');
    if (fs.existsSync(legacyPath)) {
        fs.unlinkSync(legacyPath);
    }
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
    sourceChannel: string,
    workspacePath: string,
    shouldReset: boolean,
    settings: Settings,
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

    const memoryBlock = await buildMemoryBlock(agentId, message, settings, sourceChannel);
    const provider = agent.provider || 'anthropic';

    if (provider === 'openai') {
        const messageForModel = memoryBlock ? `${message}${memoryBlock}` : message;
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
        codexArgs.push('--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--json', messageForModel);

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

        const systemFilePath = getClaudeSystemFilePath(workingDir);
        let restoreSystemFile: (() => void) | null = null;
        // Defensive cleanup from old MEMORY.md injection behavior.
        deleteLegacyClaudeMemoryFile(workingDir);
        try {
            if (memoryBlock) {
                restoreSystemFile = injectClaudeMemory(systemFilePath, memoryBlock, agentId);
                log('INFO', `Memory source injection for @${agentId}: .claude/${CLAUDE_SYSTEM_FILENAME} (runtime section)`);
            }
            return await runCommand('claude', claudeArgs, workingDir);
        } finally {
            if (restoreSystemFile) {
                restoreSystemFile();
            }
        }
    }
}
