import fs from 'fs';
import path from 'path';
import os from 'os';

const TINYAGI_HOME = process.env.TINYAGI_HOME || path.join(os.homedir(), '.tinyagi');
const SETTINGS_FILE = path.join(TINYAGI_HOME, 'settings.json');
const OLD_HOME = path.join(os.homedir(), '.tinyclaw');

/**
 * Auto-migrate from ~/.tinyclaw to ~/.tinyagi if needed.
 * Runs once — skips if ~/.tinyclaw doesn't exist or ~/.tinyagi already exists.
 */
function migrateFromTinyclaw() {
    if (!fs.existsSync(OLD_HOME) || fs.existsSync(TINYAGI_HOME)) return false;

    console.log('Migrating ~/.tinyclaw → ~/.tinyagi ...');
    fs.renameSync(OLD_HOME, TINYAGI_HOME);

    // Rename database file
    const oldDb = path.join(TINYAGI_HOME, 'tinyclaw.db');
    const newDb = path.join(TINYAGI_HOME, 'tinyagi.db');
    if (fs.existsSync(oldDb) && !fs.existsSync(newDb)) {
        fs.renameSync(oldDb, newDb);
        for (const suffix of ['-wal', '-shm']) {
            const src = oldDb + suffix;
            if (fs.existsSync(src)) fs.renameSync(src, newDb + suffix);
        }
    }

    console.log('✓ Migration complete');
    return true;
}

function expandHome(p) {
    if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
    return p;
}

/**
 * Determine SCRIPT_DIR (repo root) — same logic as tinyagi.sh.
 * When running from packages/cli/lib/defaults.mjs, go up 3 levels.
 */
const SCRIPT_DIR = path.resolve(new URL('.', import.meta.url).pathname, '../../..');

function copyDirSync(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDirSync(s, d);
        else fs.copyFileSync(s, d);
    }
}

/**
 * Bootstrap an agent working directory with templates from SCRIPT_DIR.
 */
function bootstrapAgentDir(agentDir) {
    if (fs.existsSync(agentDir)) return; // already exists

    fs.mkdirSync(agentDir, { recursive: true });

    // Copy .claude directory
    const sourceClaudeDir = path.join(SCRIPT_DIR, '.claude');
    if (fs.existsSync(sourceClaudeDir)) {
        copyDirSync(sourceClaudeDir, path.join(agentDir, '.claude'));
    }

    // Copy heartbeat.md
    const sourceHeartbeat = path.join(SCRIPT_DIR, 'heartbeat.md');
    if (fs.existsSync(sourceHeartbeat)) {
        fs.copyFileSync(sourceHeartbeat, path.join(agentDir, 'heartbeat.md'));
    }

    // Create empty AGENTS.md for user customization
    fs.writeFileSync(path.join(agentDir, 'AGENTS.md'), '');

    // Copy SOUL.md
    const targetTinyagi = path.join(agentDir, '.tinyagi');
    fs.mkdirSync(targetTinyagi, { recursive: true });
    const sourceSoul = path.join(SCRIPT_DIR, 'SOUL.md');
    if (fs.existsSync(sourceSoul)) {
        fs.copyFileSync(sourceSoul, path.join(targetTinyagi, 'SOUL.md'));
    }

    // Create memory directory
    fs.mkdirSync(path.join(agentDir, 'memory'), { recursive: true });
}

const DEFAULT_SETTINGS = {
    workspace: {
        path: path.join(os.homedir(), 'tinyagi-workspace'),
        name: 'tinyagi-workspace',
    },
    channels: {
        enabled: [],
    },
    agents: {
        tinyagi: {
            name: 'TinyAGI Agent',
            provider: 'anthropic',
            model: 'opus',
            working_directory: path.join(os.homedir(), 'tinyagi-workspace', 'tinyagi'),
        },
    },
    models: {
        provider: 'anthropic',
    },
    monitoring: {
        heartbeat_interval: 3600,
    },
};

/**
 * Write default settings.json and create workspace directories.
 * Returns true if defaults were written, false if settings already exist.
 */
export function writeDefaults() {
    // Auto-migrate from tinyclaw if needed
    migrateFromTinyclaw();

    if (fs.existsSync(SETTINGS_FILE)) {
        return false;
    }

    // Ensure TINYAGI_HOME exists
    fs.mkdirSync(TINYAGI_HOME, { recursive: true });

    // Write settings
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2) + '\n');

    // Create workspace and bootstrap agent directories with templates
    const wsPath = DEFAULT_SETTINGS.workspace.path;
    fs.mkdirSync(wsPath, { recursive: true });

    for (const agent of Object.values(DEFAULT_SETTINGS.agents)) {
        bootstrapAgentDir(agent.working_directory);
    }

    return true;
}

export { TINYAGI_HOME, SETTINGS_FILE, DEFAULT_SETTINGS };
