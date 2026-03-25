#!/usr/bin/env node

import { execSync, spawn } from 'child_process';
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

// ── Prerequisites ────────────────────────────────────────────────────────────

function checkPrerequisites() {
    const missing = [];
    if (!commandExists('node')) missing.push('node (https://nodejs.org/)');
    if (!commandExists('npm')) missing.push('npm (https://nodejs.org/)');
    if (!commandExists('tmux')) missing.push('tmux (brew install tmux / apt install tmux)');
    if (!commandExists('jq')) missing.push('jq (brew install jq / apt install jq)');

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
    // Check installed copy or local repo (dev workflow)
    const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '../../..');
    return fs.existsSync(path.join(INSTALL_DIR, 'lib/tinyagi.sh'))
        || fs.existsSync(path.join(repoRoot, 'lib/tinyagi.sh'));
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
    exec(`chmod +x "${INSTALL_DIR}/bin/tinyagi" "${INSTALL_DIR}/bin/tinyclaw" "${INSTALL_DIR}/lib/tinyagi.sh" "${INSTALL_DIR}/lib/heartbeat-cron.sh" "${INSTALL_DIR}/packages/cli/bin/tinyagi.mjs"`);

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

// ── Run (smart default: onboard if first time, otherwise just start) ────────

async function run() {
    // If settings already exist, just delegate to `tinyagi start` + open office
    if (isInstalled() && fs.existsSync(path.join(os.homedir(), '.tinyagi', 'settings.json'))) {
        delegateToBash(['start'], { sync: true });
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
    try {
        delegateToBash(['start'], { sync: true });
    } catch {
        log(YELLOW, 'TinyAGI may already be running (use tinyagi status to check)');
    }

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

// ── Delegate to bash (tinyagi.sh) ───────────────────────────────────────────

function delegateToBash(args, opts = {}) {
    // Prefer local repo copy when running from source (dev workflow)
    const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '../../..');
    const localSh = path.join(repoRoot, 'lib/tinyagi.sh');
    const installedSh = path.join(INSTALL_DIR, 'lib/tinyagi.sh');
    const tinyagiSh = fs.existsSync(localSh) ? localSh : installedSh;

    if (!fs.existsSync(tinyagiSh)) {
        log(RED, 'TinyAGI is not installed. Run "tinyagi" first.');
        process.exit(1);
    }

    if (opts.sync) {
        execSync(`"${tinyagiSh}" ${args.map(a => `"${a}"`).join(' ')}`, { stdio: 'inherit' });
    } else {
        const child = spawn(tinyagiSh, args, { stdio: 'inherit' });
        child.on('exit', (code) => process.exit(code || 0));
    }
}

// ── CLI Dispatch ─────────────────────────────────────────────────────────────

const command = process.argv[2] || 'run';
const restArgs = process.argv.slice(3);

// Commands that tinyagi handles directly
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

    case '--help':
    case '-h':
    case 'help':
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
        console.log('  attach                   Attach to tmux session');
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
        console.log('  channel start <ch>       Start a channel in the running session');
        console.log('  channel stop <ch>        Stop a channel');
        console.log('  channel reset <ch>       Reset channel auth');
        console.log('  heartbeat start|stop     Start or stop the heartbeat process');
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

    // start/restart: delegate to bash then open office
    case 'start':
    case 'restart':
        delegateToBash([command, ...restArgs], { sync: true });
        openOffice();
        break;

    // All other commands delegate to tinyagi.sh
    default:
        delegateToBash([command, ...restArgs]);
        break;
}
