#!/usr/bin/env node

import { execSync, spawn, fork } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { writeDefaults, TINYAGI_HOME } from '../lib/defaults.mjs';

// ── Helpers ──────────────────────────────────────────────────────────────────

const INSTALL_DIR = TINYAGI_HOME;
const GITHUB_REPO = 'TinyAGI/tinyagi';
const PORTAL_URL = 'https://office.tinyagicompany.com';

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const NC = '\x1b[0m';

const BANNER = `
  ▀█▀ █ █▄ █ █▄█ █▀█ █▀▀ █
   █  █ █ ▀█  █  █▀█ █▄█ █
`;

function printBanner() {
    console.log(BANNER);
}

function log(color, msg) {
    process.stdout.write(`${color}${msg}${NC}\n`);
}

function commandExists(cmd) {
    try {
        execSync(`command -v ${cmd}`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function exec(cmd, opts = {}) {
    return execSync(cmd, { stdio: 'inherit', ...opts });
}

// Resolve repo root (works from symlinks and dev workflow)
const REPO_ROOT = path.resolve(new URL('.', import.meta.url).pathname, '../../..');
const CLI_DIR = path.join(REPO_ROOT, 'packages/cli/dist');
const PID_FILE = path.join(TINYAGI_HOME, 'tinyagi.pid');
const LOG_DIR = path.join(TINYAGI_HOME, 'logs');
const API_PORT = parseInt(process.env.TINYAGI_API_PORT || '3777', 10);
const API_URL = `http://localhost:${API_PORT}`;

// ── Prerequisites ────────────────────────────────────────────────────────────

function checkPrerequisites() {
    const missing = [];
    if (!commandExists('node')) missing.push('node (https://nodejs.org/)');
    if (!commandExists('npm')) missing.push('npm (https://nodejs.org/)');

    if (missing.length > 0) {
        log(RED, 'Missing prerequisites:');
        for (const dep of missing) {
            console.log(`  - ${dep}`);
        }
        process.exit(1);
    }

    // Soft check: warn if neither claude nor codex CLI is installed
    if (!commandExists('claude') && !commandExists('codex')) {
        log(YELLOW, 'Warning: neither \'claude\' nor \'codex\' CLI found');
        console.log('  Install Claude: npm install -g @anthropic-ai/claude-code');
        console.log('  Install Codex:  npm install -g @openai/codex');
        console.log('');
    }
}

// ── Installation ─────────────────────────────────────────────────────────────

function isInstalled() {
    // Check for built main entry point (local repo or installed copy)
    return fs.existsSync(path.join(REPO_ROOT, 'packages/main/dist/index.js'))
        || fs.existsSync(path.join(INSTALL_DIR, 'packages/main/dist/index.js'));
}

async function install() {
    log(BLUE, 'Installing TinyAGI...');
    console.log(`  Directory: ${INSTALL_DIR}`);
    console.log('');

    // Try pre-built bundle first
    let usedBundle = false;
    try {
        const releaseJson = execSync(
            `curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases/latest"`,
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
        );
        const match = releaseJson.match(/"tag_name"\s*:\s*"([^"]+)"/);
        if (match) {
            const tag = match[1];
            const bundleUrl = `https://github.com/${GITHUB_REPO}/releases/download/${tag}/tinyagi-bundle.tar.gz`;

            // Check if bundle exists
            try {
                execSync(`curl -fsSL -I "${bundleUrl}"`, { stdio: 'ignore' });
                log(GREEN, `✓ Pre-built bundle available (${tag})`);

                fs.mkdirSync(INSTALL_DIR, { recursive: true });
                exec(`curl -fsSL "${bundleUrl}" | tar -xz -C "${INSTALL_DIR}" --strip-components=1`);

                // Rebuild native modules
                exec(`cd "${INSTALL_DIR}" && npm rebuild better-sqlite3 --silent 2>/dev/null || true`);
                usedBundle = true;
            } catch {
                // Bundle not available
            }
        }
    } catch {
        // No releases found
    }

    if (!usedBundle) {
        if (!commandExists('git')) {
            log(RED, 'git is required for source installation');
            process.exit(1);
        }

        log(YELLOW, 'No pre-built bundle — installing from source...');
        exec(`git clone --depth 1 "https://github.com/${GITHUB_REPO}.git" "${INSTALL_DIR}"`);

        log(BLUE, 'Installing dependencies...');
        exec(`cd "${INSTALL_DIR}" && PUPPETEER_SKIP_DOWNLOAD=true npm install --silent`);

        log(BLUE, 'Building...');
        exec(`cd "${INSTALL_DIR}" && npm run build --silent`);

        log(BLUE, 'Pruning dev dependencies...');
        exec(`cd "${INSTALL_DIR}" && npm prune --omit=dev --silent`);
    }

    // Make scripts executable
    exec(`chmod +x "${INSTALL_DIR}/bin/tinyagi" "${INSTALL_DIR}/bin/tinyclaw" "${INSTALL_DIR}/packages/cli/bin/tinyagi.mjs"`);

    // Install CLI symlink (tinyagi command)
    installCli();

    log(GREEN, '✓ TinyAGI installed');
    console.log('');
}

// ── CLI Symlink Installation ─────────────────────────────────────────────────

function installCli() {
    // Determine installation directory for the symlink
    const tinyagiSrc = path.join(INSTALL_DIR, 'packages/cli/bin/tinyagi.mjs');
    let installDir = '';

    try {
        fs.accessSync('/usr/local/bin', fs.constants.W_OK);
        installDir = '/usr/local/bin';
    } catch {
        installDir = path.join(os.homedir(), '.local/bin');
        fs.mkdirSync(installDir, { recursive: true });
    }

    const symlinkPath = path.join(installDir, 'tinyagi');

    // Remove existing symlink/file
    try {
        const stat = fs.lstatSync(symlinkPath);
        if (stat.isSymbolicLink() || stat.isFile()) {
            fs.unlinkSync(symlinkPath);
        }
    } catch {
        // Doesn't exist, that's fine
    }

    // Create symlink
    fs.symlinkSync(tinyagiSrc, symlinkPath);
    log(GREEN, `✓ 'tinyagi' command installed at ${symlinkPath}`);

    // Add to PATH if needed
    if (installDir.includes('.local/bin') && !process.env.PATH?.includes('.local/bin')) {
        const shellName = path.basename(process.env.SHELL || 'bash');
        let shellProfile = '';
        if (shellName === 'zsh') {
            shellProfile = path.join(os.homedir(), '.zshrc');
        } else if (fs.existsSync(path.join(os.homedir(), '.bash_profile'))) {
            shellProfile = path.join(os.homedir(), '.bash_profile');
        } else {
            shellProfile = path.join(os.homedir(), '.bashrc');
        }

        const pathLine = 'export PATH="$HOME/.local/bin:$PATH"';
        try {
            const content = fs.readFileSync(shellProfile, 'utf8');
            if (!content.includes('.local/bin')) {
                fs.appendFileSync(shellProfile, `\n# Added by TinyAGI installer\n${pathLine}\n`);
                log(GREEN, `✓ Added ~/.local/bin to PATH in ${shellProfile.replace(os.homedir(), '~')}`);
            }
        } catch {
            // Profile doesn't exist or can't be read
        }

        log(YELLOW, `⚠ Restart your terminal or run: source ${shellProfile.replace(os.homedir(), '~')}`);
    }
}

// ── Daemon (start/stop/restart/status) ──────────────────────────────────────

function getMainScript() {
    const local = path.join(REPO_ROOT, 'packages/main/dist/index.js');
    const installed = path.join(INSTALL_DIR, 'packages/main/dist/index.js');
    if (fs.existsSync(local)) return local;
    if (fs.existsSync(installed)) return installed;
    return null;
}

function isRunning() {
    if (!fs.existsSync(PID_FILE)) return false;
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        // Stale PID file
        fs.unlinkSync(PID_FILE);
        return false;
    }
}

async function fetchStatus() {
    try {
        const res = await fetch(`${API_URL}/api/status`);
        return await res.json();
    } catch {
        return null;
    }
}

async function waitForServer(maxWait = 8000) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
        const status = await fetchStatus();
        if (status?.ok) return status;
        await new Promise(r => setTimeout(r, 300));
    }
    return null;
}

