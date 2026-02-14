import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { NormalizedSandboxConfig, SandboxMode } from './types';

export type ErrorClass = 'terminal' | 'transient';

export interface SandboxPathMapping {
    containerPrefix: string;
    hostPrefix: string;
}

export interface InvocationRequest {
    agentId: string;
    provider: 'anthropic' | 'openai';
    command: string;
    args: string[];
    workingDir: string;
    sandbox: NormalizedSandboxConfig;
}

export interface InvocationResult {
    stdout: string;
    stderr: string;
    durationMs: number;
    mode: SandboxMode;
    pathMappings: SandboxPathMapping[];
}

export class SandboxInvocationError extends Error {
    readonly classification: ErrorClass;
    readonly mode: SandboxMode;
    readonly remediation?: string;
    readonly userMessage: string;

    constructor(
        message: string,
        opts: {
            classification: ErrorClass;
            mode: SandboxMode;
            remediation?: string;
            userMessage?: string;
        }
    ) {
        super(message);
        this.name = 'SandboxInvocationError';
        this.classification = opts.classification;
        this.mode = opts.mode;
        this.remediation = opts.remediation;
        this.userMessage = opts.userMessage ||
            'Sorry, I could not run this request inside the configured sandbox.';
    }
}

interface ProcessResult {
    stdout: string;
    stderr: string;
    code: number | null;
    timedOut: boolean;
    durationMs: number;
}

function runProcess(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const child = spawn(command, args, {
            cwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
        });

        child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
        });

        const timeoutHandle = setTimeout(() => {
            timedOut = true;
            try {
                child.kill('SIGKILL');
            } catch {
                // Ignore kill errors during timeout cleanup.
            }
        }, timeoutMs);

        child.on('error', (error) => {
            clearTimeout(timeoutHandle);
            reject(error);
        });

        child.on('close', (code) => {
            clearTimeout(timeoutHandle);
            resolve({
                stdout,
                stderr,
                code,
                timedOut,
                durationMs: Date.now() - startedAt,
            });
        });
    });
}

function getRequiredEnv(provider: 'anthropic' | 'openai'): string {
    return provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
}

function buildAllowedEnv(base: NodeJS.ProcessEnv, allowlist: string[]): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const key of allowlist) {
        const value = base[key];
        if (typeof value !== 'undefined') {
            env[key] = value;
        }
    }
    return env;
}

function dockerNetworkArg(network: string): string {
    if (network === 'none') return 'none';
    return 'bridge';
}

function classifyContainerFailure(stderr: string): ErrorClass {
    const text = stderr.toLowerCase();
    if (
        text.includes('unknown flag') ||
        text.includes('no such file or directory') ||
        text.includes('not found') ||
        text.includes('invalid argument') ||
        text.includes('for "--mount" flag') ||
        text.includes('invalid reference format') ||
        text.includes('permission denied')
    ) {
        return 'terminal';
    }
    return 'transient';
}

function ensureContainerNetworkAllowed(mode: SandboxMode, network: string): void {
    if (network === 'none') {
        throw new SandboxInvocationError(
            `Sandbox mode "${mode}" is configured with network=none, which is incompatible with cloud provider CLIs.`,
            {
                classification: 'terminal',
                mode,
                remediation: 'Set sandbox network to "default" or "restricted" in settings.json.',
                userMessage: 'Sandbox network is set to "none", so cloud model calls are blocked. Update sandbox network settings and retry.',
            }
        );
    }
}

function getContainerPathMappings(mode: SandboxMode, hostWorkingDir: string, mappingMode: 'mapped' | 'same-path'): {
    containerWorkingDir: string;
    pathMappings: SandboxPathMapping[];
} {
    if (mappingMode === 'same-path') {
        return {
            containerWorkingDir: hostWorkingDir,
            pathMappings: [{ containerPrefix: hostWorkingDir, hostPrefix: hostWorkingDir }],
        };
    }

    return {
        containerWorkingDir: '/workspace',
        pathMappings: [{ containerPrefix: '/workspace', hostPrefix: hostWorkingDir }],
    };
}

function requiredBinaryForMode(mode: SandboxMode, request: InvocationRequest): string {
    if (mode === 'docker') return 'docker';
    if (mode === 'apple') return request.sandbox.apple.runtime_command;
    return request.command;
}

function wrapMissingBinaryError(mode: SandboxMode, binary: string): SandboxInvocationError {
    return new SandboxInvocationError(
        `Required runtime "${binary}" is not available for sandbox mode "${mode}".`,
        {
            classification: 'terminal',
            mode,
            remediation: `Install "${binary}" and run "tinyclaw sandbox doctor".`,
            userMessage: `Sandbox runtime "${binary}" is not installed. Run "tinyclaw sandbox doctor" after installing it.`,
        }
    );
}

async function runHost(request: InvocationRequest): Promise<InvocationResult> {
    const env = { ...process.env };
    const timeoutMs = request.sandbox.timeout_seconds * 1000;

    const result = await runProcess(request.command, request.args, request.workingDir, env, timeoutMs);
    if (result.timedOut) {
        throw new SandboxInvocationError(
            `Host invocation timed out after ${request.sandbox.timeout_seconds}s.`,
            {
                classification: 'transient',
                mode: 'host',
                remediation: 'Increase sandbox.timeout_seconds or optimize the task.',
                userMessage: 'The request timed out while running on host. Please retry.',
            }
        );
    }

    if (result.code !== 0) {
        throw new SandboxInvocationError(
            result.stderr.trim() || `Command exited with code ${result.code}`,
            {
                classification: 'transient',
                mode: 'host',
                userMessage: 'The provider CLI returned an error. Please retry in a moment.',
            }
        );
    }

    return {
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
        mode: 'host',
        pathMappings: [],
    };
}

