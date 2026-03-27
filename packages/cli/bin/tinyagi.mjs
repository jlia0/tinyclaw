#!/usr/bin/env node

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// ── Constants ────────────────────────────────────────────────────────────────

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const NC = '\x1b[0m';

const BANNER = `
  ▀█▀ █ █▄ █ █▄█ █▀█ █▀▀ █
   █  █ █ ▀█  █  █▀█ █▄█ █
`;

function log(color, msg) {
    process.stdout.write(`${color}${msg}${NC}\n`);
}

const REPO_ROOT = path.resolve(new URL('.', import.meta.url).pathname, '../../..');
const CLI_DIR = path.join(REPO_ROOT, 'packages/cli/dist');

// ── CLI Script Runner ────────────────────────────────────────────────────────

function runCliScript(script, args) {
    const scriptPath = path.join(CLI_DIR, script);
    const child = spawn('node', [scriptPath, ...args], { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code || 0));
}

// ── CLI Dispatch ─────────────────────────────────────────────────────────────

const command = process.argv[2] || 'run';
const restArgs = process.argv.slice(3);

console.log(BANNER);

switch (command) {
    // ── Install & Run ───────────────────────────────────────────────────────

    case 'run':
        runCliScript('install.js', ['run']);
        break;

    case 'install':
        runCliScript('install.js', ['install']);
        break;

    // ── Daemon ──────────────────────────────────────────────────────────────

    case 'start':
        runCliScript('daemon.js', ['start', '--open']);
        break;

    case 'stop':
        runCliScript('daemon.js', ['stop']);
        break;

    case 'restart':
        runCliScript('daemon.js', ['restart']);
        break;

    case 'status':
        runCliScript('daemon.js', ['status']);
        break;

    // ── Logs ────────────────────────────────────────────────────────────────

    case 'logs':
        runCliScript('logs.js', restArgs);
        break;

    // ── Messaging ───────────────────────────────────────────────────────────

    case 'send':
        if (!restArgs[0]) {
            console.log('Usage: tinyagi send <message>');
            process.exit(1);
        }
        runCliScript('messaging.js', ['send', restArgs[0]]);
        break;

    // ── Agent reset (top-level shortcut) ────────────────────────────────────

    case 'reset':
        if (!restArgs[0]) {
            console.log('Usage: tinyagi reset <agent_id> [agent_id2 ...]');
            process.exit(1);
        }
        runCliScript('agent.js', ['reset', ...restArgs]);
        break;

    // ── Channels ────────────────────────────────────────────────────────────

    case 'channels':
    case 'channel':
        if (!restArgs[0]) {
            console.log('Usage: tinyagi channel {setup|start|stop|restart|reset} <channel_id>');
            process.exit(1);
        }
        runCliScript('channel.js', restArgs);
        break;

    // ── Heartbeat ───────────────────────────────────────────────────────────

    case 'heartbeat':
        log(YELLOW, 'Heartbeat runs automatically as part of the main process.');
        log(YELLOW, 'Configure via monitoring.heartbeat_interval in settings.json.');
        break;

    // ── Agents ──────────────────────────────────────────────────────────────

    case 'agent':
        switch (restArgs[0]) {
            case 'add':
                runCliScript('agent.js', ['add']);
                break;
            case 'remove': case 'rm':
                if (!restArgs[1]) { console.log('Usage: tinyagi agent remove <agent_id>'); process.exit(1); }
                runCliScript('agent.js', ['remove', restArgs[1]]);
                break;
            case 'list': case 'ls':
                runCliScript('agent.js', ['list']);
                break;
            case 'show':
                if (!restArgs[1]) { console.log('Usage: tinyagi agent show <agent_id>'); process.exit(1); }
                runCliScript('agent.js', ['show', restArgs[1]]);
                break;
            case 'reset':
                if (!restArgs[1]) { console.log('Usage: tinyagi agent reset <agent_id> [...]'); process.exit(1); }
                runCliScript('agent.js', ['reset', ...restArgs.slice(1)]);
                break;
            case 'provider':
                if (!restArgs[1]) { console.log('Usage: tinyagi agent provider <agent_id> [provider] [--model MODEL]'); process.exit(1); }
                runCliScript('agent.js', ['provider', ...restArgs.slice(1)]);
                break;
            default:
                console.log('Usage: tinyagi agent {list|add|remove|show|reset|provider}');
                process.exit(1);
        }
        break;

    // ── Teams ───────────────────────────────────────────────────────────────

    case 'team':
        switch (restArgs[0]) {
            case 'add':
                runCliScript('team.js', ['add']);
                break;
            case 'remove': case 'rm':
                if (!restArgs[1]) { console.log('Usage: tinyagi team remove <team_id>'); process.exit(1); }
                runCliScript('team.js', ['remove', restArgs[1]]);
                break;
            case 'list': case 'ls':
                runCliScript('team.js', ['list']);
                break;
            case 'show':
                if (!restArgs[1]) { console.log('Usage: tinyagi team show <team_id>'); process.exit(1); }
                runCliScript('team.js', ['show', restArgs[1]]);
                break;
            case 'add-agent': case 'agent-add': case 'member-add':
                if (!restArgs[1] || !restArgs[2]) { console.log('Usage: tinyagi team add-agent <team_id> <agent_id>'); process.exit(1); }
                runCliScript('team.js', ['add-agent', restArgs[1], restArgs[2]]);
                break;
            case 'remove-agent': case 'agent-remove': case 'member-remove':
                if (!restArgs[1] || !restArgs[2]) { console.log('Usage: tinyagi team remove-agent <team_id> <agent_id>'); process.exit(1); }
                runCliScript('team.js', ['remove-agent', restArgs[1], restArgs[2]]);
                break;
            case 'visualize': case 'viz': {
                const vizScript = path.join(REPO_ROOT, 'packages/visualizer/dist/team-visualizer.js');
                const vizArgs = restArgs[1] ? ['--team', restArgs[1]] : [];
                const child = spawn('node', [vizScript, ...vizArgs], { stdio: 'inherit' });
                child.on('exit', (code) => process.exit(code || 0));
                break;
            }
            default:
                console.log('Usage: tinyagi team {list|add|remove|show|add-agent|remove-agent|visualize}');
                process.exit(1);
        }
        break;

    // ── Chatroom ────────────────────────────────────────────────────────────

    case 'chatroom': {
        if (!restArgs[0]) {
            log(RED, 'Usage: tinyagi chatroom <team_id>');
            process.exit(1);
        }
        const chatroomScript = path.join(REPO_ROOT, 'packages/visualizer/dist/chatroom-viewer.js');
        const child = spawn('node', [chatroomScript, '--team', restArgs[0]], { stdio: 'inherit' });
        child.on('exit', (code) => process.exit(code || 0));
        break;
    }

    // ── Providers ───────────────────────────────────────────────────────────

    case 'provider':
        switch (restArgs[0]) {
            case 'list': case 'ls':
                runCliScript('agent.js', ['provider-list']);
                break;
            case 'add':
                runCliScript('agent.js', ['provider-add']);
                break;
            case 'remove': case 'rm':
                if (!restArgs[1]) { console.log('Usage: tinyagi provider remove <provider_id>'); process.exit(1); }
                runCliScript('agent.js', ['provider-remove', restArgs[1]]);
                break;
            case 'anthropic': case 'openai':
                runCliScript('provider.js', restArgs);
                break;
            case undefined: case '':
                runCliScript('provider.js', ['show']);
                break;
            default:
                console.log('Usage: tinyagi provider {anthropic|openai|list|add|remove} [--model MODEL]');
                process.exit(1);
        }
        break;

    case 'model':
        runCliScript('provider.js', ['model', restArgs[0] || '']);
        break;

    // ── Office ──────────────────────────────────────────────────────────────

    case 'office': {
        const officeDir = path.join(REPO_ROOT, 'tinyoffice');
        if (!fs.existsSync(path.join(officeDir, 'node_modules'))) {
            log(BLUE, 'Installing TinyOffice dependencies...');
            execSync(`cd "${officeDir}" && npm install`, { stdio: 'inherit' });
        }
        if (!fs.existsSync(path.join(officeDir, '.next/BUILD_ID'))) {
            log(BLUE, 'Building TinyOffice...');
            execSync(`cd "${officeDir}" && npm run build`, { stdio: 'inherit' });
        }
        log(GREEN, 'Starting TinyOffice on http://localhost:3000');
        const child = spawn('npm', ['run', 'start'], { cwd: officeDir, stdio: 'inherit' });
        child.on('exit', (code) => process.exit(code || 0));
        break;
    }

    // ── Pairing ─────────────────────────────────────────────────────────────

    case 'pairing':
        runCliScript('pairing.js', restArgs);
        break;

    // ── Setup (legacy alias) ────────────────────────────────────────────────

    case 'setup':
        runCliScript('channel.js', ['setup']);
        break;

    // ── Update ──────────────────────────────────────────────────────────────

    case 'update':
        runCliScript('update.js', []);
        break;

    // ── Version ─────────────────────────────────────────────────────────────

    case 'version': case '--version': case '-v': case '-V':
        runCliScript('version.js', []);
        break;

    // ── Help ────────────────────────────────────────────────────────────────

    case '--help': case '-h': case 'help':
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
        console.log('  channel start <ch>       Start a channel');
        console.log('  channel stop <ch>        Stop a channel');
        console.log('  channel restart <ch>     Restart a channel');
        console.log('  channel reset <ch>       Reset channel auth');
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

    default:
        console.log(`Unknown command: ${command}`);
        console.log('Run "tinyagi --help" for usage information.');
        process.exit(1);
}
