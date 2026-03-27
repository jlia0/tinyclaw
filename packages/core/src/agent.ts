import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AgentConfig, TeamConfig } from './types';
import { SCRIPT_DIR } from './config';
import { loadMemoryIndex } from './memory';
import { log } from './logging';

/**
 * Built-in agent instructions read from the AGENTS.md template at SCRIPT_DIR.
 * Teammate markers are replaced at runtime by buildSystemPrompt().
 */
export const BUILTIN_AGENT_INSTRUCTIONS = fs.readFileSync(path.join(SCRIPT_DIR, 'AGENTS.md'), 'utf8');
const BUILTIN_AGENT_INSTRUCTIONS_HASH = crypto
    .createHash('sha256')
    .update(BUILTIN_AGENT_INSTRUCTIONS)
    .digest('hex');

type PromptCacheEntry = { hash: string; prompt: string };
const systemPromptCache = new Map<string, PromptCacheEntry>();

function hashString(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Recursively copy directory
 */
export function copyDirSync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

/**
 * Sync default skills from SCRIPT_DIR into an agent workspace and ensure
 * .claude/skills is a symlink to .agents/skills (not a copy).
 */
export function syncAgentSkills(agentDir: string): void {
    const sourceSkills = path.join(SCRIPT_DIR, '.agents', 'skills');
    if (!fs.existsSync(sourceSkills)) return;

    // Copy default skills into .agents/skills (overwrites existing, preserves custom)
    const targetAgentsSkills = path.join(agentDir, '.agents', 'skills');
    fs.mkdirSync(targetAgentsSkills, { recursive: true });
    for (const entry of fs.readdirSync(sourceSkills, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dest = path.join(targetAgentsSkills, entry.name);
        fs.rmSync(dest, { recursive: true, force: true });
        copyDirSync(path.join(sourceSkills, entry.name), dest);
    }

    // Ensure .claude/skills is a symlink to ../.agents/skills
    const targetClaudeSkills = path.join(agentDir, '.claude', 'skills');
    fs.mkdirSync(path.join(agentDir, '.claude'), { recursive: true });

    // Remove whatever exists (real dir, stale symlink, or file) and replace with symlink
    try {
        const lstat = fs.lstatSync(targetClaudeSkills);
        if (lstat.isSymbolicLink()) {
            fs.unlinkSync(targetClaudeSkills);
        } else {
            fs.rmSync(targetClaudeSkills, { recursive: true, force: true });
        }
    } catch {
        // Doesn't exist — that's fine
    }

    fs.symlinkSync(path.join('..', '.agents', 'skills'), targetClaudeSkills);
}

/**
 * Ensure agent directory exists with template files from SCRIPT_DIR.
 * Safe to call on existing directories — will sync skills and ensure symlinks.
 */
export function ensureAgentDirectory(agentDir: string): void {
    const isNew = !fs.existsSync(agentDir);
    fs.mkdirSync(agentDir, { recursive: true });

    if (isNew) {
        // Copy .claude directory
        const sourceClaudeDir = path.join(SCRIPT_DIR, '.claude');
        if (fs.existsSync(sourceClaudeDir)) {
            copyDirSync(sourceClaudeDir, path.join(agentDir, '.claude'));
        }

        // Copy heartbeat.md
        const sourceHeartbeat = path.join(SCRIPT_DIR, 'heartbeat.md');
        if (fs.existsSync(sourceHeartbeat)) {
            fs.copyFileSync(sourceHeartbeat, path.join(agentDir, 'heartbeat.md'));
        }

        // Create empty AGENTS.md for user customization
        fs.writeFileSync(path.join(agentDir, 'AGENTS.md'), '');

        // Create .tinyagi directory and copy SOUL.md
        const targetTinyagi = path.join(agentDir, '.tinyagi');
        fs.mkdirSync(targetTinyagi, { recursive: true });
        const sourceSoul = path.join(SCRIPT_DIR, 'SOUL.md');
        if (fs.existsSync(sourceSoul)) {
            fs.copyFileSync(sourceSoul, path.join(targetTinyagi, 'SOUL.md'));
        }
    }

    // Create memory directory for hierarchical memory system
    fs.mkdirSync(path.join(agentDir, 'memory'), { recursive: true });

    // Always sync skills (keeps them up to date for both new and existing dirs)
    syncAgentSkills(agentDir);
}

/**
 * Build the full system prompt for an agent invocation.
 * Combines built-in instructions + teammate info + user's custom AGENTS.md + config system prompt.
 */
export function buildSystemPrompt(
    agentId: string,
    agentDir: string,
    agents: Record<string, AgentConfig>,
    teams: Record<string, TeamConfig>,
    configSystemPrompt?: string,
    configPromptFile?: string
): string {
    let prompt = BUILTIN_AGENT_INSTRUCTIONS;

    // Build teammate block
    const startMarker = '<!-- TEAMMATES_START -->';
    const endMarker = '<!-- TEAMMATES_END -->';

    // Collect teams this agent belongs to
    const agentTeams: { teamId: string; teamName: string; leaderId: string; members: { id: string; name: string; model: string }[] }[] = [];
    for (const [teamId, team] of Object.entries(teams)) {
        if (!team.agents.includes(agentId)) continue;
        const members: { id: string; name: string; model: string }[] = [];
        for (const tid of team.agents) {
            if (tid === agentId) continue;
            const agent = agents[tid];
            if (agent) {
                members.push({ id: tid, name: agent.name, model: agent.model });
            }
        }
        agentTeams.push({ teamId, teamName: team.name, leaderId: team.leader_agent, members });
    }

    let block = '';
    const self = agents[agentId];
    const isLeaderOfAny = agentTeams.some(t => t.leaderId === agentId);
    if (self) {
        const leaderTag = isLeaderOfAny ? ' *(team leader)*' : '';
        block += `\n### You\n\n- \`@${agentId}\` — **${self.name}** (${self.model})${leaderTag}\n`;
        block += `- Workspace: \`${agentDir}\`\n`;
    }
    if (agentTeams.length > 0) {
        for (const team of agentTeams) {
            block += `\n### Team \`#${team.teamId}\` — ${team.teamName}\n\n`;
            for (const t of team.members) {
                const leaderTag = t.id === team.leaderId ? ' *(team leader)*' : '';
                block += `- \`@${t.id}\` — **${t.name}** (${t.model})${leaderTag}\n`;
            }
        }
    }

    // Inject teammate block into the built-in instructions
    const startIdx = prompt.indexOf(startMarker);
    const endIdx = prompt.indexOf(endMarker);
    if (startIdx !== -1 && endIdx !== -1) {
        prompt = prompt.substring(0, startIdx + startMarker.length) + block + prompt.substring(endIdx);
    }

    // Inject memory index into the system prompt
    const memStartMarker = '<!-- MEMORY_START -->';
    const memEndMarker = '<!-- MEMORY_END -->';
    const memoryTree = loadMemoryIndex(agentDir);
    let memBlock = '';
    if (memoryTree) {
        memBlock = '\n' + memoryTree + '\n\n' +
            'To read a memory in detail, read the file at `memory/<path>`. ' +
            'Use the **memory** skill to create, update, or reorganize memories.\n';
    } else {
        memBlock = '\nNo memories yet. Use the **memory** skill to start building your memory.\n';
    }
    const memStartIdx = prompt.indexOf(memStartMarker);
    const memEndIdx = prompt.indexOf(memEndMarker);
    if (memStartIdx !== -1 && memEndIdx !== -1) {
        prompt = prompt.substring(0, memStartIdx + memStartMarker.length) + memBlock + prompt.substring(memEndIdx);
    }

    // Append user's custom AGENTS.md from agent workspace (if non-empty)
    const userAgentsMd = path.join(agentDir, 'AGENTS.md');
    let userContent = '';
    if (fs.existsSync(userAgentsMd)) {
        userContent = fs.readFileSync(userAgentsMd, 'utf8').trim();
        if (userContent) {
            prompt += '\n\n' + userContent;
        }
    }

    // Append config system prompt (from settings.json)
    let promptFileContent = '';
    if (configPromptFile) {
        try {
            promptFileContent = fs.readFileSync(configPromptFile, 'utf8').trim();
            if (promptFileContent) {
                prompt += '\n\n' + promptFileContent;
            }
        } catch {
            // Ignore missing prompt file
        }
    } else if (configSystemPrompt) {
        prompt += '\n\n' + configSystemPrompt;
    }

    const cacheInput = JSON.stringify({
        agentId,
        builtin: BUILTIN_AGENT_INSTRUCTIONS_HASH,
        teammateBlock: block,
        memoryTree,
        userContent,
        promptFileContent,
        configSystemPrompt: configSystemPrompt || '',
    });
    const cacheHash = hashString(cacheInput);
    const cached = systemPromptCache.get(agentId);
    if (!cached || cached.hash !== cacheHash) {
        log('DEBUG', `System prompt cache updated for agent: ${agentId}`);
        systemPromptCache.set(agentId, { hash: cacheHash, prompt });
    } else {
        return cached.prompt;
    }

    return prompt;
}
