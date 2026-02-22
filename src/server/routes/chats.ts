import fs from 'fs';
import path from 'path';
import { Hono } from 'hono';
import { CHATS_DIR } from '../../lib/config';

const app = new Hono();

// GET /api/chats
app.get('/api/chats', (c) => {
    const chats: { teamId: string; file: string; time: number }[] = [];
    if (fs.existsSync(CHATS_DIR)) {
        for (const teamDir of fs.readdirSync(CHATS_DIR)) {
            const teamPath = path.join(CHATS_DIR, teamDir);
            if (fs.statSync(teamPath).isDirectory()) {
                for (const file of fs.readdirSync(teamPath).filter(f => f.endsWith('.md'))) {
                    const time = fs.statSync(path.join(teamPath, file)).mtimeMs;
                    chats.push({ teamId: teamDir, file, time });
                }
            }
        }
    }
    chats.sort((a, b) => b.time - a.time);
    return c.json(chats);
});

export default app;
