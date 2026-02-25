/**
 * Plugin System for TinyClaw
 *
 * Plugins can be loaded from:
 * - Built-in plugin modules shipped with TinyClaw
 * - Local plugins in .tinyclaw/plugins/
 *
 * Local plugins are disabled by default and can be enabled with
 * TINYCLAW_PLUGINS_ENABLED=1.
 */

import fs from 'fs';
import path from 'path';
import { TINYCLAW_HOME } from './config';
import { log } from './logging';
import type { AgentConfig, MessageData, Settings } from './types';

const EXTERNAL_PLUGINS_ENABLED = process.env.TINYCLAW_PLUGINS_ENABLED === '1';
function resolveTimeoutFromEnv(envName: string, fallback: number, min: number): number {
    const raw = process.env[envName];
    const value = Number(raw ?? fallback);
    if (Number.isFinite(value) && value >= min) {
        return Math.floor(value);
    }
    return fallback;
}

export const PLUGIN_HOOK_TIMEOUT_MS = resolveTimeoutFromEnv(
    'TINYCLAW_PLUGIN_HOOK_TIMEOUT_MS',
    8000,
    1000
);
const PLUGIN_SESSION_END_HOOK_TIMEOUT_MS = resolveTimeoutFromEnv(
    'TINYCLAW_PLUGIN_SESSION_END_HOOK_TIMEOUT_MS',
    30000,
    1000
);
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

export interface ModelHookBaseContext {
    settings: Settings;
    messageData: MessageData;
    channel: string;
    sender: string;
    messageId: string;
    originalMessage: string;
    agentId: string;
    agent: AgentConfig;
    workspacePath: string;
    isInternal: boolean;
    shouldReset: boolean;
    userMessageForSession: string;
}

export interface BeforeModelContext extends ModelHookBaseContext {
    message: string;
}

export interface BeforeModelHookResult {
    message?: string;
    state?: unknown;
}

export interface BeforeModelPipelineResult {
    message: string;
    states: Record<string, unknown>;
}

export interface AfterModelContext extends ModelHookBaseContext {
    message: string;
    response: string;
    state?: unknown;
}

export interface StartupContext {
    settings: Settings;
}

export interface HealthContext {
    settings: Settings;
}

export interface HealthResult {
    status: 'ok' | 'warn' | 'error';
    summary: string;
    details?: Record<string, unknown>;
}

export interface SessionResetContext extends ModelHookBaseContext {
}

export interface SessionEndContext {
    settings: Settings;
    reason: 'shutdown';
    signal?: string;
}

export interface Hooks {
    transformOutgoing?(message: string, ctx: HookContext): string | HookResult | Promise<string | HookResult>;
    transformIncoming?(message: string, ctx: HookContext): string | HookResult | Promise<string | HookResult>;
    onStartup?(ctx: StartupContext): void | Promise<void>;
    onHealth?(ctx: HealthContext): HealthResult | void | Promise<HealthResult | void>;
    onSessionReset?(ctx: SessionResetContext): void | Promise<void>;
    beforeModel?(ctx: BeforeModelContext): string | BeforeModelHookResult | void | Promise<string | BeforeModelHookResult | void>;
    afterModel?(ctx: AfterModelContext): void | Promise<void>;
    onSessionEnd?(ctx: SessionEndContext): void | Promise<void>;
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

interface BuiltinPlugin {
    name: string;
    enabled: () => boolean;
    load: () => Promise<unknown>;
}

const BUILTIN_PLUGINS: BuiltinPlugin[] = [
    {
        name: 'openviking-context',
        enabled: () => process.env.TINYCLAW_OPENVIKING_CONTEXT_PLUGIN !== '0',
        load: () => import('../plugins/openviking-context'),
    },
];

// Internal state
const loadedPlugins: LoadedPlugin[] = [];
const eventHandlers = new Map<string, Array<(event: PluginEvent) => void>>();
let hasLoadedPlugins = false;

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

function extractPluginExports(pluginModule: unknown): { hooks?: Hooks; activate?: (ctx: PluginContext) => void | Promise<void> } {
    const root = (pluginModule && typeof pluginModule === 'object')
        ? pluginModule as Record<string, unknown>
        : {};
    const maybeDefault = (root.default && typeof root.default === 'object')
        ? root.default as Record<string, unknown>
        : null;

    const hooks = (root.hooks || maybeDefault?.hooks) as Hooks | undefined;
    const activate = (root.activate || maybeDefault?.activate) as ((ctx: PluginContext) => void | Promise<void>) | undefined;
    return { hooks, activate };
}

async function loadOnePlugin(pluginName: string, moduleLoader: () => Promise<unknown>): Promise<void> {
    try {
        const pluginModule = await moduleLoader();
        const plugin: LoadedPlugin = { name: pluginName };
        const exports = extractPluginExports(pluginModule);

        if (typeof exports.activate === 'function') {
            const ctx = createPluginContext(pluginName);
            await withTimeout(
                Promise.resolve(exports.activate(ctx)),
                PLUGIN_ACTIVATE_TIMEOUT_MS,
                `plugin '${pluginName}' activate`
            );
        }

        if (exports.hooks) {
            plugin.hooks = exports.hooks;
        }

        loadedPlugins.push(plugin);
        log('INFO', `Loaded plugin: ${pluginName}`);
    } catch (error) {
        log('ERROR', `Failed to load plugin '${pluginName}': ${(error as Error).message}`);
    }
}

/**
 * Load all built-in plugins and local plugins from .tinyclaw/plugins/.
 */
export async function loadPlugins(): Promise<void> {
    if (hasLoadedPlugins) {
        return;
    }
    hasLoadedPlugins = true;

    for (const builtin of BUILTIN_PLUGINS) {
        if (!builtin.enabled()) {
            log('INFO', `Builtin plugin disabled: ${builtin.name}`);
            continue;
        }
        await loadOnePlugin(builtin.name, builtin.load);
    }

    if (!EXTERNAL_PLUGINS_ENABLED) {
        log('INFO', 'External plugins disabled (set TINYCLAW_PLUGINS_ENABLED=1 to enable)');
    } else {
        const pluginsDir = path.join(TINYCLAW_HOME, 'plugins');

        if (!fs.existsSync(pluginsDir)) {
            log('DEBUG', 'No plugins directory found');
        } else {
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

                await loadOnePlugin(pluginName, () => import(indexPath!));
            }
        }
    }

