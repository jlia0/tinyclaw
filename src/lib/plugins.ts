/**
 * Plugin System for TinyClaw
 *
 * Plugins auto-discover from .tinyclaw/plugins/ folder.
 * Each plugin exports an activate() function and/or a hooks object from index.ts.
 */

import fs from 'fs';
import path from 'path';
import { TINYCLAW_HOME } from './config';
import { log, onEvent } from './logging';

const PLUGINS_ENABLED = process.env.TINYCLAW_PLUGINS_ENABLED === '1';
const PLUGIN_HOOK_TIMEOUT_MS = Number(process.env.TINYCLAW_PLUGIN_HOOK_TIMEOUT_MS || 1500);
const PLUGIN_ACTIVATE_TIMEOUT_MS = Number(process.env.TINYCLAW_PLUGIN_ACTIVATE_TIMEOUT_MS || 3000);

// Types
export interface PluginEvent {
    type: string;
    timestamp: number;
    [key: string]: unknown;
}

export interface HookContext {
    channel: string;
    sender: string;
    messageId: string;
    originalMessage: string;
}

export interface HookMetadata {
    parseMode?: string;
    [key: string]: unknown;
}

export interface HookResult {
    text: string;
    metadata: HookMetadata;
}

export interface Hooks {
    transformOutgoing?(message: string, ctx: HookContext): string | HookResult | Promise<string | HookResult>;
    transformIncoming?(message: string, ctx: HookContext): string | HookResult | Promise<string | HookResult>;
}

export interface PluginContext {
    on(eventType: string | '*', handler: (event: PluginEvent) => void): void;
    log(level: string, message: string): void;
    getTinyClawHome(): string;
}

interface LoadedPlugin {
    name: string;
    hooks?: Hooks;
}

// Internal state
const loadedPlugins: LoadedPlugin[] = [];
const eventHandlers = new Map<string, Array<(event: PluginEvent) => void>>();

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
    }
}

/**
 * Create the plugin context passed to activate() functions.
 */
function createPluginContext(pluginName: string): PluginContext {
    return {
        on(eventType: string, handler: (event: PluginEvent) => void): void {
            const handlers = eventHandlers.get(eventType) || [];
            handlers.push(handler);
            eventHandlers.set(eventType, handlers);
        },
        log(level: string, message: string): void {
            log(level, `[plugin:${pluginName}] ${message}`);
        },
        getTinyClawHome(): string {
            return TINYCLAW_HOME;
        },
    };
}

/**
 * Load all plugins from .tinyclaw/plugins/.
 * Each plugin directory should have an index.ts/index.js that exports:
 *   - activate(ctx: PluginContext): void  (optional)
 *   - hooks: Hooks                        (optional)
 */
export async function loadPlugins(): Promise<void> {
    if (!PLUGINS_ENABLED) {
        log('INFO', 'Plugins disabled (set TINYCLAW_PLUGINS_ENABLED=1 to enable)');
        return;
    }

    const pluginsDir = path.join(TINYCLAW_HOME, 'plugins');

    if (!fs.existsSync(pluginsDir)) {
        log('DEBUG', 'No plugins directory found');
        return;
    }

    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const pluginName = entry.name;
        const pluginDir = path.join(pluginsDir, pluginName);

        // Try to load index.js or index.ts (compiled)
        const indexJs = path.join(pluginDir, 'index.js');
        const indexTs = path.join(pluginDir, 'index.ts');

        let indexPath: string | null = null;
        if (fs.existsSync(indexJs)) {
            indexPath = indexJs;
        } else if (fs.existsSync(indexTs)) {
            indexPath = indexTs;
        }

        if (!indexPath) {
            log('WARN', `Plugin '${pluginName}' has no index.js or index.ts, skipping`);
            continue;
        }

        try {
            // Dynamic import
            const pluginModule = await import(indexPath);
            const plugin: LoadedPlugin = { name: pluginName };

            // Call activate() if present
            if (typeof pluginModule.activate === 'function') {
                const ctx = createPluginContext(pluginName);
                await withTimeout(
                    Promise.resolve(pluginModule.activate(ctx)),
                    PLUGIN_ACTIVATE_TIMEOUT_MS,
                    `plugin '${pluginName}' activate`
                );
            }

            // Store hooks if present
            if (pluginModule.hooks) {
                plugin.hooks = pluginModule.hooks;
            }

            loadedPlugins.push(plugin);
            log('INFO', `Loaded plugin: ${pluginName}`);
        } catch (error) {
            log('ERROR', `Failed to load plugin '${pluginName}': ${(error as Error).message}`);
        }
    }

    if (loadedPlugins.length > 0) {
        log('INFO', `${loadedPlugins.length} plugin(s) loaded`);

        // Register as an event listener so all emitEvent() calls get broadcast to plugins
        onEvent((type, data) => {
            broadcastEvent({ type, timestamp: Date.now(), ...data });
        });
    }
}

/**
 * Run all transformOutgoing hooks on a message.
 */
export async function runOutgoingHooks(message: string, ctx: HookContext): Promise<HookResult> {
    let text = message;
    let metadata: HookMetadata = {};

    if (!PLUGINS_ENABLED || loadedPlugins.length === 0) {
        return { text, metadata };
    }

    for (const plugin of loadedPlugins) {
        if (plugin.hooks?.transformOutgoing) {
            try {
                const result = await withTimeout(
                    Promise.resolve(plugin.hooks.transformOutgoing(text, ctx)),
                    PLUGIN_HOOK_TIMEOUT_MS,
                    `plugin '${plugin.name}' transformOutgoing`
                );
                if (typeof result === 'string') {
                    text = result;
                } else {
                    text = result.text;
                    metadata = { ...metadata, ...result.metadata };
                }
            } catch (error) {
                log('ERROR', `Plugin '${plugin.name}' transformOutgoing error: ${(error as Error).message}`);
            }
        }
    }

    return { text, metadata };
}

/**
 * Run all transformIncoming hooks on a message.
 */
export async function runIncomingHooks(message: string, ctx: HookContext): Promise<HookResult> {
    let text = message;
    let metadata: HookMetadata = {};

    if (!PLUGINS_ENABLED || loadedPlugins.length === 0) {
        return { text, metadata };
    }

    for (const plugin of loadedPlugins) {
        if (plugin.hooks?.transformIncoming) {
            try {
                const result = await withTimeout(
                    Promise.resolve(plugin.hooks.transformIncoming(text, ctx)),
                    PLUGIN_HOOK_TIMEOUT_MS,
                    `plugin '${plugin.name}' transformIncoming`
                );
                if (typeof result === 'string') {
                    text = result;
                } else {
                    text = result.text;
                    metadata = { ...metadata, ...result.metadata };
                }
            } catch (error) {
                log('ERROR', `Plugin '${plugin.name}' transformIncoming error: ${(error as Error).message}`);
            }
        }
    }

    return { text, metadata };
}

/**
 * Broadcast an event to all registered handlers.
 */
export function broadcastEvent(event: PluginEvent): void {
    // Call specific event type handlers
    const typeHandlers = eventHandlers.get(event.type) || [];
    for (const handler of typeHandlers) {
        try {
            handler(event);
        } catch (error) {
            log('ERROR', `Plugin event handler error: ${(error as Error).message}`);
        }
    }

    // Call wildcard handlers
    const wildcardHandlers = eventHandlers.get('*') || [];
    for (const handler of wildcardHandlers) {
        try {
            handler(event);
        } catch (error) {
            log('ERROR', `Plugin wildcard handler error: ${(error as Error).message}`);
        }
    }
}
