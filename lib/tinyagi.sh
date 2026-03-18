#!/usr/bin/env bash
# shellcheck disable=SC1091
# TinyAGI - Main daemon using tmux + claude -c -p + messaging channels
#
# To add a new channel:
#   1. Create src/channels/<channel>-client.ts
#   2. Add the channel ID to ALL_CHANNELS in lib/common.sh
#   3. Fill in the CHANNEL_* registry arrays in lib/common.sh
#   4. Run setup wizard to enable it

# SCRIPT_DIR = repo root (where bash scripts live)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# TINYAGI_HOME = data directory (settings, queue, logs, etc.)
# Always defaults to ~/.tinyagi; override via TINYAGI_HOME env var.
TINYAGI_HOME="${TINYAGI_HOME:-$HOME/.tinyagi}"

TMUX_SESSION="tinyagi"
LOG_DIR="$TINYAGI_HOME/logs"
SETTINGS_FILE="$TINYAGI_HOME/settings.json"

mkdir -p "$LOG_DIR"

# Source library files (daemon runtime only — user commands are in packages/cli/)
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/daemon.sh"
source "$SCRIPT_DIR/lib/update.sh"

CLI="$SCRIPT_DIR/packages/cli/dist"

# --- Main command dispatch ---

case "${1:-}" in
    start)
        shift  # remove 'start'
        start_daemon "$@"
        ;;
    stop)
        stop_daemon
        ;;
    restart)
        restart_daemon
        ;;
    __delayed_start)
        sleep 2
        start_daemon
        ;;
    status)
        status_daemon
        ;;
    send)
        if [ -z "$2" ]; then
            echo "Usage: $0 send <message>"
            exit 1
        fi
        node "$CLI/messaging.js" send "$2"
        ;;
    logs)
        logs "$2"
        ;;
    reset)
        if [ -z "$2" ]; then
            echo "Usage: $0 reset <agent_id> [agent_id2 ...]"
            echo ""
            echo "Reset specific agent conversation(s)."
            echo ""
            echo "Examples:"
            echo "  $0 reset coder"
            echo "  $0 reset coder researcher"
            echo "  $0 reset coder researcher reviewer"
            exit 1
        fi
        shift  # remove 'reset'
        node "$CLI/agent.js" reset "$@"
        ;;
    channels|channel)
        case "${2:-}" in
            start)
                if [ -z "$3" ]; then
                    echo "Usage: $0 channel start <channel_id>"
                    exit 1
                fi
                start_channel "$3"
                ;;
            stop)
                if [ -z "$3" ]; then
                    echo "Usage: $0 channel stop <channel_id>"
                    exit 1
                fi
                stop_channel "$3"
                ;;
            reset)
                if [ -z "$3" ]; then
                    echo "Usage: $0 channel reset <channel_id>"
                    exit 1
                fi
                node "$CLI/messaging.js" channels-reset "$3"
                ;;
            *)
                local_names=$(IFS='|'; echo "${ALL_CHANNELS[*]}")
                echo "Usage: $0 channel {start|stop|reset} {$local_names}"
                exit 1
                ;;
        esac
        ;;
    heartbeat)
        case "${2:-}" in
            start)  start_heartbeat ;;
            stop)   stop_heartbeat ;;
            *)
                echo "Usage: $0 heartbeat {start|stop}"
                exit 1
                ;;
        esac
        ;;
    provider)
        case "${2:-}" in
            list|ls)
                node "$CLI/agent.js" provider-list
                ;;
            add)
                node "$CLI/agent.js" provider-add
                ;;
            remove|rm)
                if [ -z "$3" ]; then
                    echo "Usage: $0 provider remove <provider_id>"
                    exit 1
                fi
                node "$CLI/agent.js" provider-remove "$3"
                ;;
            anthropic|openai)
                shift  # remove 'provider'
                node "$CLI/provider.js" "$@"
                ;;
            "")
                node "$CLI/provider.js" show
                ;;
            *)
                echo "Usage: $0 provider {anthropic|openai|list|add|remove} [--model MODEL] [--auth-token TOKEN]"
                exit 1
                ;;
        esac
        ;;
    model)
        node "$CLI/provider.js" model "${2:-}"
        ;;
    agent)
        case "${2:-}" in
            add)
                node "$CLI/agent.js" add
                ;;
            remove|rm)
                if [ -z "$3" ]; then
                    echo "Usage: $0 agent remove <agent_id>"
                    exit 1
                fi
                node "$CLI/agent.js" remove "$3"
                ;;
            list|ls)
                node "$CLI/agent.js" list
                ;;
            show)
                if [ -z "$3" ]; then
                    echo "Usage: $0 agent show <agent_id>"
                    exit 1
                fi
                node "$CLI/agent.js" show "$3"
                ;;
            reset)
                if [ -z "$3" ]; then
                    echo "Usage: $0 agent reset <agent_id> [agent_id2 ...]"
                    exit 1
                fi
                shift 2  # remove 'agent' and 'reset'
                node "$CLI/agent.js" reset "$@"
                ;;
            provider)
                if [ -z "$3" ]; then
                    echo "Usage: $0 agent provider <agent_id> [provider] [--model MODEL_NAME]"
                    exit 1
                fi
                node "$CLI/agent.js" provider "$3" "$4" "$5" "$6"
                ;;
            *)
                echo "Usage: $0 agent {list|add|remove|show|reset|provider}"
                echo ""
                echo "Agent Commands:"
                echo "  list                   List all configured agents"
                echo "  add                    Add a new agent interactively"
                echo "  remove <id>            Remove an agent"
                echo "  show <id>              Show agent configuration"
                echo "  reset <id> [id2 ...]   Reset agent conversation(s)"
                echo "  provider <id> [...]    Show or set agent's provider and model"
                echo ""
                echo "In chat, use '@agent_id message' to route to a specific agent."
                exit 1
                ;;
        esac
        ;;
    team)
        case "${2:-}" in
            add)
                node "$CLI/team.js" add
                ;;
            remove|rm)
                if [ -z "$3" ]; then
                    echo "Usage: $0 team remove <team_id>"
                    exit 1
                fi
                node "$CLI/team.js" remove "$3"
                ;;
            list|ls)
                node "$CLI/team.js" list
                ;;
            show)
                if [ -z "$3" ]; then
                    echo "Usage: $0 team show <team_id>"
                    exit 1
                fi
                node "$CLI/team.js" show "$3"
                ;;
            add-agent|agent-add|member-add)
                if [ -z "$3" ] || [ -z "$4" ]; then
                    echo "Usage: $0 team add-agent <team_id> <agent_id>"
                    exit 1
                fi
                node "$CLI/team.js" add-agent "$3" "$4"
                ;;
            remove-agent|agent-remove|member-remove)
                if [ -z "$3" ] || [ -z "$4" ]; then
                    echo "Usage: $0 team remove-agent <team_id> <agent_id>"
                    exit 1
                fi
                node "$CLI/team.js" remove-agent "$3" "$4"
                ;;
            visualize|viz)
                # Build visualizer if needed
                if [ ! -f "$SCRIPT_DIR/packages/visualizer/dist/team-visualizer.js" ] || \
                   [ "$SCRIPT_DIR/packages/visualizer/src/team-visualizer.tsx" -nt "$SCRIPT_DIR/packages/visualizer/dist/team-visualizer.js" ]; then
                    echo -e "${BLUE}Building team visualizer...${NC}"
                    if ! (cd "$SCRIPT_DIR" && npm run build -w @tinyagi/visualizer 2>/dev/null); then
                        echo -e "${RED}Failed to build visualizer.${NC}"
                        exit 1
                    fi
                fi
                if [ -n "$3" ]; then
                    node "$SCRIPT_DIR/packages/visualizer/dist/team-visualizer.js" --team "$3"
                else
                    node "$SCRIPT_DIR/packages/visualizer/dist/team-visualizer.js"
                fi
                ;;
            *)
                echo "Usage: $0 team {list|add|remove|show|add-agent|remove-agent|visualize}"
                echo ""
                echo "Team Commands:"
                echo "  list                   List all configured teams"
                echo "  add                    Add a new team interactively"
                echo "  remove <id>            Remove a team"
                echo "  show <id>              Show team configuration"
                echo "  add-agent <tid> <aid>  Add an existing agent to a team"
                echo "  remove-agent <tid> <aid> Remove an agent from a team"
                echo "  visualize [team_id]    Live TUI dashboard for team collaboration"
                echo ""
                echo "In chat, use '@team_id message' to route to a team's leader agent."
                exit 1
                ;;
        esac
        ;;
    chatroom)
        CHATROOM_TEAM="${2:-}"
        if [ -z "$CHATROOM_TEAM" ]; then
            echo -e "${RED}Usage: $0 chatroom <team_id>${NC}"
            exit 1
        fi
        # Build if needed
        if [ ! -f "$SCRIPT_DIR/packages/visualizer/dist/chatroom-viewer.js" ] || \
           [ "$SCRIPT_DIR/packages/visualizer/src/chatroom-viewer.tsx" -nt "$SCRIPT_DIR/packages/visualizer/dist/chatroom-viewer.js" ]; then
            echo -e "${BLUE}Building chatroom viewer...${NC}"
            if ! (cd "$SCRIPT_DIR" && npm run build -w @tinyagi/visualizer 2>/dev/null); then
                echo -e "${RED}Failed to build chatroom viewer.${NC}"
                exit 1
            fi
        fi
        node "$SCRIPT_DIR/packages/visualizer/dist/chatroom-viewer.js" --team "$CHATROOM_TEAM"
        ;;
    office)
        OFFICE_DIR="$SCRIPT_DIR/tinyoffice"
        # Install deps if node_modules missing or package.json changed since last install
        if [ ! -d "$OFFICE_DIR/node_modules" ] || \
           [ "$OFFICE_DIR/package.json" -nt "$OFFICE_DIR/node_modules/.package-lock.json" ]; then
            echo -e "${BLUE}Installing TinyOffice dependencies...${NC}"
            (cd "$OFFICE_DIR" && npm install) || { echo -e "${RED}Install failed${NC}"; exit 1; }
        fi
        # Build if .next missing or source/deps changed since last build
        if [ ! -f "$OFFICE_DIR/.next/BUILD_ID" ] || \
           [ "$OFFICE_DIR/package.json" -nt "$OFFICE_DIR/.next/BUILD_ID" ] || \
           [ -n "$(find "$OFFICE_DIR/src" -newer "$OFFICE_DIR/.next/BUILD_ID" -print -quit 2>/dev/null)" ]; then
            echo -e "${BLUE}Building TinyOffice...${NC}"
            (cd "$OFFICE_DIR" && npm run build) || { echo -e "${RED}Build failed${NC}"; exit 1; }
        fi
        echo -e "${GREEN}Starting TinyOffice on http://localhost:3000${NC}"
        (cd "$OFFICE_DIR" && npm run start)
        ;;
    pairing)
        node "$CLI/pairing.js" "${2:-}" "${3:-}" "${4:-}"
        ;;
    attach)
        tmux attach -t "$TMUX_SESSION"
        ;;
    setup)
        node "$CLI/setup-wizard.js"
        ;;
    update)
        node "$CLI/update.js"
        ;;
    version|--version|-v|-V)
        echo "tinyagi v$(get_current_version)"
        ;;
    *)
        local_names=$(IFS='|'; echo "${ALL_CHANNELS[*]}")
        show_banner
        echo "Usage: $0 {start|stop|restart|status|setup|send|logs|reset <agent_id>|channel|heartbeat|provider|model|agent|team|chatroom|office|pairing|update|version|attach}"
        echo ""
        echo "Commands:"
        echo "  start [--skip-setup]      Start TinyAGI (--skip-setup: API only, complete setup in browser)"
        echo "  stop                     Stop all processes"
        echo "  restart                  Restart TinyAGI"
        echo "  status                   Show current status"
        echo "  setup                    Run setup wizard (change channels/provider/model/heartbeat)"
        echo "  send <msg>               Send message to AI manually"
        echo "  logs [type]              View logs ($local_names|heartbeat|daemon|queue|all)"
        echo "  reset <id> [id2 ...]     Reset specific agent conversation(s)"
        echo "  channel start <ch>       Start a channel in the running session"
        echo "  channel stop <ch>        Stop a channel"
        echo "  channel reset <ch>       Reset channel auth ($local_names)"
        echo "  heartbeat start|stop     Start or stop the heartbeat process"
        echo "  provider [name] [--model model]  Show or switch AI provider"
        echo "  provider {list|add|remove}       Manage custom providers"
        echo "  model [name]             Show or switch AI model"
        echo "  agent {list|add|remove|show|reset|provider}  Manage agents"
        echo "  team {list|add|remove|show|add-agent|remove-agent|visualize}  Manage teams"
        echo "  chatroom <team_id>       Live chat room viewer for a team"
        echo "  office                   Start TinyOffice web portal (http://localhost:3000)"
        echo "  pairing {pending|approved|list|approve <code>|unpair <channel> <sender_id>}  Manage sender approvals"
        echo "  update                   Update TinyAGI to latest version"
        echo "  version                  Show current version"
        echo "  attach                   Attach to tmux session"
        echo ""
        echo "Examples:"
        echo "  $0 start"
        echo "  $0 status"
        echo "  $0 provider openai --model gpt-5.3-codex"
        echo "  $0 model opus"
        echo "  $0 reset coder"
        echo "  $0 reset coder researcher"
        echo "  $0 agent list"
        echo "  $0 agent add"
        echo "  $0 team list"
        echo "  $0 team visualize dev"
        echo "  $0 chatroom dev"
        echo "  $0 pairing pending"
        echo "  $0 pairing approve ABCD1234"
        echo "  $0 pairing unpair telegram 123456789"
        echo "  $0 send '@coder fix the bug'"
        echo "  $0 send '@dev fix the auth bug'"
        echo "  $0 channels reset whatsapp"
        echo "  $0 logs telegram"
        echo ""
        exit 1
        ;;
esac
