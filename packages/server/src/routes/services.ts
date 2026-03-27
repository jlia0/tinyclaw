import { Hono } from 'hono';
import { getSettings } from '@tinyagi/core';
import { log } from '@tinyagi/core';

export interface ServiceHandlers {
    startChannel?: (channelId: string) => boolean;
    stopChannel?: (channelId: string) => boolean;
    restartChannel?: (channelId: string) => boolean;
    getChannelStatus?: () => Record<string, { running: boolean; pid?: number }>;
    getHeartbeatStatus?: () => { running: boolean; interval: number; lastSent: Record<string, number> };
    restart?: () => void;
}

export function createServicesRoutes(handlers?: ServiceHandlers): Hono {
    const app = new Hono();

    // POST /api/services/apply — start enabled channels
    app.post('/api/services/apply', async (c) => {
        const settings = getSettings();
        const enabledChannels = settings.channels?.enabled || [];
        const started: string[] = [];
        const errors: string[] = [];

        for (const ch of enabledChannels) {
            const ok = handlers?.startChannel?.(ch);
            if (ok) {
                started.push(ch);
            } else {
                errors.push(`${ch}: failed to start or already running`);
            }
        }

        log('INFO', `[services/apply] Started channels=[${started.join(',')}]`);
        return c.json({ ok: true, started, errors: errors.length ? errors : undefined });
    });

    // POST /api/services/channel/:id/start
    app.post('/api/services/channel/:id/start', (c) => {
        const channelId = c.req.param('id');
        const ok = handlers?.startChannel?.(channelId);
        if (ok) {
            return c.json({ ok: true, channel: channelId, action: 'started' });
        }
        return c.json({ ok: false, error: `Failed to start ${channelId} (unknown, already running, or missing token)` }, 400);
    });

    // POST /api/services/channel/:id/stop
    app.post('/api/services/channel/:id/stop', (c) => {
        const channelId = c.req.param('id');
        const ok = handlers?.stopChannel?.(channelId);
        if (ok) {
            return c.json({ ok: true, channel: channelId, action: 'stopped' });
        }
        return c.json({ ok: false, error: `${channelId} is not running` }, 400);
    });

    // POST /api/services/channel/:id/restart
    app.post('/api/services/channel/:id/restart', (c) => {
        const channelId = c.req.param('id');
        const ok = handlers?.restartChannel?.(channelId);
        if (ok) {
            return c.json({ ok: true, channel: channelId, action: 'restarted' });
        }
        return c.json({ ok: false, error: `Failed to restart ${channelId}` }, 400);
    });

    // POST /api/services/restart — restart the process (exit code 75 triggers entrypoint loop)
    app.post('/api/services/restart', (c) => {
        if (!handlers?.restart) {
            return c.json({ ok: false, error: 'Restart not available' }, 501);
        }
        // Respond before exiting so the client gets a response
        const response = c.json({ ok: true, action: 'restart' });
        setTimeout(() => handlers!.restart!(), 100);
        return response;
    });

    return app;
}
