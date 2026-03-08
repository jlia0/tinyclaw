import fs from 'fs';
import path from 'path';
import { Hono } from 'hono';
import { CHATS_DIR } from '../../lib/config';

const app = new Hono();

// GET /api/chats
app.get('/api/chats', (c) => {
    const chats: { teamId: string; file: string; time: number }[] = [];
    if (fs.existsSync(CHATS_DIR)) {
        for (const teamDirent of fs.readdirSync(CHATS_DIR, { withFileTypes: true })) {
            if (!teamDirent.isDirectory()) continue;
            const teamPath = path.join(CHATS_DIR, teamDirent.name);
            for (const fileDirent of fs.readdirSync(teamPath, { withFileTypes: true })) {
                if (!fileDirent.isFile() || !fileDirent.name.endsWith('.md')) continue;
                const time = fs.statSync(path.join(teamPath, fileDirent.name)).mtimeMs;
                chats.push({ teamId: teamDirent.name, file: fileDirent.name, time });
            }
        }
    }
    chats.sort((a, b) => b.time - a.time);
    return c.json(chats);
});

export default app;
