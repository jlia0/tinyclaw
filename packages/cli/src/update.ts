#!/usr/bin/env node
import * as p from '@clack/prompts';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { SCRIPT_DIR } from '@tinyclaw/core';
import { unwrap } from './shared';

const GITHUB_REPO = 'TinyAGI/tinyclaw';
const UPDATE_CHECK_CACHE = path.join(process.env.HOME || '~', '.tinyclaw', '.update_check');

function getCurrentVersion(): string {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'package.json'), 'utf8'));
        return pkg.version || 'unknown';
    } catch {
        return 'unknown';
    }
}

function getLatestVersion(): string | null {
    try {
        const response = execSync(
            `curl -sS -m 5 "https://api.github.com/repos/${GITHUB_REPO}/releases/latest"`,
            { encoding: 'utf8' },
        );
        const data = JSON.parse(response);
        return (data.tag_name || '').replace(/^v/, '') || null;
    } catch {
        return null;
    }
}

function versionLt(v1: string, v2: string): boolean {
    const a = v1.split('.').map(Number);
    const b = v2.split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i] || 0;
        const y = b[i] || 0;
        if (x < y) return true;
        if (x > y) return false;
    }
    return false;
}

function sessionExists(): boolean {
    try {
        execSync('tmux has-session -t tinyclaw 2>/dev/null', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

async function doUpdate() {
    p.intro('TinyClaw Update');

    // Check if running
    if (sessionExists()) {
        p.log.warn('TinyClaw is currently running.');
        const stopFirst = unwrap(await p.confirm({
            message: 'Stop and update?',
            initialValue: false,
        }));
        if (!stopFirst) {
            p.log.message('Update cancelled.');
            return;
        }
        execSync(`"${path.join(SCRIPT_DIR, 'tinyclaw.sh')}" stop`, { stdio: 'inherit' });
    }

    const currentVersion = getCurrentVersion();
    p.log.info(`Current version: v${currentVersion}`);

    const s = p.spinner();
    s.start('Checking for updates...');
    const latestVersion = getLatestVersion();
    s.stop('Version check complete.');

    if (!latestVersion) {
        p.log.error('Could not fetch latest version. Check your internet connection.');
        return;
    }

    p.log.info(`Latest version: v${latestVersion}`);

    if (!versionLt(currentVersion, latestVersion)) {
        p.log.success('Already up to date!');
        return;
    }

    p.log.info(`Release notes: https://github.com/${GITHUB_REPO}/releases/v${latestVersion}`);

    const confirm = unwrap(await p.confirm({
        message: `Update to v${latestVersion}?`,
        initialValue: true,
    }));
    if (!confirm) {
        p.log.message('Update cancelled.');
        return;
    }

    const spinner = p.spinner();

    // Download
    spinner.start('[1/4] Downloading...');
    const tempDir = execSync('mktemp -d', { encoding: 'utf8' }).trim();
    const bundleUrl = `https://github.com/${GITHUB_REPO}/releases/download/v${latestVersion}/tinyclaw-bundle.tar.gz`;
    try {
        execSync(`curl -fSL -o "${tempDir}/tinyclaw-bundle.tar.gz" "${bundleUrl}"`, { stdio: 'ignore' });
    } catch {
        spinner.stop('Download failed.');
        p.log.error('Download failed.');
        fs.rmSync(tempDir, { recursive: true, force: true });
        return;
    }
    spinner.stop('[1/4] Downloaded.');

    // Backup
    spinner.start('[2/4] Backing up...');
    const backupDir = path.join(
        process.env.HOME || '~', '.tinyclaw', 'backups',
        `v${currentVersion}-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`,
    );
    fs.mkdirSync(backupDir, { recursive: true });
    for (const item of ['bin', 'src', 'dist', 'lib', 'tinyclaw.sh', 'package.json']) {
        const src = path.join(SCRIPT_DIR, item);
        if (fs.existsSync(src)) {
            execSync(`cp -r "${src}" "${backupDir}/"`, { stdio: 'ignore' });
        }
    }
    spinner.stop(`[2/4] Backed up to: ${backupDir}`);

    // Install
    spinner.start('[3/4] Installing...');
    execSync(`cd "${tempDir}" && tar -xzf tinyclaw-bundle.tar.gz && cp -a tinyclaw/. "${SCRIPT_DIR}/"`, { stdio: 'ignore' });
    execSync(`find "${SCRIPT_DIR}/bin" "${SCRIPT_DIR}/lib" "${SCRIPT_DIR}/scripts" -type f \\( -name "*.sh" -o -name "tinyclaw" \\) -exec chmod +x {} +`, { stdio: 'ignore' });
    execSync(`chmod +x "${SCRIPT_DIR}/tinyclaw.sh"`, { stdio: 'ignore' });
    fs.rmSync(tempDir, { recursive: true, force: true });

    // Rebuild native modules
    execSync(`cd "${SCRIPT_DIR}" && npm rebuild better-sqlite3 --silent 2>/dev/null || true`, { stdio: 'ignore' });
    spinner.stop('[3/4] Installed.');

    // Clear cache
    try { fs.unlinkSync(UPDATE_CHECK_CACHE); } catch {}

    p.log.success(`[4/4] Updated to v${latestVersion}!`);
    p.log.info(`Backup location: ${backupDir}`);
    p.outro('Run `tinyclaw start` to begin.');
}

doUpdate().catch(err => {
    p.log.error(err.message);
    process.exit(1);
});