function formatUptime(seconds) {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
}

async function startDaemon() {
    if (isRunning()) {
        log(YELLOW, 'TinyAGI is already running');
        return;
    }

    const mainScript = getMainScript();
    if (!mainScript) {
        log(RED, 'TinyAGI is not built. Run "npm run build" first.');
        process.exit(1);
    }

    // Ensure log directory exists
    fs.mkdirSync(LOG_DIR, { recursive: true });

    const logFile = path.join(LOG_DIR, 'daemon.log');
    const out = fs.openSync(logFile, 'a');

    const child = spawn('node', [mainScript], {
        detached: true,
        stdio: ['ignore', out, out],
        env: { ...process.env, TINYAGI_HOME },
    });

    fs.writeFileSync(PID_FILE, String(child.pid));
    child.unref();

    log(GREEN, `TinyAGI started (PID: ${child.pid})`);

    // Wait for server to be ready and print service status
    const status = await waitForServer();
    if (status) {
        log(GREEN, `  Server:    http://localhost:${status.server?.port || API_PORT}`);

        const channels = status.channels || {};
        const channelNames = Object.keys(channels);
        if (channelNames.length > 0) {
            for (const ch of channelNames) {
                const c = channels[ch];
                const icon = c.running ? GREEN + '●' : RED + '○';
                log(NC, `  Channel:   ${icon} ${ch}${c.pid ? ` (PID: ${c.pid})` : ''}${NC}`);
            }
        } else {
            log(NC, `  Channels:  ${YELLOW}none enabled${NC}`);
        }

        const hb = status.heartbeat || {};
        if (hb.running) {
            log(NC, `  Heartbeat: ${GREEN}● running${NC} (interval: ${hb.interval}s)`);
        } else {
            log(NC, `  Heartbeat: ${YELLOW}○ off${NC}`);
        }
    } else {
        log(YELLOW, '  (waiting for server...)');
    }

    log(NC, `  Logs:      ${logFile}`);
}

