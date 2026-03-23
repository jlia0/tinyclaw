export type { AgentAdapter, InvokeOptions } from './types';

import { AgentAdapter } from './types';
import { claudeAdapter } from './claude';
import { codexAdapter } from './codex';
import { opencodeAdapter } from './opencode';
import { novitaAdapter } from './novita';

/** Provider → adapter registry, built automatically from adapter declarations. */
const registry = new Map<string, AgentAdapter>();

function register(adapter: AgentAdapter) {
    for (const provider of adapter.providers) {
        registry.set(provider, adapter);
    }
}

// Auto-register built-in adapters
register(claudeAdapter);
register(codexAdapter);
register(opencodeAdapter);
register(novitaAdapter);

export function getAdapter(provider: string): AgentAdapter | undefined {
    return registry.get(provider);
}

export function registerAdapter(adapter: AgentAdapter): void {
    register(adapter);
}
