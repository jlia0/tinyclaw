#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function runParent() {
    const scenarios = ['disabled', 'settings-disabled', 'enabled', 'failure'];

    for (const scenario of scenarios) {
        const child = spawnSync(process.execPath, [__filename, 'child', scenario], {
            stdio: 'pipe',
            encoding: 'utf8',
            env: {
                ...process.env,
            },
        });

        if (child.status !== 0) {
            const stdout = child.stdout || '';
            const stderr = child.stderr || '';
            throw new Error(`scenario '${scenario}' failed\nstdout:\n${stdout}\nstderr:\n${stderr}`);
        }
    }

    console.log('ok - openviking context plugin integration tests passed');
}

function writeStubOpenVikingTool(toolPath) {
    const script = `
const fs = require('fs');

const args = process.argv.slice(2);
const cmd = args[0] || '';
const logFile = process.env.OPENVIKING_TEST_CMD_LOG;
if (logFile) {
  fs.mkdirSync(require('path').dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, args.join(' ') + '\\n');
}

const scenario = process.env.OPENVIKING_TEST_SCENARIO || 'enabled';

function out(data) {
  process.stdout.write(JSON.stringify(data));
}

if (cmd === 'session-create') {
  out({ id: 'sess-1' });
  process.exit(0);
}

if (cmd === 'session-message') {
  const role = args[2] || '';
  if (scenario === 'failure' && role === 'assistant') {
    process.stderr.write('assistant_write_failed');
    process.exit(1);
  }
  out({ ok: true });
  process.exit(0);
}

if (cmd === 'session-commit') {
  out({ ok: true });
  process.exit(0);
}

if (cmd === 'search') {
  out({
    result: {
      memories: [
        {
          uri: 'viking://resources/tinyclaw/memory/test',
          score: 0.98,
          abstract: 'remembered user preference from memory'
        }
      ],
      resources: [],
      skills: []
    }
  });
  process.exit(0);
}

if (cmd === 'write-file') {
  out({ ok: true });
  process.exit(0);
}

if (cmd === 'find-uris') {
  process.stdout.write('');
  process.exit(0);
}

if (cmd === 'read') {
  process.stdout.write('');
  process.exit(0);
}

out({ ok: true });
process.exit(0);
`;

    fs.writeFileSync(toolPath, script, 'utf8');
}