function stopDaemon() {
    if (!fs.existsSync(PID_FILE)) {
        log(YELLOW, 'TinyAGI is not running');
        return;
    }

    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    try {
        process.kill(pid, 'SIGTERM');
        log(GREEN, `TinyAGI stopped (PID: ${pid})`);
    } catch {
        log(YELLOW, 'Process already exited');
    }
    try { fs.unlinkSync(PID_FILE); } catch {}
}

async function statusDaemon() {
    if (!isRunning()) {
        log(YELLOW, 'TinyAGI is not running');
        return;
    }

    const pid = fs.readFileSync(PID_FILE, 'utf8').trim();
    const status = await fetchStatus();

    if (!status?.ok) {
        log(GREEN, `TinyAGI is running (PID: ${pid})`);
        log(YELLOW, '  Server:    not responding');
        return;
    }

    log(GREEN, `TinyAGI is running (PID: ${pid}, uptime: ${formatUptime(status.uptime)})`);
    log(NC, `  Server:    ${GREEN}● http://localhost:${status.server?.port || API_PORT}${NC}`);

    // Queue status
    try {
        const qRes = await fetch(`${API_URL}/api/queue/status`);
        const q = await qRes.json();
        const parts = [];
        if (q.processing > 0) parts.push(`${q.processing} processing`);
        if (q.queued > 0) parts.push(`${q.queued} queued`);
        if (q.dead > 0) parts.push(`${RED}${q.dead} dead${NC}`);
        if (q.completed > 0) parts.push(`${q.completed} completed`);
        log(NC, `  Queue:     ${GREEN}●${NC} ${parts.length > 0 ? parts.join(', ') : 'idle'}`);
    } catch {
        log(NC, `  Queue:     ${YELLOW}? unknown${NC}`);
    }

    // Channels
    const channels = status.channels || {};
    const channelNames = Object.keys(channels);
    if (channelNames.length > 0) {
        for (const ch of channelNames) {
            const c = channels[ch];
            const icon = c.running ? GREEN + '●' : RED + '○';
            const state = c.running ? 'running' : 'stopped';
            log(NC, `  Channel:   ${icon} ${ch}${NC} — ${state}${c.pid ? ` (PID: ${c.pid})` : ''}`);
        }
    } else {
        log(NC, `  Channels:  ${YELLOW}none enabled${NC}`);
    }

    // Heartbeat
    const hb = status.heartbeat || {};
    if (hb.running) {
        const lastSent = Object.entries(hb.lastSent || {});
        const lastStr = lastSent.length > 0
            ? lastSent.map(([agent, ts]) => `${agent}: ${formatUptime(Math.floor(Date.now() / 1000) - ts)} ago`).join(', ')
            : 'none yet';
        log(NC, `  Heartbeat: ${GREEN}● running${NC} (interval: ${hb.interval}s, last: ${lastStr})`);
    } else {
        log(NC, `  Heartbeat: ${YELLOW}○ off${NC}`);
    }
}

