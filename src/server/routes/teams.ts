import { Hono } from 'hono';
import { TeamConfig } from '../../lib/types';
import { getSettings, getTeams } from '../../lib/config';
import { log } from '../../lib/logging';
import { mutateSettings } from './settings';

const app = new Hono();

// GET /api/teams
app.get('/api/teams', (c) => {
    return c.json(getTeams(getSettings()));
});

// PUT /api/teams/:id
app.put('/api/teams/:id', async (c) => {
    const teamId = c.req.param('id');
    const body = await c.req.json() as Partial<TeamConfig>;
    if (!body.name || !body.agents || !body.leader_agent) {
        return c.json({ error: 'name, agents, and leader_agent are required' }, 400);
    }
    const settings = mutateSettings(s => {
        if (!s.teams) s.teams = {};
        s.teams[teamId] = {
            name: body.name!,
            agents: body.agents!,
            leader_agent: body.leader_agent!,
        };
    });
    log('INFO', `[API] Team '${teamId}' saved`);
    return c.json({ ok: true, team: settings.teams![teamId] });
});

// DELETE /api/teams/:id
app.delete('/api/teams/:id', (c) => {
    const teamId = c.req.param('id');
    const settings = getSettings();
    if (!settings.teams?.[teamId]) {
        return c.json({ error: `team '${teamId}' not found` }, 404);
    }
    mutateSettings(s => { delete s.teams![teamId]; });
    log('INFO', `[API] Team '${teamId}' deleted`);
    return c.json({ ok: true });
});

export default app;
