/**
 * Channel CLI — start, stop, restart, setup, reset.
 */

const API_PORT = parseInt(process.env.TINYAGI_API_PORT || '3777', 10);
const API_URL = `http://localhost:${API_PORT}`;

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const NC = '\x1b[0m';

function log(color: string, msg: string): void {
    process.stdout.write(`${color}${msg}${NC}\n`);
}

// ── Commands ─────────────────────────────────────────────────────────────────

export async function channelAction(channelId: string, action: 'start' | 'stop' | 'restart'): Promise<void> {
    try {
        const res = await fetch(`${API_URL}/api/services/channel/${channelId}/${action}`, { method: 'POST' });
        const data: any = await res.json();
        if (data.ok) {
            log(GREEN, `Channel ${channelId} ${data.action}`);
        } else {
            log(RED, data.error || `Failed to ${action} ${channelId}`);
        }
    } catch {
        log(RED, 'TinyAGI is not running. Start it first with: tinyagi start');
    }
}

// ── CLI Dispatch ─────────────────────────────────────────────────────────────

const command = process.argv[2];
const arg = process.argv[3];

switch (command) {
    case 'start':
    case 'stop':
    case 'restart':
        if (!arg) {
            console.log(`Usage: tinyagi channel ${command} <telegram|discord|whatsapp>`);
            process.exit(1);
        }
        await channelAction(arg, command);
        break;

    case 'setup': {
        // Delegate to messaging module
        const { channelSetup } = await import('./messaging.ts');
        await channelSetup();
        break;
    }

    case 'reset':
        if (!arg) {
            console.log('Usage: tinyagi channel reset <channel_id>');
            process.exit(1);
        }
        {
            const { channelsReset } = await import('./messaging.ts');
            await channelsReset(arg);
        }
        break;

    default:
        console.log('Usage: tinyagi channel {start|stop|restart|setup|reset} <channel_id>');
        process.exit(1);
}
