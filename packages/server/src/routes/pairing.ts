import path from 'path';
import { Hono } from 'hono';
import { TINYAGI_HOME, loadPairingState, savePairingState, approvePairingCode } from '@tinyagi/core';
import { log } from '@tinyagi/core';

const PAIRING_FILE = path.join(TINYAGI_HOME, 'pairing.json');

const app = new Hono();

// GET /api/pairing — list all pairings (pending + approved)
app.get('/api/pairing', (c) => {
    const state = loadPairingState(PAIRING_FILE);
    return c.json(state);
});

// POST /api/pairing/approve — approve a pending code
app.post('/api/pairing/approve', async (c) => {
    const body = await c.req.json() as { code?: string };
    if (!body.code) {
        return c.json({ ok: false, error: 'code is required' }, 400);
    }
    const result = approvePairingCode(PAIRING_FILE, body.code);
    if (!result.ok) {
        return c.json({ ok: false, error: result.reason }, 404);
    }
    log('INFO', `[API] Pairing approved: ${result.entry!.channel}/${result.entry!.sender}`);
    return c.json({ ok: true, entry: result.entry });
});

// DELETE /api/pairing/:channel/:senderId — revoke an approved pairing
app.delete('/api/pairing/:channel/:senderId', (c) => {
    const channel = c.req.param('channel');
    const senderId = c.req.param('senderId');
    const state = loadPairingState(PAIRING_FILE);

    const idx = state.approved.findIndex(
        e => e.channel === channel && e.senderId === senderId
    );
    if (idx === -1) {
        return c.json({ ok: false, error: 'Pairing not found' }, 404);
    }

    state.approved.splice(idx, 1);
    savePairingState(PAIRING_FILE, state);
    log('INFO', `[API] Pairing revoked: ${channel}/${senderId}`);
    return c.json({ ok: true });
});

// DELETE /api/pairing/pending/:code — dismiss a pending pairing
app.delete('/api/pairing/pending/:code', (c) => {
    const code = c.req.param('code').toUpperCase();
    const state = loadPairingState(PAIRING_FILE);

    const idx = state.pending.findIndex(e => e.code.toUpperCase() === code);
    if (idx === -1) {
        return c.json({ ok: false, error: 'Pending pairing not found' }, 404);
    }

    state.pending.splice(idx, 1);
    savePairingState(PAIRING_FILE, state);
    log('INFO', `[API] Pending pairing dismissed: ${code}`);
    return c.json({ ok: true });
});

export default app;
