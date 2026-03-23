import { Hono } from 'hono';
import { log } from '@tinyagi/core';
import {
    getProjects, getProject, createProject, updateProject, deleteProject,
    type Project,
} from '../tasks-db';

const app = new Hono();

// GET /api/projects
app.get('/api/projects', (c) => {
    const status = c.req.query('status');
    return c.json(getProjects(status));
});

// GET /api/projects/:id
app.get('/api/projects/:id', (c) => {
    const project = getProject(c.req.param('id'));
    if (!project) return c.json({ error: 'project not found' }, 404);
    return c.json(project);
});

// POST /api/projects
app.post('/api/projects', async (c) => {
    const body = await c.req.json() as Partial<Project>;
    if (!body.name) {
        return c.json({ error: 'name is required' }, 400);
    }
    const project = createProject({
        name: body.name,
        description: body.description,
        status: body.status,
    });
    log('INFO', `[API] Project created: ${project.name}`);
    return c.json({ ok: true, project });
});

// PUT /api/projects/:id
app.put('/api/projects/:id', async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req.json() as Partial<Project>;
    const project = updateProject(projectId, body);
    if (!project) return c.json({ error: 'project not found' }, 404);
    log('INFO', `[API] Project updated: ${projectId}`);
    return c.json({ ok: true, project });
});

// DELETE /api/projects/:id
app.delete('/api/projects/:id', (c) => {
    const projectId = c.req.param('id');
    if (!deleteProject(projectId)) return c.json({ error: 'project not found' }, 404);
    log('INFO', `[API] Project deleted: ${projectId}`);
    return c.json({ ok: true });
});

export default app;
