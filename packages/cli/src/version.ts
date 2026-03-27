/**
 * Version display.
 */

import fs from 'fs';
import path from 'path';
import { SCRIPT_DIR } from '@tinyagi/core';

export function getVersion(): string {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'package.json'), 'utf8'));
        return pkg.version || 'unknown';
    } catch {
        return 'unknown';
    }
}

// ── CLI Dispatch ─────────────────────────────────────────────────────────────

console.log(`tinyagi v${getVersion()}`);