    if (loadedPlugins.length > 0) {
        log('INFO', `${loadedPlugins.length} plugin(s) loaded`);
    }
}

/**
 * Run all transformOutgoing hooks on a message.
 */
export async function runOutgoingHooks(message: string, ctx: HookContext): Promise<HookResult> {
    let text = message;
    let metadata: HookMetadata = {};

    if (loadedPlugins.length === 0) {
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

    if (loadedPlugins.length === 0) {
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

export async function runStartupHooks(ctx: StartupContext): Promise<void> {
    for (const plugin of loadedPlugins) {
        if (plugin.hooks?.onStartup) {
            try {
                await withTimeout(
                    Promise.resolve(plugin.hooks.onStartup(ctx)),
                    PLUGIN_HOOK_TIMEOUT_MS,
                    `plugin '${plugin.name}' onStartup`
                );
            } catch (error) {
                log('ERROR', `Plugin '${plugin.name}' onStartup error: ${(error as Error).message}`);
            }
        }
    }
}

export async function runHealthHooks(ctx: HealthContext): Promise<Array<{ plugin: string; result: HealthResult }>> {
    const results: Array<{ plugin: string; result: HealthResult }> = [];
    for (const plugin of loadedPlugins) {
        if (plugin.hooks?.onHealth) {
            try {
                const health = await withTimeout(
                    Promise.resolve(plugin.hooks.onHealth(ctx)),
                    PLUGIN_HOOK_TIMEOUT_MS,
                    `plugin '${plugin.name}' onHealth`
                );
                if (!health) continue;
                results.push({ plugin: plugin.name, result: health });
            } catch (error) {
                log('ERROR', `Plugin '${plugin.name}' onHealth error: ${(error as Error).message}`);
            }
        }
    }
    return results;
}

export async function runSessionResetHooks(ctx: SessionResetContext): Promise<void> {
    for (const plugin of loadedPlugins) {
        if (plugin.hooks?.onSessionReset) {
            try {
                await withTimeout(
                    Promise.resolve(plugin.hooks.onSessionReset(ctx)),
                    PLUGIN_HOOK_TIMEOUT_MS,
                    `plugin '${plugin.name}' onSessionReset`
                );
            } catch (error) {
                log('ERROR', `Plugin '${plugin.name}' onSessionReset error: ${(error as Error).message}`);
            }
        }
    }
}

export async function runBeforeModelHooks(message: string, ctx: ModelHookBaseContext): Promise<BeforeModelPipelineResult> {
    let nextMessage = message;
    const states: Record<string, unknown> = {};

    for (const plugin of loadedPlugins) {
        if (plugin.hooks?.beforeModel) {
            try {
                const result = await withTimeout(
                    Promise.resolve(plugin.hooks.beforeModel({ ...ctx, message: nextMessage })),
                    PLUGIN_HOOK_TIMEOUT_MS,
                    `plugin '${plugin.name}' beforeModel`
                );

                if (typeof result === 'string') {
                    nextMessage = result;
                    continue;
                }

                if (result && typeof result === 'object') {
                    const node = result as BeforeModelHookResult;
                    if (typeof node.message === 'string') {
                        nextMessage = node.message;
                    }
                    if (Object.prototype.hasOwnProperty.call(node, 'state')) {
                        states[plugin.name] = node.state;
                    }
                }
            } catch (error) {
                log('ERROR', `Plugin '${plugin.name}' beforeModel error: ${(error as Error).message}`);
            }
        }
    }

    return { message: nextMessage, states };
}

export async function runAfterModelHooks(
    response: string,
    ctx: ModelHookBaseContext & { message: string },
    states: Record<string, unknown>
): Promise<void> {
    for (const plugin of loadedPlugins) {
        if (plugin.hooks?.afterModel) {
            try {
                await withTimeout(
                    Promise.resolve(plugin.hooks.afterModel({
                        ...ctx,
                        response,
                        state: states[plugin.name],
                    })),
                    PLUGIN_HOOK_TIMEOUT_MS,
                    `plugin '${plugin.name}' afterModel`
                );
            } catch (error) {
                log('ERROR', `Plugin '${plugin.name}' afterModel error: ${(error as Error).message}`);
            }
        }
    }
}

export async function runSessionEndHooks(ctx: SessionEndContext): Promise<void> {
    for (const plugin of loadedPlugins) {
        if (plugin.hooks?.onSessionEnd) {
            try {
                await withTimeout(
                    Promise.resolve(plugin.hooks.onSessionEnd(ctx)),
                    PLUGIN_SESSION_END_HOOK_TIMEOUT_MS,
                    `plugin '${plugin.name}' onSessionEnd`
                );
            } catch (error) {
                log('ERROR', `Plugin '${plugin.name}' onSessionEnd error: ${(error as Error).message}`);
            }
        }
    }
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
