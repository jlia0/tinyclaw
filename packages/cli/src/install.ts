/**
 * Installation, onboarding, and first-time setup.
 */

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { TINYAGI_HOME, SCRIPT_DIR } from '@tinyagi/core';
import { startDaemon, isRunning, openOffice } from './daemon.ts';

// ── Constants ────────────────────────────────────────────────────────────────

const GITHUB_REPO = 'TinyAGI/tinyagi';

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const NC = '\x1b[0m';

function log(color: string, msg: string): void {
    process.stdout.write(`${color}${msg}${NC}\n`);
}

function commandExists(cmd: string): boolean {
    try {
        execSync(`command -v ${cmd}`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function exec(cmd: string, opts: object = {}): void {
    execSync(cmd, { stdio: 'inherit', ...opts });
}

// ── Prerequisites ────────────────────────────────────────────────────────────

export function checkPrerequisites(): void {
    const missing: string[] = [];
    if (!commandExists('node')) missing.push('node (https://nodejs.org/)');
    if (!commandExists('npm')) missing.push('npm (https://nodejs.org/)');

    if (missing.length > 0) {
        log(RED, 'Missing prerequisites:');
        for (const dep of missing) {
            console.log(`  - ${dep}`);
        }
        process.exit(1);
    }

    if (!commandExists('claude') && !commandExists('codex')) {
        log(YELLOW, "Warning: neither 'claude' nor 'codex' CLI found");
        console.log('  Install Claude: npm install -g @anthropic-ai/claude-code');
        console.log('  Install Codex:  npm install -g @openai/codex');
        console.log('');
    }
}

// ── Installation ─────────────────────────────────────────────────────────────

export function isInstalled(): boolean {
    return fs.existsSync(path.join(SCRIPT_DIR, 'packages/main/dist/index.js'))
        || fs.existsSync(path.join(TINYAGI_HOME, 'packages/main/dist/index.js'));
}

export async function install(): Promise<void> {
    log(BLUE, 'Installing TinyAGI...');
    console.log(`  Directory: ${TINYAGI_HOME}`);
    console.log('');

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

            try {
                execSync(`curl -fsSL -I "${bundleUrl}"`, { stdio: 'ignore' });
                log(GREEN, `✓ Pre-built bundle available (${tag})`);

                fs.mkdirSync(TINYAGI_HOME, { recursive: true });
                exec(`curl -fsSL "${bundleUrl}" | tar -xz -C "${TINYAGI_HOME}" --strip-components=1`);

                exec(`cd "${TINYAGI_HOME}" && npm rebuild better-sqlite3 --silent 2>/dev/null || true`);
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
        exec(`git clone --depth 1 "https://github.com/${GITHUB_REPO}.git" "${TINYAGI_HOME}"`);

        log(BLUE, 'Installing dependencies...');
        exec(`cd "${TINYAGI_HOME}" && PUPPETEER_SKIP_DOWNLOAD=true npm install --silent`);

        log(BLUE, 'Building...');
        exec(`cd "${TINYAGI_HOME}" && npm run build --silent`);

        log(BLUE, 'Pruning dev dependencies...');
        exec(`cd "${TINYAGI_HOME}" && npm prune --omit=dev --silent`);
    }

    exec(`chmod +x "${TINYAGI_HOME}/bin/tinyagi" "${TINYAGI_HOME}/bin/tinyclaw" "${TINYAGI_HOME}/packages/cli/bin/tinyagi.mjs"`);

    installCli();

    log(GREEN, '✓ TinyAGI installed');
    console.log('');
}

// ── CLI Symlink ──────────────────────────────────────────────────────────────

export function installCli(): void {
    const tinyagiSrc = path.join(TINYAGI_HOME, 'packages/cli/bin/tinyagi.mjs');
    let installDir = '';

    try {
        fs.accessSync('/usr/local/bin', fs.constants.W_OK);
        installDir = '/usr/local/bin';
    } catch {
        installDir = path.join(os.homedir(), '.local/bin');
        fs.mkdirSync(installDir, { recursive: true });
    }

    const symlinkPath = path.join(installDir, 'tinyagi');

    try {
        const stat = fs.lstatSync(symlinkPath);
        if (stat.isSymbolicLink() || stat.isFile()) {
            fs.unlinkSync(symlinkPath);
        }
    } catch {
        // Doesn't exist
    }

    fs.symlinkSync(tinyagiSrc, symlinkPath);
    log(GREEN, `✓ 'tinyagi' command installed at ${symlinkPath}`);

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

// ── Run (smart default) ──────────────────────────────────────────────────────

export async function run(): Promise<void> {
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

    checkPrerequisites();

    if (!isInstalled()) {
        await install();
    } else {
        log(GREEN, '✓ TinyAGI already installed');
        console.log('');
    }

    // writeDefaults is loaded dynamically since it's in lib/defaults.mjs
    // @ts-ignore — untyped .mjs helper
    const { writeDefaults } = await import('../lib/defaults.mjs') as { writeDefaults: () => boolean };
    writeDefaults();
    log(GREEN, '✓ Default settings written');
    console.log(`  Workspace: ~/tinyagi-workspace`);
    console.log(`  Agent: tinyagi (anthropic/opus)`);
    console.log('');

    await startDaemon();
    await openOffice();
}

// ── CLI Dispatch ─────────────────────────────────────────────────────────────

const command = process.argv[2];

switch (command) {
    case 'run':
        await run();
        break;
    case 'install':
        checkPrerequisites();
        if (isInstalled()) {
            log(GREEN, '✓ TinyAGI already installed');
        } else {
            await install();
        }
        break;
}
