#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function runParent() {
    const scenarios = [
        'disabled',
        'settings-disabled',
        'enabled',
        'mode-never',
        'mode-rule-force',
        'mode-rule-skip',
        'mode-rule-then-llm-yes',
        'mode-rule-then-llm-timeout',
        'session-scope-empty',
        'failure',
        'idle-timeout',
        'task-switch',
        'shutdown-drain',
    ];

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
  fs.writeSync(1, JSON.stringify(data));
}

if (cmd === 'session-create') {
  if (scenario === 'idle-timeout' || scenario === 'task-switch') {
    out({ id: 'sess-2' });
  } else {
    out({ id: 'sess-1' });
  }
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
  const hasSessionScope = args.includes('--session-id');
  if (scenario === 'session-scope-empty' && hasSessionScope) {
    out({
      status: 'ok',
      result: {
        memories: [],
        resources: [],
        skills: [],
        total: 0,
        query_plan: { queries: [] }
      }
    });
    process.exit(0);
  }
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

function writeStubCodex(toolPath) {
    const script = `#!/usr/bin/env node
const fs = require('fs');

const logFile = process.env.OPENVIKING_TEST_LLM_CMD_LOG;
if (logFile) {
  fs.mkdirSync(require('path').dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, process.argv.slice(2).join(' ') + '\\n');
}

const scenario = process.env.OPENVIKING_TEST_SCENARIO || '';
if (scenario === 'mode-rule-then-llm-timeout') {
  setTimeout(() => {
    fs.writeSync(1, '{"need_memory": true, "reason": "late"}');
  }, 2000);
  return;
}

fs.writeSync(1, '{"need_memory": true, "reason": "explicit memory intent"}');
`;
    fs.writeFileSync(toolPath, script, 'utf8');
    fs.chmodSync(toolPath, 0o755);
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
    const llmCommandLogFile = path.join(tmpRoot, 'llm-command.log');
    const sessionMapDir = path.join(tinyclawHome, 'runtime', 'openviking');
    const sessionMapFile = path.join(sessionMapDir, 'session-map.json');
    const queueLogFile = path.join(tinyclawHome, 'logs', 'queue.log');
    const binDir = path.join(tmpRoot, 'bin');
    const codexStubPath = path.join(binDir, 'codex');

    fs.mkdirSync(path.join(tinyclawHome, 'logs'), { recursive: true });
    fs.mkdirSync(path.join(tinyclawHome, 'runtime'), { recursive: true });

    fs.mkdirSync(toolDir, { recursive: true });
    writeStubOpenVikingTool(toolPath);
    fs.mkdirSync(binDir, { recursive: true });
    writeStubCodex(codexStubPath);

    process.env.TINYCLAW_HOME = tinyclawHome;
    process.env.PATH = `${binDir}:${process.env.PATH}`;
    process.env.OPENVIKING_TEST_CMD_LOG = commandLogFile;
    process.env.OPENVIKING_TEST_LLM_CMD_LOG = llmCommandLogFile;
    process.env.OPENVIKING_TEST_SCENARIO = scenario;
    process.env.TINYCLAW_PLUGINS_ENABLED = '0';
    process.env.TINYCLAW_OPENVIKING_AUTOSYNC = '1';
    process.env.TINYCLAW_OPENVIKING_PREFETCH_TIMEOUT_MS = '1500';
    process.env.TINYCLAW_OPENVIKING_COMMIT_TIMEOUT_MS = '1500';
    process.env.TINYCLAW_OPENVIKING_PREFETCH_GATE_MODE = 'always';
    process.env.TINYCLAW_OPENVIKING_PREFETCH_FORCE_PATTERNS = 'according to memory,根据记忆,你还记得';
    process.env.TINYCLAW_OPENVIKING_PREFETCH_SKIP_PATTERNS = 'latest news,实时价格,执行命令';
    process.env.TINYCLAW_OPENVIKING_PREFETCH_RULE_THRESHOLD = '3';
    process.env.TINYCLAW_OPENVIKING_PREFETCH_LLM_AMBIGUITY_LOW = '1';
    process.env.TINYCLAW_OPENVIKING_PREFETCH_LLM_AMBIGUITY_HIGH = '2';
    process.env.TINYCLAW_OPENVIKING_PREFETCH_LLM_TIMEOUT_MS = '500';

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
    } else if (scenario === 'mode-never') {
        process.env.TINYCLAW_OPENVIKING_CONTEXT_PLUGIN = '1';
        process.env.TINYCLAW_OPENVIKING_SESSION_NATIVE = '1';
        process.env.TINYCLAW_OPENVIKING_SEARCH_NATIVE = '1';
        process.env.TINYCLAW_OPENVIKING_PREFETCH = '1';
        process.env.TINYCLAW_OPENVIKING_PREFETCH_GATE_MODE = 'never';
    } else if (scenario === 'mode-rule-force') {
        process.env.TINYCLAW_OPENVIKING_CONTEXT_PLUGIN = '1';
        process.env.TINYCLAW_OPENVIKING_SESSION_NATIVE = '1';
        process.env.TINYCLAW_OPENVIKING_SEARCH_NATIVE = '1';
        process.env.TINYCLAW_OPENVIKING_PREFETCH = '1';
        process.env.TINYCLAW_OPENVIKING_PREFETCH_GATE_MODE = 'rule';
    } else if (scenario === 'mode-rule-skip') {
        process.env.TINYCLAW_OPENVIKING_CONTEXT_PLUGIN = '1';
        process.env.TINYCLAW_OPENVIKING_SESSION_NATIVE = '1';
        process.env.TINYCLAW_OPENVIKING_SEARCH_NATIVE = '1';
        process.env.TINYCLAW_OPENVIKING_PREFETCH = '1';
        process.env.TINYCLAW_OPENVIKING_PREFETCH_GATE_MODE = 'rule';
    } else if (scenario === 'mode-rule-then-llm-yes') {
        process.env.TINYCLAW_OPENVIKING_CONTEXT_PLUGIN = '1';
        process.env.TINYCLAW_OPENVIKING_SESSION_NATIVE = '1';
        process.env.TINYCLAW_OPENVIKING_SEARCH_NATIVE = '1';
        process.env.TINYCLAW_OPENVIKING_PREFETCH = '1';
        process.env.TINYCLAW_OPENVIKING_PREFETCH_GATE_MODE = 'rule_then_llm';
        process.env.TINYCLAW_OPENVIKING_PREFETCH_LLM_TIMEOUT_MS = '800';
    } else if (scenario === 'mode-rule-then-llm-timeout') {
        process.env.TINYCLAW_OPENVIKING_CONTEXT_PLUGIN = '1';
        process.env.TINYCLAW_OPENVIKING_SESSION_NATIVE = '1';
        process.env.TINYCLAW_OPENVIKING_SEARCH_NATIVE = '1';
        process.env.TINYCLAW_OPENVIKING_PREFETCH = '1';
        process.env.TINYCLAW_OPENVIKING_PREFETCH_GATE_MODE = 'rule_then_llm';
        process.env.TINYCLAW_OPENVIKING_PREFETCH_LLM_TIMEOUT_MS = '120';
    } else if (scenario === 'session-scope-empty') {
        process.env.TINYCLAW_OPENVIKING_CONTEXT_PLUGIN = '1';
        process.env.TINYCLAW_OPENVIKING_SESSION_NATIVE = '1';
        process.env.TINYCLAW_OPENVIKING_SEARCH_NATIVE = '1';
        process.env.TINYCLAW_OPENVIKING_PREFETCH = '1';
    } else if (scenario === 'failure') {
        process.env.TINYCLAW_OPENVIKING_CONTEXT_PLUGIN = '1';
        process.env.TINYCLAW_OPENVIKING_SESSION_NATIVE = '1';
        process.env.TINYCLAW_OPENVIKING_SEARCH_NATIVE = '0';
        process.env.TINYCLAW_OPENVIKING_PREFETCH = '0';
    } else if (scenario === 'idle-timeout') {
        process.env.TINYCLAW_OPENVIKING_CONTEXT_PLUGIN = '1';
        process.env.TINYCLAW_OPENVIKING_SESSION_NATIVE = '1';
        process.env.TINYCLAW_OPENVIKING_SEARCH_NATIVE = '1';
        process.env.TINYCLAW_OPENVIKING_PREFETCH = '1';
        process.env.TINYCLAW_OPENVIKING_SESSION_IDLE_TIMEOUT_MS = '1000';
    } else if (scenario === 'task-switch') {
        process.env.TINYCLAW_OPENVIKING_CONTEXT_PLUGIN = '1';
        process.env.TINYCLAW_OPENVIKING_SESSION_NATIVE = '1';
        process.env.TINYCLAW_OPENVIKING_SEARCH_NATIVE = '0';
        process.env.TINYCLAW_OPENVIKING_PREFETCH = '0';
    } else if (scenario === 'shutdown-drain') {
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

    if ([
        'enabled',
        'mode-never',
        'mode-rule-force',
        'mode-rule-skip',
        'mode-rule-then-llm-yes',
        'mode-rule-then-llm-timeout',
        'session-scope-empty',
        'failure',
        'idle-timeout',
        'task-switch',
        'shutdown-drain',
    ].includes(scenario)) {
        const staleTimestamp = new Date(Date.now() - (60 * 60 * 1000)).toISOString();
        fs.mkdirSync(sessionMapDir, { recursive: true });
        fs.writeFileSync(sessionMapFile, JSON.stringify({
            version: 1,
            sessions: {
                'telegram::u-1::default': {
                    sessionId: 'sess-1',
                    channel: 'telegram',
                    senderId: 'u-1',
                    agentId: 'default',
                    updatedAt: scenario === 'idle-timeout' ? staleTimestamp : new Date().toISOString(),
                },
            },
        }, null, 2));
    }

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
            provider: ['mode-rule-then-llm-yes', 'mode-rule-then-llm-timeout'].includes(scenario) ? 'openai' : 'anthropic',
            model: ['mode-rule-then-llm-yes', 'mode-rule-then-llm-timeout'].includes(scenario) ? 'gpt-5.3-codex' : 'sonnet',
            working_directory: agentPath,
        },
        workspacePath,
        isInternal: false,
        shouldReset: false,
        userMessageForSession: 'hello',
    };

    let initialMessage = 'what do you remember about me?';
    if (scenario === 'task-switch') {
        initialMessage = '/newtask 现在开始一个新任务：请设计缓存策略';
    } else if (scenario === 'mode-never') {
        initialMessage = 'based on memory, summarize what I told you before';
    } else if (scenario === 'mode-rule-force') {
        initialMessage = '请根据记忆回答：我之前告诉过你什么偏好？';
    } else if (scenario === 'mode-rule-skip') {
        initialMessage = '帮我查今天 BTC 实时价格，然后执行命令 npm run build';
    } else if (scenario === 'mode-rule-then-llm-yes' || scenario === 'mode-rule-then-llm-timeout') {
        initialMessage = 'can you recall?';
    }
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
        await plugins.runAfterModelHooks(
            'assistant response from model',
            { ...baseContext, message: before.message },
            before.states
        );
        await plugins.runSessionEndHooks({ settings, reason: 'shutdown', signal: 'TEST' });

        const called = fs.readFileSync(commandLogFile, 'utf8');
        assert.match(called, /search/, 'enabled plugin should run native search prefetch');
        assert.match(called, /session-message sess-1 user/, 'enabled plugin should write native user message');
        assert.match(called, /session-message sess-1 assistant/, 'enabled plugin should write native assistant message');
        assert.match(called, /session-commit sess-1/, 'enabled plugin should commit native session on shutdown');
        return;
    }

    if (scenario === 'mode-never') {
        const called = fs.readFileSync(commandLogFile, 'utf8');
        assert.doesNotMatch(called, /^search /m, 'mode=never should skip prefetch search');
        const queueLog = fs.existsSync(queueLogFile) ? fs.readFileSync(queueLogFile, 'utf8') : '';
        assert.match(queueLog, /prefetch_decision=disabled reason=mode_never/, 'mode=never should emit disabled gate decision');
        return;
    }

    if (scenario === 'mode-rule-force') {
        const called = fs.readFileSync(commandLogFile, 'utf8');
        assert.match(called, /^search /m, 'mode=rule force pattern should trigger prefetch search');
        const queueLog = fs.existsSync(queueLogFile) ? fs.readFileSync(queueLogFile, 'utf8') : '';
        assert.match(queueLog, /prefetch_decision=force reason=force_pattern:/, 'mode=rule force pattern should log force decision');
        return;
    }

    if (scenario === 'mode-rule-skip') {
        const called = fs.readFileSync(commandLogFile, 'utf8');
        assert.doesNotMatch(called, /^search /m, 'mode=rule skip pattern should skip prefetch search');
        const queueLog = fs.existsSync(queueLogFile) ? fs.readFileSync(queueLogFile, 'utf8') : '';
        assert.match(queueLog, /prefetch_decision=rule_no reason=skip_pattern:/, 'mode=rule skip pattern should log rule_no decision');
        return;
    }

    if (scenario === 'mode-rule-then-llm-yes') {
        const called = fs.readFileSync(commandLogFile, 'utf8');
        assert.match(called, /^search /m, 'rule_then_llm yes should prefetch');
        const llmCalled = fs.existsSync(llmCommandLogFile) ? fs.readFileSync(llmCommandLogFile, 'utf8') : '';
        assert.match(llmCalled, /exec --model gpt-5.3-codex/, 'rule_then_llm should invoke codex gate');
        const queueLog = fs.existsSync(queueLogFile) ? fs.readFileSync(queueLogFile, 'utf8') : '';
        assert.match(queueLog, /prefetch_decision=llm_yes/, 'rule_then_llm yes should log llm_yes decision');
        assert.match(queueLog, /OpenViking prefetch llm gate .* elapsed_ms=/, 'rule_then_llm should log llm gate timing');
        return;
    }

    if (scenario === 'mode-rule-then-llm-timeout') {
        const called = fs.readFileSync(commandLogFile, 'utf8');
        assert.doesNotMatch(called, /^search /m, 'rule_then_llm timeout should fallback to no prefetch');
        const llmCalled = fs.existsSync(llmCommandLogFile) ? fs.readFileSync(llmCommandLogFile, 'utf8') : '';
        assert.match(llmCalled, /exec --model gpt-5.3-codex/, 'rule_then_llm timeout should still invoke codex gate');
        const queueLog = fs.existsSync(queueLogFile) ? fs.readFileSync(queueLogFile, 'utf8') : '';
        assert.match(queueLog, /prefetch_decision=llm_no/, 'rule_then_llm timeout should log llm_no decision');
        assert.match(queueLog, /prefetch llm gate failed/, 'rule_then_llm timeout should log llm gate failure');
        return;
    }

    if (scenario === 'session-scope-empty') {
        const called = fs.readFileSync(commandLogFile, 'utf8');
        assert.match(called, /search .*--session-id sess-1/, 'should try session-scoped search first');
        const searchLines = called.split('\n').filter((line) => line.startsWith('search '));
        assert.ok(searchLines.length >= 2, 'should retry native search without session scope');
        const hasUnscopedRetry = searchLines.some((line) => !line.includes('--session-id'));
        assert.ok(hasUnscopedRetry, 'should contain an unscoped search retry');
        return;
    }

    if (scenario === 'idle-timeout') {
        const called = fs.readFileSync(commandLogFile, 'utf8');
        assert.match(called, /session-commit sess-1/, 'idle timeout should commit stale mapped session');
        assert.match(called, /session-create --agent-id default --channel telegram --sender-id u-1/, 'idle timeout should create a new session after commit');
        assert.match(called, /session-message sess-2 user/, 'idle timeout should write user message to newly created session');
        return;
    }

    if (scenario === 'task-switch') {
        assert.strictEqual(
            before.message,
            '现在开始一个新任务：请设计缓存策略',
            'task switch marker should be removed from model prompt'
        );
        const called = fs.readFileSync(commandLogFile, 'utf8');
        assert.match(called, /session-commit sess-1/, 'task switch should commit previous mapped session');
        assert.match(called, /session-create --agent-id default --channel telegram --sender-id u-1/, 'task switch should create a fresh session');
        assert.match(called, /session-message sess-2 user 现在开始一个新任务：请设计缓存策略/, 'task switch should write stripped user text');
        return;
    }

    if (scenario === 'shutdown-drain') {
        await plugins.runSessionEndHooks({ settings, reason: 'shutdown', signal: 'TEST' });
        const called = fs.readFileSync(commandLogFile, 'utf8');
        assert.match(called, /session-commit sess-1/, 'shutdown should drain and commit mapped native session');
        const mapAfter = JSON.parse(fs.readFileSync(sessionMapFile, 'utf8'));
        assert.deepStrictEqual(mapAfter.sessions, {}, 'shutdown drain should clear session map entries');
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
