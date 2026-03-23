import { Hono } from 'hono';
import { log } from '@tinyagi/core';
import {
    getTasks, getTask, createTask, updateTask, deleteTask, reorderTasks,
    getComments, createComment, deleteComment, getCommentCount,
    type Task,
} from '../tasks-db';

const app = new Hono();

// GET /api/tasks
app.get('/api/tasks', (c) => {
    const projectId = c.req.query('projectId');
    const status = c.req.query('status') as Task['status'] | undefined;
    const assignee = c.req.query('assignee');
    const filters: any = {};
    if (projectId) filters.projectId = projectId;
    if (status) filters.status = status;
    if (assignee) filters.assignee = assignee;
    return c.json(getTasks(Object.keys(filters).length ? filters : undefined));
});

// GET /api/tasks/:id
app.get('/api/tasks/:id', (c) => {
    const task = getTask(c.req.param('id'));
    if (!task) return c.json({ error: 'task not found' }, 404);
    const commentCount = getCommentCount(task.id);
    return c.json({ ...task, commentCount });
});

// POST /api/tasks
app.post('/api/tasks', async (c) => {
    const body = await c.req.json() as Partial<Task>;
    if (!body.title) {
        return c.json({ error: 'title is required' }, 400);
    }
    const task = createTask({
        title: body.title,
        description: body.description,
        status: body.status,
        assignee: body.assignee,
        assigneeType: body.assigneeType,
        projectId: body.projectId,
    });
    log('INFO', `[API] Task created: ${task.title}`);
    return c.json({ ok: true, task });
});

// PUT /api/tasks/reorder — must be before /api/tasks/:id
app.put('/api/tasks/reorder', async (c) => {
    const body = await c.req.json() as { columns: Record<string, string[]> };
    if (!body.columns) {
        return c.json({ error: 'columns map is required' }, 400);
    }
    reorderTasks(body.columns);
    return c.json({ ok: true });
});

// PUT /api/tasks/:id
app.put('/api/tasks/:id', async (c) => {
    const taskId = c.req.param('id');
    const body = await c.req.json() as Partial<Task>;
    const task = updateTask(taskId, body);
    if (!task) return c.json({ error: 'task not found' }, 404);
    log('INFO', `[API] Task updated: ${taskId}`);
    return c.json({ ok: true, task });
});

// DELETE /api/tasks/:id
app.delete('/api/tasks/:id', (c) => {
    const taskId = c.req.param('id');
    if (!deleteTask(taskId)) return c.json({ error: 'task not found' }, 404);
    log('INFO', `[API] Task deleted: ${taskId}`);
    return c.json({ ok: true });
});

// ── Comments ─────────────────────────────────────────────────────────────────

// GET /api/tasks/:id/comments
app.get('/api/tasks/:id/comments', (c) => {
    const taskId = c.req.param('id');
    const task = getTask(taskId);
    if (!task) return c.json({ error: 'task not found' }, 404);
    return c.json(getComments(taskId));
});

// POST /api/tasks/:id/comments
app.post('/api/tasks/:id/comments', async (c) => {
    const taskId = c.req.param('id');
    const task = getTask(taskId);
    if (!task) return c.json({ error: 'task not found' }, 404);
    const body = await c.req.json() as { author: string; authorType: 'user' | 'agent'; content: string };
    if (!body.content) return c.json({ error: 'content is required' }, 400);
    const comment = createComment({
        taskId,
        author: body.author || 'User',
        authorType: body.authorType || 'user',
        content: body.content,
    });
    log('INFO', `[API] Comment added to task ${taskId} by ${comment.author}`);
    return c.json({ ok: true, comment });
});

// DELETE /api/comments/:id
app.delete('/api/comments/:id', (c) => {
    const commentId = c.req.param('id');
    if (!deleteComment(commentId)) return c.json({ error: 'comment not found' }, 404);
    return c.json({ ok: true });
});

export default app;
