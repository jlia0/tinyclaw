import fs from 'fs';
import path from 'path';
import { Hono } from 'hono';
import { Task, TaskStatus } from '../../lib/types';
import { TINYCLAW_HOME } from '../../lib/config';
import { log } from '../../lib/logging';

const TASKS_FILE = path.join(TINYCLAW_HOME, 'tasks.json');

function readTasks(): Task[] {
    try {
        if (!fs.existsSync(TASKS_FILE)) return [];
        return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
    } catch {
        return [];
    }
}

function writeTasks(tasks: Task[]): void {
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2) + '\n');
}

const app = new Hono();

// GET /api/tasks
app.get('/api/tasks', (c) => {
    return c.json(readTasks());
});

// POST /api/tasks
app.post('/api/tasks', async (c) => {
    const body = await c.req.json() as Partial<Task>;
    if (!body.title) {
        return c.json({ error: 'title is required' }, 400);
    }
    const tasks = readTasks();
    const task: Task = {
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: body.title,
        description: body.description || '',
        status: body.status || 'backlog',
        assignee: body.assignee || '',
        assigneeType: body.assigneeType || '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    tasks.push(task);
    writeTasks(tasks);
    log('INFO', `[API] Task created: ${task.title}`);
    return c.json({ ok: true, task });
});

// PUT /api/tasks/reorder — must be before /api/tasks/:id
app.put('/api/tasks/reorder', async (c) => {
    const body = await c.req.json() as { columns: Record<string, string[]> };
    if (!body.columns) {
        return c.json({ error: 'columns map is required' }, 400);
    }
    const tasks = readTasks();
    for (const [status, taskIds] of Object.entries(body.columns)) {
        for (const taskId of taskIds) {
            const task = tasks.find(t => t.id === taskId);
            if (task) {
                task.status = status as TaskStatus;
                task.updatedAt = Date.now();
            }
        }
    }
    writeTasks(tasks);
    return c.json({ ok: true });
});

// PUT /api/tasks/:id
app.put('/api/tasks/:id', async (c) => {
    const taskId = c.req.param('id');
    const body = await c.req.json() as Partial<Task>;
    const tasks = readTasks();
    const idx = tasks.findIndex(t => t.id === taskId);
    if (idx === -1) return c.json({ error: 'task not found' }, 404);
    tasks[idx] = { ...tasks[idx], ...body, id: taskId, updatedAt: Date.now() };
    writeTasks(tasks);
    log('INFO', `[API] Task updated: ${taskId}`);
    return c.json({ ok: true, task: tasks[idx] });
});

// DELETE /api/tasks/:id
app.delete('/api/tasks/:id', (c) => {
    const taskId = c.req.param('id');
    const tasks = readTasks();
    const idx = tasks.findIndex(t => t.id === taskId);
    if (idx === -1) return c.json({ error: 'task not found' }, 404);
    tasks.splice(idx, 1);
    writeTasks(tasks);
    log('INFO', `[API] Task deleted: ${taskId}`);
    return c.json({ ok: true });
});

export default app;