async function runContainer(request: InvocationRequest, mode: 'docker' | 'apple'): Promise<InvocationResult> {
    const runtimeCommand = mode === 'docker' ? 'docker' : request.sandbox.apple.runtime_command;
    const runtimeBinary = requiredBinaryForMode(mode, request);
    const timeoutMs = request.sandbox.timeout_seconds * 1000;
    const runtimeCfg = mode === 'docker' ? request.sandbox.docker : request.sandbox.apple;
    const network = runtimeCfg.network;
    ensureContainerNetworkAllowed(mode, network);

    const requiredEnv = getRequiredEnv(request.provider);
    const allowedEnv = buildAllowedEnv(process.env, request.sandbox.env_allowlist);
    if (!request.sandbox.env_allowlist.includes(requiredEnv)) {
        throw new SandboxInvocationError(
            `Required API key env "${requiredEnv}" is not in sandbox.env_allowlist.`,
            {
                classification: 'terminal',
                mode,
                remediation: `Add "${requiredEnv}" to sandbox.env_allowlist in settings.json.`,
                userMessage: `Sandbox is missing required env allowlist entry: ${requiredEnv}.`,
            }
        );
    }
    if (!allowedEnv[requiredEnv]) {
        throw new SandboxInvocationError(
            `Required API key env "${requiredEnv}" is not set.`,
            {
                classification: 'terminal',
                mode,
                remediation: `Export ${requiredEnv} before starting TinyClaw.`,
                userMessage: `Sandbox requires ${requiredEnv}, but it is not set in the environment.`,
            }
        );
    }

    const { containerWorkingDir, pathMappings } = getContainerPathMappings(
        mode,
        request.workingDir,
        request.sandbox.path_mapping_mode
    );
    const containerHome = path.posix.join(containerWorkingDir, '.tinyclaw-home');
    const hostHome = path.join(request.workingDir, '.tinyclaw-home');
    if (!fs.existsSync(hostHome)) {
        fs.mkdirSync(hostHome, { recursive: true });
    }

    const args: string[] = ['run', '--rm'];
    args.push('--workdir', containerWorkingDir);
    args.push('--network', dockerNetworkArg(network));
    args.push('--memory', runtimeCfg.memory);
    args.push('--cpus', runtimeCfg.cpus);

    if (mode === 'docker') {
        args.push('--pull', 'missing');
        args.push('--pids-limit', String(request.sandbox.docker.pids_limit));
        args.push('--security-opt', 'no-new-privileges');
        args.push('--cap-drop', 'ALL');
        args.push('--read-only');
        args.push('--tmpfs', '/tmp:rw,noexec,nosuid,size=256m');
    }

    args.push('--user', '1000:1000');
    args.push('--mount', `type=bind,src=${request.workingDir},dst=${containerWorkingDir}`);
    args.push('--env', `HOME=${containerHome}`);

    for (const [key, value] of Object.entries(allowedEnv)) {
        if (typeof value !== 'undefined') {
            args.push('--env', `${key}=${value}`);
        }
    }

    args.push(runtimeCfg.image);
    args.push(request.command, ...request.args);

    let result: ProcessResult;
    try {
        result = await runProcess(runtimeCommand, args, request.workingDir, { ...process.env }, timeoutMs);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw wrapMissingBinaryError(mode, runtimeBinary);
        }
        throw new SandboxInvocationError(
            `Failed to start ${mode} runtime: ${(error as Error).message}`,
            {
                classification: 'terminal',
                mode,
                remediation: `Ensure "${runtimeBinary}" is installed and available in PATH.`,
            }
        );
    }

    if (result.timedOut) {
        throw new SandboxInvocationError(
            `${mode} invocation timed out after ${request.sandbox.timeout_seconds}s.`,
            {
                classification: 'transient',
                mode,
                remediation: 'Increase sandbox.timeout_seconds or optimize the task.',
                userMessage: 'Sandbox execution timed out. Please retry.',
            }
        );
    }

    if (result.code !== 0) {
        const classification = classifyContainerFailure(result.stderr);
        throw new SandboxInvocationError(
            result.stderr.trim() || `${mode} runtime exited with code ${result.code}`,
            {
                classification,
                mode,
                remediation: classification === 'terminal'
                    ? `Run "tinyclaw sandbox doctor" and verify image "${runtimeCfg.image}".`
                    : `Retry after checking ${mode} runtime health.`,
                userMessage: classification === 'terminal'
                    ? `Sandbox runtime error in ${mode} mode. Run "tinyclaw sandbox doctor".`
                    : 'Sandbox execution failed due to a transient runtime issue. Please retry.',
            }
        );
    }

    return {
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
        mode,
        pathMappings,
    };
}

export async function runInSandbox(request: InvocationRequest): Promise<InvocationResult> {
    if (request.sandbox.mode === 'host') {
        return runHost(request);
    }

    if (request.sandbox.mode === 'docker') {
        return runContainer(request, 'docker');
    }

    return runContainer(request, 'apple');
}