// ── Logs ─────────────────────────────────────────────────────────────────────

function viewLogs(type) {
    const logFiles = {
        queue: 'queue.log',
        daemon: 'daemon.log',
        heartbeat: 'heartbeat.log',
        discord: 'discord.log',
        telegram: 'telegram.log',
        whatsapp: 'whatsapp.log',
    };

    if (type === 'all' || !type) {
        // Tail all logs
        const files = Object.values(logFiles)
            .map(f => path.join(LOG_DIR, f))
            .filter(f => fs.existsSync(f));
        if (files.length === 0) {
            log(YELLOW, 'No log files found');
            return;
        }
        const child = spawn('tail', ['-f', ...files], { stdio: 'inherit' });
        child.on('exit', (code) => process.exit(code || 0));
    } else {
        const file = logFiles[type];
        if (!file) {
            log(RED, `Unknown log type: ${type}`);
            console.log(`Available: ${Object.keys(logFiles).join(', ')}, all`);
            process.exit(1);
        }
        const logPath = path.join(LOG_DIR, file);
        if (!fs.existsSync(logPath)) {
            log(YELLOW, `No ${type} log file found`);
            return;
        }
        const child = spawn('tail', ['-f', logPath], { stdio: 'inherit' });
        child.on('exit', (code) => process.exit(code || 0));
    }
}

// ── Version ──────────────────────────────────────────────────────────────────

function getVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
        return pkg.version || 'unknown';
    } catch {
        return 'unknown';
    }
}

// ── Run (smart default: onboard if first time, otherwise just start) ────────

async function run() {
    // If settings already exist, just start + open office
    if (isInstalled() && fs.existsSync(path.join(TINYAGI_HOME, 'settings.json'))) {
        await startDaemon();
        await openOffice();
        return;
    }

    // First-time onboarding
    console.log('');
    log(BLUE, '╔════════════════════════════════════════╗');
    log(BLUE, '║          TinyAGI Quick Start           ║');
    log(BLUE, '╚════════════════════════════════════════╝');
    console.log('');

    // 1. Prerequisites
    checkPrerequisites();

    // 2. Install if needed
    if (!isInstalled()) {
        await install();
    } else {
        log(GREEN, '✓ TinyAGI already installed');
        console.log('');
    }

    // 3. Write default settings
    writeDefaults();
    log(GREEN, '✓ Default settings written');
    console.log(`  Workspace: ~/tinyagi-workspace`);
    console.log(`  Agent: tinyagi (anthropic/opus)`);
    console.log('');

    // 4. Start daemon
    await startDaemon();

    // 5. Open office
    await openOffice();
}

async function openOffice() {
    console.log('');
    log(GREEN, `Opening TinyOffice: ${PORTAL_URL}`);
    try {
        const open = (await import('open')).default;
        await open(PORTAL_URL);
    } catch {
        log(YELLOW, `Could not open browser. Visit ${PORTAL_URL} manually.`);
    }
}

// ── Node CLI helper ──────────────────────────────────────────────────────────

