import { Hono } from 'hono';
import { Settings } from '../../lib/types';
import { SETTINGS_FILE, getSettings, writeJsonFile } from '../../lib/config';
import { log } from '../../lib/logging';

/** Read, mutate, and persist settings.json atomically. */
export function mutateSettings(fn: (settings: Settings) => void): Settings {
    const settings = getSettings();
    fn(settings);
    writeJsonFile(SETTINGS_FILE, settings);
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
    const merged = { ...getSettings(), ...body } as Settings;
    writeJsonFile(SETTINGS_FILE, merged);
    log('INFO', '[API] Settings updated');
    return c.json({ ok: true, settings: merged });
});

export default app;
