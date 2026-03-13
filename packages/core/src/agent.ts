import fs from 'fs';
import path from 'path';
import { AgentConfig, TeamConfig } from './types';
import { SCRIPT_DIR } from './config';

/**
 * Built-in agent instructions read from the AGENTS.md template at SCRIPT_DIR.
 * Teammate markers are replaced at runtime by buildSystemPrompt().
 */
export const BUILTIN_AGENT_INSTRUCTIONS = fs.readFileSync(path.join(SCRIPT_DIR, 'AGENTS.md'), 'utf8');

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
 * Ensure agent directory exists with template files copied from TINYCLAW_HOME.
 * Creates directory if it doesn't exist. Creates an empty AGENTS.md for user customization.
 * The built-in instructions are now passed via system prompt at invocation time.
 */
export function ensureAgentDirectory(agentDir: string): void {
    if (fs.existsSync(agentDir)) {
        return; // Directory already exists
    }

    fs.mkdirSync(agentDir, { recursive: true });

    // Copy .claude directory
    const sourceClaudeDir = path.join(SCRIPT_DIR, '.claude');
    const targetClaudeDir = path.join(agentDir, '.claude');
    if (fs.existsSync(sourceClaudeDir)) {
        copyDirSync(sourceClaudeDir, targetClaudeDir);
    }

    // Copy heartbeat.md
    const sourceHeartbeat = path.join(SCRIPT_DIR, 'heartbeat.md');
    const targetHeartbeat = path.join(agentDir, 'heartbeat.md');
    if (fs.existsSync(sourceHeartbeat)) {
        fs.copyFileSync(sourceHeartbeat, targetHeartbeat);
    }

    // Create empty AGENTS.md for user customization
    fs.writeFileSync(path.join(agentDir, 'AGENTS.md'), '');

    // Copy default skills from SCRIPT_DIR into .agents/skills
    const sourceSkills = path.join(SCRIPT_DIR, '.agents', 'skills');
    if (fs.existsSync(sourceSkills)) {
        const targetAgentsSkills = path.join(agentDir, '.agents', 'skills');
        fs.mkdirSync(targetAgentsSkills, { recursive: true });
        copyDirSync(sourceSkills, targetAgentsSkills);

        // Mirror into .claude/skills for Claude Code
        const targetClaudeSkills = path.join(agentDir, '.claude', 'skills');
        fs.mkdirSync(targetClaudeSkills, { recursive: true });
        copyDirSync(targetAgentsSkills, targetClaudeSkills);
    }

    // Create .tinyclaw directory and copy SOUL.md
    const targetTinyclaw = path.join(agentDir, '.tinyclaw');
    fs.mkdirSync(targetTinyclaw, { recursive: true });
    const sourceSoul = path.join(SCRIPT_DIR, 'SOUL.md');
    if (fs.existsSync(sourceSoul)) {
        fs.copyFileSync(sourceSoul, path.join(targetTinyclaw, 'SOUL.md'));
    }
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

    const teammates: { id: string; name: string; model: string }[] = [];
    for (const team of Object.values(teams)) {
        if (!team.agents.includes(agentId)) continue;
        for (const tid of team.agents) {
            if (tid === agentId) continue;
            const agent = agents[tid];
            if (agent && !teammates.some(t => t.id === tid)) {
                teammates.push({ id: tid, name: agent.name, model: agent.model });
            }
        }
    }

    let block = '';
    const self = agents[agentId];
    if (self) {
        block += `\n### You\n\n- \`@${agentId}\` — **${self.name}** (${self.model})\n`;
    }
    if (teammates.length > 0) {
        block += '\n### Your Teammates\n\n';
        for (const t of teammates) {
            block += `- \`@${t.id}\` — **${t.name}** (${t.model})\n`;
        }
    }

    // Inject teammate block into the built-in instructions
    const startIdx = prompt.indexOf(startMarker);
    const endIdx = prompt.indexOf(endMarker);
    if (startIdx !== -1 && endIdx !== -1) {
        prompt = prompt.substring(0, startIdx + startMarker.length) + block + prompt.substring(endIdx);
    }

    // Append user's custom AGENTS.md from agent workspace (if non-empty)
    const userAgentsMd = path.join(agentDir, 'AGENTS.md');
    if (fs.existsSync(userAgentsMd)) {
        const userContent = fs.readFileSync(userAgentsMd, 'utf8').trim();
        if (userContent) {
            prompt += '\n\n' + userContent;
        }
    }

    // Append config system prompt (from settings.json)
    if (configPromptFile) {
        try {
            const promptFileContent = fs.readFileSync(configPromptFile, 'utf8').trim();
            if (promptFileContent) {
                prompt += '\n\n' + promptFileContent;
            }
        } catch {
            // Ignore missing prompt file
        }
    } else if (configSystemPrompt) {
        prompt += '\n\n' + configSystemPrompt;
    }

    return prompt;
}
