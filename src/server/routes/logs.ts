import fs from 'fs';
import { Hono } from 'hono';
import { LOG_FILE } from '../../lib/config';

const app = new Hono();

// GET /api/logs
app.get('/api/logs', (c) => {
    const limit = parseInt(c.req.query('limit') || '100', 10);
    try {
        const logContent = fs.readFileSync(LOG_FILE, 'utf8');
        const lines = logContent.trim().split('\n').slice(-limit);
        return c.json({ lines });
    } catch {
        return c.json({ lines: [] });
    }
});

export default app;