function runCliScript(script, args) {
    const scriptPath = path.join(CLI_DIR, script);
    const child = spawn('node', [scriptPath, ...args], { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code || 0));
}

// ── CLI Dispatch ─────────────────────────────────────────────────────────────

const command = process.argv[2] || 'run';
const restArgs = process.argv.slice(3);

printBanner();

switch (command) {
    case 'run':
        run();
        break;

    case 'install':
        checkPrerequisites();
        if (isInstalled()) {
            log(GREEN, '✓ TinyAGI already installed');
        } else {
            install();
        }
        break;

    // ── Daemon ───────────────────────────────────────────────────────────────

    case 'start':
        await startDaemon();
        openOffice();
        break;

    case 'stop':
        stopDaemon();
        break;

    case 'restart':
        stopDaemon();
        await new Promise(r => setTimeout(r, 1000));
        await startDaemon();
        break;

    case 'status':
        await statusDaemon();
        break;

    // ── Logs ─────────────────────────────────────────────────────────────────

    case 'logs':
        viewLogs(restArgs[0]);
        break;

    // ── Messaging ────────────────────────────────────────────────────────────

    case 'send':
        if (!restArgs[0]) {
            console.log('Usage: tinyagi send <message>');
            process.exit(1);
        }
        runCliScript('messaging.js', ['send', restArgs[0]]);
        break;

    // ── Agent reset (top-level shortcut) ─────────────────────────────────────

    case 'reset':
        if (!restArgs[0]) {
            console.log('Usage: tinyagi reset <agent_id> [agent_id2 ...]');
            process.exit(1);
        }
        runCliScript('agent.js', ['reset', ...restArgs]);
        break;

    // ── Channels ─────────────────────────────────────────────────────────────

    case 'channels':
    case 'channel':
        switch (restArgs[0]) {
            case 'setup':
                runCliScript('messaging.js', ['channel-setup']);
                break;
            case 'reset':
                if (!restArgs[1]) {
                    console.log('Usage: tinyagi channel reset <channel_id>');
                    process.exit(1);
                }
                runCliScript('messaging.js', ['channels-reset', restArgs[1]]);
                break;
            case 'start':
            case 'stop':
            case 'restart': {
                const action = restArgs[0];
                if (!restArgs[1]) {
                    console.log(`Usage: tinyagi channel ${action} <telegram|discord|whatsapp>`);
                    process.exit(1);
                }
                const channelId = restArgs[1];
                fetch(`${API_URL}/api/services/channel/${channelId}/${action}`, { method: 'POST' })
                    .then(async (res) => {
                        const data = await res.json();
                        if (data.ok) {
                            log(GREEN, `Channel ${channelId} ${data.action}`);
                        } else {
                            log(RED, data.error || `Failed to ${action} ${channelId}`);
                        }
                    })
                    .catch(() => {
                        log(RED, 'TinyAGI is not running. Start it first with: tinyagi start');
                    });
                break;
            }
            default:
                console.log('Usage: tinyagi channel {setup|start|stop|restart|reset} <channel_id>');
                process.exit(1);
        }
        break;

    // ── Heartbeat ────────────────────────────────────────────────────────────

    case 'heartbeat':
        // Heartbeat is now built into the main process
        log(YELLOW, 'Heartbeat runs automatically as part of the main process.');
        log(YELLOW, 'Configure via monitoring.heartbeat_interval in settings.json.');
        break;

    // ── Agents ───────────────────────────────────────────────────────────────

    case 'agent':
        switch (restArgs[0]) {
            case 'add':
                runCliScript('agent.js', ['add']);
                break;
            case 'remove': case 'rm':
                if (!restArgs[1]) { console.log('Usage: tinyagi agent remove <agent_id>'); process.exit(1); }
                runCliScript('agent.js', ['remove', restArgs[1]]);
                break;
            case 'list': case 'ls':
                runCliScript('agent.js', ['list']);
                break;
            case 'show':
                if (!restArgs[1]) { console.log('Usage: tinyagi agent show <agent_id>'); process.exit(1); }
                runCliScript('agent.js', ['show', restArgs[1]]);
                break;
            case 'reset':
                if (!restArgs[1]) { console.log('Usage: tinyagi agent reset <agent_id> [...]'); process.exit(1); }
                runCliScript('agent.js', ['reset', ...restArgs.slice(1)]);
                break;
            case 'provider':
                if (!restArgs[1]) { console.log('Usage: tinyagi agent provider <agent_id> [provider] [--model MODEL]'); process.exit(1); }
                runCliScript('agent.js', ['provider', ...restArgs.slice(1)]);
                break;
            default:
                console.log('Usage: tinyagi agent {list|add|remove|show|reset|provider}');
                process.exit(1);
        }
        break;

    // ── Teams ────────────────────────────────────────────────────────────────

    case 'team':
        switch (restArgs[0]) {
            case 'add':
                runCliScript('team.js', ['add']);
                break;
            case 'remove': case 'rm':
                if (!restArgs[1]) { console.log('Usage: tinyagi team remove <team_id>'); process.exit(1); }
                runCliScript('team.js', ['remove', restArgs[1]]);
                break;
            case 'list': case 'ls':
                runCliScript('team.js', ['list']);
                break;
            case 'show':
                if (!restArgs[1]) { console.log('Usage: tinyagi team show <team_id>'); process.exit(1); }
                runCliScript('team.js', ['show', restArgs[1]]);
                break;
            case 'add-agent': case 'agent-add': case 'member-add':
                if (!restArgs[1] || !restArgs[2]) { console.log('Usage: tinyagi team add-agent <team_id> <agent_id>'); process.exit(1); }
                runCliScript('team.js', ['add-agent', restArgs[1], restArgs[2]]);
                break;
            case 'remove-agent': case 'agent-remove': case 'member-remove':
                if (!restArgs[1] || !restArgs[2]) { console.log('Usage: tinyagi team remove-agent <team_id> <agent_id>'); process.exit(1); }
                runCliScript('team.js', ['remove-agent', restArgs[1], restArgs[2]]);
                break;
            case 'visualize': case 'viz': {
                const vizScript = path.join(REPO_ROOT, 'packages/visualizer/dist/team-visualizer.js');
                const vizArgs = restArgs[1] ? ['--team', restArgs[1]] : [];
                const child = spawn('node', [vizScript, ...vizArgs], { stdio: 'inherit' });
                child.on('exit', (code) => process.exit(code || 0));
                break;
            }
            default:
                console.log('Usage: tinyagi team {list|add|remove|show|add-agent|remove-agent|visualize}');
                process.exit(1);
        }
        break;

    // ── Chatroom ─────────────────────────────────────────────────────────────

    case 'chatroom': {
        if (!restArgs[0]) {
            log(RED, 'Usage: tinyagi chatroom <team_id>');
            process.exit(1);
        }
        const chatroomScript = path.join(REPO_ROOT, 'packages/visualizer/dist/chatroom-viewer.js');
        const child = spawn('node', [chatroomScript, '--team', restArgs[0]], { stdio: 'inherit' });
        child.on('exit', (code) => process.exit(code || 0));
        break;
    }

    // ── Providers ────────────────────────────────────────────────────────────

    case 'provider':
        switch (restArgs[0]) {
            case 'list': case 'ls':
                runCliScript('agent.js', ['provider-list']);
                break;
            case 'add':
                runCliScript('agent.js', ['provider-add']);
                break;
            case 'remove': case 'rm':
                if (!restArgs[1]) { console.log('Usage: tinyagi provider remove <provider_id>'); process.exit(1); }
                runCliScript('agent.js', ['provider-remove', restArgs[1]]);
                break;
            case 'anthropic': case 'openai':
                runCliScript('provider.js', restArgs);
                break;
            case undefined: case '':
                runCliScript('provider.js', ['show']);
                break;
            default:
                console.log('Usage: tinyagi provider {anthropic|openai|list|add|remove} [--model MODEL]');
                process.exit(1);
        }
        break;

    case 'model':
        runCliScript('provider.js', ['model', restArgs[0] || '']);
        break;

    // ── Office ───────────────────────────────────────────────────────────────

    case 'office': {
        const officeDir = path.join(REPO_ROOT, 'tinyoffice');
        // Install deps if needed
        if (!fs.existsSync(path.join(officeDir, 'node_modules'))) {
            log(BLUE, 'Installing TinyOffice dependencies...');
            exec(`cd "${officeDir}" && npm install`);
        }
        // Build if needed
        if (!fs.existsSync(path.join(officeDir, '.next/BUILD_ID'))) {
            log(BLUE, 'Building TinyOffice...');
            exec(`cd "${officeDir}" && npm run build`);
        }
        log(GREEN, 'Starting TinyOffice on http://localhost:3000');
        const child = spawn('npm', ['run', 'start'], { cwd: officeDir, stdio: 'inherit' });
        child.on('exit', (code) => process.exit(code || 0));
        break;
    }

    // ── Pairing ──────────────────────────────────────────────────────────────

    case 'pairing':
        runCliScript('pairing.js', restArgs);
        break;

    // ── Setup (legacy alias) ─────────────────────────────────────────────────

    case 'setup':
        runCliScript('messaging.js', ['channel-setup']);
        break;

    // ── Update ───────────────────────────────────────────────────────────────

    case 'update':
        runCliScript('update.js', []);
        break;

    // ── Version ──────────────────────────────────────────────────────────────

    case 'version': case '--version': case '-v': case '-V':
        console.log(`tinyagi v${getVersion()}`);
        break;

    // ── Help ─────────────────────────────────────────────────────────────────

    case '--help': case '-h': case 'help':
        console.log('');
        console.log('Usage: tinyagi [command]');
        console.log('');
        console.log('Quick Start:');
        console.log('  run                      Install, configure defaults, and start (default)');
        console.log('  install                  Install TinyAGI only');
        console.log('');
        console.log('Daemon:');
        console.log('  start                    Start TinyAGI');
        console.log('  stop                     Stop all processes');
        console.log('  restart                  Restart TinyAGI');
        console.log('  status                   Show current status');
        console.log('');
        console.log('Config:');
        console.log('  office                   Start TinyOffice web portal (http://localhost:3000)');
        console.log('');
        console.log('Messaging:');
        console.log('  send <msg>               Send message to AI');
        console.log('  logs [type]              View logs (discord|whatsapp|telegram|heartbeat|daemon|queue|all)');
        console.log('');
        console.log('Channels & Services:');
        console.log('  channel setup            Configure channels interactively');
        console.log('  channel reset <ch>       Reset channel auth');
        console.log('');
        console.log('Agents:');
        console.log('  agent list               List all configured agents');
        console.log('  agent add                Add a new agent interactively');
        console.log('  agent remove <id>        Remove an agent');
        console.log('  agent show <id>          Show agent configuration');
        console.log('  agent reset <id> [...]   Reset agent conversation(s)');
        console.log('  agent provider <id> ...  Show or set agent provider and model');
        console.log('');
        console.log('Teams:');
        console.log('  team list                List all configured teams');
        console.log('  team add                 Add a new team');
        console.log('  team remove <id>         Remove a team');
        console.log('  team show <id>           Show team configuration');
        console.log('  team add-agent <t> <a>   Add an agent to a team');
        console.log('  team remove-agent <t> <a> Remove an agent from a team');
        console.log('  team visualize [id]      Live TUI dashboard');
        console.log('  chatroom <team_id>       Live chat room viewer');
        console.log('');
        console.log('Providers:');
        console.log('  provider [name] [--model model]  Show or switch AI provider');
        console.log('  provider list|add|remove         Manage custom providers');
        console.log('  model [name]                     Show or switch AI model');
        console.log('');
        console.log('Other:');
        console.log('  reset <id> [...]         Reset specific agent conversation(s)');
        console.log('  pairing                  Manage sender approvals');
        console.log('  update                   Update TinyAGI to latest version');
        console.log('  version                  Show current version');
        console.log('');
        break;

    default:
        console.log(`Unknown command: ${command}`);
        console.log('Run "tinyagi --help" for usage information.');
        process.exit(1);
}
