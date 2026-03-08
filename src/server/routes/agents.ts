import path from 'path';
import { Hono } from 'hono';
import { AgentConfig } from '../../lib/types';
import { WORKSPACE_DEFAULT_PATH, getSettings, getAgents } from '../../lib/config';
import { log } from '../../lib/logging';
import { ensureAgentDirectory } from '../../lib/agent';
import { mutateSettings } from './settings';

const app = new Hono();

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

    const workspacePath = currentSettings.workspace?.path || WORKSPACE_DEFAULT_PATH;
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

    if (isNew) {
        try {
            ensureAgentDirectory(workingDir);
            log('INFO', `[API] Agent '${agentId}' provisioned: ${workingDir}`);
        } catch (err) {
            log('ERROR', `[API] Agent '${agentId}' provisioning failed: ${(err as Error).message}`);
        }
    }

    log('INFO', `[API] Agent '${agentId}' saved`);
    return c.json({
        ok: true,
        agent: settings.agents![agentId],
        provisioned: isNew,
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
