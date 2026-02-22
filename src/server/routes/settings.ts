import fs from 'fs';
import { Hono } from 'hono';
import { Settings } from '../../lib/types';
import { SETTINGS_FILE, getSettings } from '../../lib/config';
import { log } from '../../lib/logging';

/** Read, mutate, and persist settings.json atomically. */
export function mutateSettings(fn: (settings: Settings) => void): Settings {
    const settings = getSettings();
    fn(settings);
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
    return settings;
}

const app = new Hono();

// GET /api/settings
app.get('/api/settings', (c) => {
    return c.json(getSettings());
});

// PUT /api/settings
app.put('/api/settings', async (c) => {
    const body = await c.req.json();
    const current = getSettings();
    const merged = { ...current, ...body } as Settings;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2) + '\n');
    log('INFO', '[API] Settings updated');
    return c.json({ ok: true, settings: merged });
});

export default app;
