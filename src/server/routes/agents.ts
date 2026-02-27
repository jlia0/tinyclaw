import fs from 'fs';
import path from 'path';
import { Hono } from 'hono';
import { AgentConfig } from '../../lib/types';
import { SCRIPT_DIR, getSettings, getAgents } from '../../lib/config';
import { log } from '../../lib/logging';
import { mutateSettings } from './settings';

const app = new Hono();

// ── Agent workspace provisioning ─────────────────────────────────────────────

function copyIfExists(src: string, dest: string): boolean {
    if (!fs.existsSync(src)) return false;
    if (fs.statSync(src).isDirectory()) {
        fs.cpSync(src, dest, { recursive: true });
    } else {
        fs.copyFileSync(src, dest);
    }
    return true;
}

function provisionAgentWorkspace(agentDir: string, _agentId: string): string[] {
    const steps: string[] = [];
    fs.mkdirSync(agentDir, { recursive: true });
    steps.push(`Created directory ${agentDir}`);

    const claudeSrc = path.join(SCRIPT_DIR, '.claude');
    if (fs.existsSync(claudeSrc)) {
        copyIfExists(claudeSrc, path.join(agentDir, '.claude'));
        steps.push('Copied .claude/');
    } else {
        fs.mkdirSync(path.join(agentDir, '.claude'), { recursive: true });
        steps.push('Created .claude/');
    }

    if (copyIfExists(path.join(SCRIPT_DIR, 'heartbeat.md'), path.join(agentDir, 'heartbeat.md'))) {
        steps.push('Copied heartbeat.md');
    }

    const agentsMd = path.join(SCRIPT_DIR, 'AGENTS.md');
    if (copyIfExists(agentsMd, path.join(agentDir, 'AGENTS.md'))) {
        steps.push('Copied AGENTS.md');
    }

    if (fs.existsSync(agentsMd)) {
        fs.copyFileSync(agentsMd, path.join(agentDir, '.claude', 'CLAUDE.md'));
        steps.push('Copied CLAUDE.md to .claude/');
    }

    // Copy default skills from SCRIPT_DIR
    const skillsSrc = path.join(SCRIPT_DIR, '.agents', 'skills');
    if (fs.existsSync(skillsSrc)) {
        const targetAgentsSkills = path.join(agentDir, '.agents', 'skills');
        fs.mkdirSync(targetAgentsSkills, { recursive: true });
        fs.cpSync(skillsSrc, targetAgentsSkills, { recursive: true });
        steps.push('Copied skills to .agents/skills/');

        // Mirror into .claude/skills for Claude Code
        const targetClaudeSkills = path.join(agentDir, '.claude', 'skills');
        fs.mkdirSync(targetClaudeSkills, { recursive: true });
        fs.cpSync(targetAgentsSkills, targetClaudeSkills, { recursive: true });
        steps.push('Copied skills to .claude/skills/');
    }

    fs.mkdirSync(path.join(agentDir, '.tinyclaw'), { recursive: true });
    if (copyIfExists(path.join(SCRIPT_DIR, 'SOUL.md'), path.join(agentDir, '.tinyclaw', 'SOUL.md'))) {
        steps.push('Copied SOUL.md to .tinyclaw/');
    }

    return steps;
}

// GET /api/agents
app.get('/api/agents', (c) => {
    return c.json(getAgents(getSettings()));
});

// PUT /api/agents/:id
app.put('/api/agents/:id', async (c) => {
    const agentId = c.req.param('id');
    const body = await c.req.json() as Partial<AgentConfig>;
    if (!body.name || !body.provider || !body.model) {
        return c.json({ error: 'name, provider, and model are required' }, 400);
    }

    const currentSettings = getSettings();
    const isNew = !currentSettings.agents?.[agentId];

    const workspacePath = currentSettings.workspace?.path
        || path.join(require('os').homedir(), 'tinyclaw-workspace');
    const workingDir = body.working_directory || path.join(workspacePath, agentId);

    const settings = mutateSettings(s => {
        if (!s.agents) s.agents = {};
        s.agents[agentId] = {
            name: body.name!,
            provider: body.provider!,
            model: body.model!,
            working_directory: workingDir,
            ...(body.system_prompt ? { system_prompt: body.system_prompt } : {}),
            ...(body.prompt_file ? { prompt_file: body.prompt_file } : {}),
        };
    });

    let provisionSteps: string[] = [];
    if (isNew) {
        try {
            provisionSteps = provisionAgentWorkspace(workingDir, agentId);
            log('INFO', `[API] Agent '${agentId}' provisioned: ${provisionSteps.join(', ')}`);
        } catch (err) {
            log('ERROR', `[API] Agent '${agentId}' provisioning failed: ${(err as Error).message}`);
        }
    }

    log('INFO', `[API] Agent '${agentId}' saved`);
    return c.json({
        ok: true,
        agent: settings.agents![agentId],
        provisioned: isNew,
        provisionSteps,
    });
});

// DELETE /api/agents/:id
app.delete('/api/agents/:id', (c) => {
    const agentId = c.req.param('id');
    const settings = getSettings();
    if (!settings.agents?.[agentId]) {
        return c.json({ error: `agent '${agentId}' not found` }, 404);
    }
    mutateSettings(s => { delete s.agents![agentId]; });
    log('INFO', `[API] Agent '${agentId}' deleted`);
    return c.json({ ok: true });
});

export default app;