async function runChild(scenario) {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `tinyclaw-ov-plugin-${scenario}-`));
    const tinyclawHome = path.join(tmpRoot, '.tinyclaw-home');
    const workspacePath = path.join(tmpRoot, 'workspace');
    const agentId = 'default';
    const agentPath = path.join(workspacePath, agentId);
    const toolDir = path.join(agentPath, '.tinyclaw', 'tools', 'openviking');
    const toolPath = path.join(toolDir, 'openviking-tool.js');
    const commandLogFile = path.join(tmpRoot, 'ovk-command.log');

    fs.mkdirSync(path.join(tinyclawHome, 'logs'), { recursive: true });
    fs.mkdirSync(path.join(tinyclawHome, 'runtime'), { recursive: true });

    fs.mkdirSync(toolDir, { recursive: true });
    writeStubOpenVikingTool(toolPath);

    process.env.TINYCLAW_HOME = tinyclawHome;
    process.env.OPENVIKING_TEST_CMD_LOG = commandLogFile;
    process.env.OPENVIKING_TEST_SCENARIO = scenario;
    process.env.TINYCLAW_PLUGINS_ENABLED = '0';
    process.env.TINYCLAW_OPENVIKING_AUTOSYNC = '1';
    process.env.TINYCLAW_OPENVIKING_PREFETCH_TIMEOUT_MS = '1500';
    process.env.TINYCLAW_OPENVIKING_COMMIT_TIMEOUT_MS = '1500';

    if (scenario === 'disabled') {
        process.env.TINYCLAW_OPENVIKING_CONTEXT_PLUGIN = '0';
        process.env.TINYCLAW_OPENVIKING_SESSION_NATIVE = '1';
        process.env.TINYCLAW_OPENVIKING_SEARCH_NATIVE = '1';
        process.env.TINYCLAW_OPENVIKING_PREFETCH = '1';
    } else if (scenario === 'settings-disabled') {
        delete process.env.TINYCLAW_OPENVIKING_CONTEXT_PLUGIN;
        process.env.TINYCLAW_OPENVIKING_SESSION_NATIVE = '1';
        process.env.TINYCLAW_OPENVIKING_SEARCH_NATIVE = '1';
        process.env.TINYCLAW_OPENVIKING_PREFETCH = '1';
    } else if (scenario === 'enabled') {
        process.env.TINYCLAW_OPENVIKING_CONTEXT_PLUGIN = '1';
        process.env.TINYCLAW_OPENVIKING_SESSION_NATIVE = '1';
        process.env.TINYCLAW_OPENVIKING_SEARCH_NATIVE = '1';
        process.env.TINYCLAW_OPENVIKING_PREFETCH = '1';
    } else if (scenario === 'failure') {
        process.env.TINYCLAW_OPENVIKING_CONTEXT_PLUGIN = '1';
        process.env.TINYCLAW_OPENVIKING_SESSION_NATIVE = '1';
        process.env.TINYCLAW_OPENVIKING_SEARCH_NATIVE = '0';
        process.env.TINYCLAW_OPENVIKING_PREFETCH = '0';
    } else {
        throw new Error(`unknown scenario: ${scenario}`);
    }

    const plugins = require('../dist/lib/plugins.js');

    await plugins.loadPlugins();

    const settings = scenario === 'settings-disabled'
        ? {
            workspace: {
                path: workspacePath,
            },
            openviking: {
                enabled: false,
            },
        }
        : {
            workspace: {
                path: workspacePath,
            },
        };

    const messageData = {
        channel: 'telegram',
        sender: 'tester',
        senderId: 'u-1',
        message: 'hello',
        timestamp: Date.now(),
        messageId: 'm-1',
    };

    const baseContext = {
        settings,
        messageData,
        channel: 'telegram',
        sender: 'tester',
        messageId: 'm-1',
        originalMessage: 'hello',
        agentId,
        agent: {
            name: 'Default',
            provider: 'anthropic',
            model: 'sonnet',
            working_directory: agentPath,
        },
        workspacePath,
        isInternal: false,
        shouldReset: false,
        userMessageForSession: 'hello',
    };

    const initialMessage = 'what do you remember about me?';
    const before = await plugins.runBeforeModelHooks(initialMessage, baseContext);

    if (scenario === 'disabled' || scenario === 'settings-disabled') {
        assert.strictEqual(before.message, initialMessage, 'disabled plugin should not mutate prompt');
        await plugins.runAfterModelHooks('plain response', { ...baseContext, message: before.message }, before.states);
        await plugins.runSessionEndHooks({ settings, reason: 'shutdown', signal: 'TEST' });
        const called = fs.existsSync(commandLogFile) ? fs.readFileSync(commandLogFile, 'utf8').trim() : '';
        assert.strictEqual(called, '', 'disabled plugin must not call openviking tool');
        return;
    }

    if (scenario === 'enabled') {
        assert.match(before.message, /\[OpenViking Retrieved Context\]/, 'enabled plugin should inject context');
        assert.match(before.message, /\[End OpenViking Context\]/, 'enabled plugin should append end marker');

        await plugins.runAfterModelHooks(
            'assistant response from model',
            { ...baseContext, message: before.message },
            before.states
        );
        await plugins.runSessionEndHooks({ settings, reason: 'shutdown', signal: 'TEST' });

        const called = fs.readFileSync(commandLogFile, 'utf8');
        assert.match(called, /session-create/, 'enabled plugin should create native session');
        assert.match(called, /search/, 'enabled plugin should run native search prefetch');
        assert.match(called, /session-message sess-1 user/, 'enabled plugin should write native user message');
        assert.match(called, /session-message sess-1 assistant/, 'enabled plugin should write native assistant message');
        return;
    }

    await plugins.runAfterModelHooks(
        'assistant fallback response',
        { ...baseContext, message: before.message },
        before.states
    );
    await plugins.runSessionEndHooks({ settings, reason: 'shutdown', signal: 'TEST' });

    const called = fs.readFileSync(commandLogFile, 'utf8');
    assert.match(called, /session-message sess-1 assistant/, 'failure scenario should attempt native assistant write');
    assert.match(called, /write-file/, 'failure scenario should fallback to legacy write-file sync');

    const activeSessionFile = path.join(workspacePath, agentId, '.tinyclaw', 'runtime', 'openviking', 'active-session.md');
    assert.ok(fs.existsSync(activeSessionFile), 'failure fallback should persist local legacy markdown session');
    const markdown = fs.readFileSync(activeSessionFile, 'utf8');
    assert.match(markdown, /assistant fallback response/, 'legacy markdown session should contain assistant response');
}

(async () => {
    if (process.argv[2] === 'child') {
        await runChild(process.argv[3]);
        process.exit(0);
    }

    runParent();
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
