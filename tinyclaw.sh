#!/usr/bin/env bash
# TinyClaw - Main daemon using tmux + claude -c -p + messaging channels
#
# To add a new channel:
#   1. Create src/channels/<channel>-client.ts
#   2. Add the channel ID to ALL_CHANNELS in lib/common.sh
#   3. Fill in the CHANNEL_* registry arrays in lib/common.sh
#   4. Run setup wizard to enable it

# SCRIPT_DIR = repo root (where bash scripts live)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# TINYCLAW_HOME = data directory (settings, queue, logs, etc.)
# - Installed CLI sets this to ~/.tinyclaw via bin/tinyclaw
# - Local dev: detect from local .tinyclaw/ or fall back to ~/.tinyclaw
if [ -z "$TINYCLAW_HOME" ]; then
    if [ -f "$SCRIPT_DIR/.tinyclaw/settings.json" ]; then
        TINYCLAW_HOME="$SCRIPT_DIR/.tinyclaw"
    else
        TINYCLAW_HOME="$HOME/.tinyclaw"
    fi
fi

TMUX_SESSION="tinyclaw"
LOG_DIR="$TINYCLAW_HOME/logs"
SETTINGS_FILE="$TINYCLAW_HOME/settings.json"

mkdir -p "$LOG_DIR"

# Source library files
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/daemon.sh"
source "$SCRIPT_DIR/lib/messaging.sh"
source "$SCRIPT_DIR/lib/agents.sh"
source "$SCRIPT_DIR/lib/teams.sh"
source "$SCRIPT_DIR/lib/pairing.sh"
source "$SCRIPT_DIR/lib/update.sh"

# --- Main command dispatch ---

case "${1:-}" in
    start)
        start_daemon
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
        send_message "$2" "cli"
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
        agent_reset_multiple "$@"
        ;;
    channels)
        if [ "$2" = "reset" ] && [ -n "$3" ]; then
            channels_reset "$3"
        else
            local_names=$(IFS='|'; echo "${ALL_CHANNELS[*]}")
            echo "Usage: $0 channels reset {$local_names}"
            exit 1
        fi
        ;;
    provider)
        if [ -z "$2" ]; then
            if [ -f "$SETTINGS_FILE" ]; then
                CURRENT_PROVIDER=$(jq -r '.models.provider // "anthropic"' "$SETTINGS_FILE" 2>/dev/null)
                if [ "$CURRENT_PROVIDER" = "openai" ]; then
                    CURRENT_MODEL=$(jq -r '.models.openai.model // empty' "$SETTINGS_FILE" 2>/dev/null)
                else
                    CURRENT_MODEL=$(jq -r '.models.anthropic.model // empty' "$SETTINGS_FILE" 2>/dev/null)
                fi
                echo -e "${BLUE}Current provider: ${GREEN}$CURRENT_PROVIDER${NC}"
                if [ -n "$CURRENT_MODEL" ]; then
                    echo -e "${BLUE}Current model: ${GREEN}$CURRENT_MODEL${NC}"
                fi
            else
                echo -e "${RED}No settings file found${NC}"
                exit 1
            fi
        else
            # Parse optional --model flag
            PROVIDER_ARG="$2"
            MODEL_ARG=""
            if [ "$3" = "--model" ] && [ -n "$4" ]; then
                MODEL_ARG="$4"
            fi

            case "$PROVIDER_ARG" in
                anthropic)
                    if [ ! -f "$SETTINGS_FILE" ]; then
                        echo -e "${RED}No settings file found. Run setup first.${NC}"
                        exit 1
                    fi

                    # Switch to Anthropic provider
                    tmp_file="$SETTINGS_FILE.tmp"
                    if [ -n "$MODEL_ARG" ]; then
                        # Set both provider and model
                        jq ".models.provider = \"anthropic\" | .models.anthropic.model = \"$MODEL_ARG\"" "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
                        echo -e "${GREEN}✓ Switched to Anthropic provider with model: $MODEL_ARG${NC}"
                    else
                        # Set provider only
                        jq ".models.provider = \"anthropic\"" "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
                        echo -e "${GREEN}✓ Switched to Anthropic provider${NC}"
                        echo ""
                        echo "Use 'tinyclaw model {sonnet|opus}' to set the model."
                    fi
                    ;;
                openai)
                    if [ ! -f "$SETTINGS_FILE" ]; then
                        echo -e "${RED}No settings file found. Run setup first.${NC}"
                        exit 1
                    fi

                    # Switch to OpenAI provider (using Codex CLI)
                    tmp_file="$SETTINGS_FILE.tmp"
                    if [ -n "$MODEL_ARG" ]; then
                        # Set both provider and model (supports any model name)
                        jq ".models.provider = \"openai\" | .models.openai.model = \"$MODEL_ARG\"" "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
                        echo -e "${GREEN}✓ Switched to OpenAI/Codex provider with model: $MODEL_ARG${NC}"
                        echo ""
                        echo "Note: Make sure you have the 'codex' CLI installed and authenticated."
                    else
                        # Set provider only
                        jq ".models.provider = \"openai\"" "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
                        echo -e "${GREEN}✓ Switched to OpenAI/Codex provider${NC}"
                        echo ""
                        echo "Use 'tinyclaw model {gpt-5.3-codex|gpt-5.2}' to set the model."
                        echo "Note: Make sure you have the 'codex' CLI installed and authenticated."
                    fi
                    ;;
                *)
                    echo "Usage: $0 provider {anthropic|openai} [--model MODEL_NAME]"
                    echo ""
                    echo "Examples:"
                    echo "  $0 provider                                    # Show current provider and model"
                    echo "  $0 provider anthropic                          # Switch to Anthropic"
                    echo "  $0 provider openai                             # Switch to OpenAI"
                    echo "  $0 provider anthropic --model sonnet           # Switch to Anthropic with Sonnet"
                    echo "  $0 provider openai --model gpt-5.3-codex       # Switch to OpenAI with GPT-5.3 Codex"
                    echo "  $0 provider openai --model gpt-4o              # Switch to OpenAI with custom model"
                    exit 1
                    ;;
            esac
        fi
        ;;
    model)
        if [ -z "$2" ]; then
            if [ -f "$SETTINGS_FILE" ]; then
                CURRENT_PROVIDER=$(jq -r '.models.provider // "anthropic"' "$SETTINGS_FILE" 2>/dev/null)
                if [ "$CURRENT_PROVIDER" = "openai" ]; then
                    CURRENT_MODEL=$(jq -r '.models.openai.model // empty' "$SETTINGS_FILE" 2>/dev/null)
                else
                    CURRENT_MODEL=$(jq -r '.models.anthropic.model // empty' "$SETTINGS_FILE" 2>/dev/null)
                fi
                if [ -n "$CURRENT_MODEL" ]; then
                    echo -e "${BLUE}Current provider: ${GREEN}$CURRENT_PROVIDER${NC}"
                    echo -e "${BLUE}Current model: ${GREEN}$CURRENT_MODEL${NC}"
                else
                    echo -e "${RED}No model configured${NC}"
                    exit 1
                fi
            else
                echo -e "${RED}No settings file found${NC}"
                exit 1
            fi
        else
            case "$2" in
                sonnet|opus)
                    if [ ! -f "$SETTINGS_FILE" ]; then
                        echo -e "${RED}No settings file found. Run setup first.${NC}"
                        exit 1
                    fi

                    # Update model using jq
                    tmp_file="$SETTINGS_FILE.tmp"
                    jq ".models.anthropic.model = \"$2\"" "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"

                    echo -e "${GREEN}✓ Model switched to: $2${NC}"
                    echo ""
                    echo "Note: This affects the queue processor. Changes take effect on next message."
                    ;;
                gpt-5.2|gpt-5.3-codex)
                    if [ ! -f "$SETTINGS_FILE" ]; then
                        echo -e "${RED}No settings file found. Run setup first.${NC}"
                        exit 1
                    fi

                    # Update model using jq
                    tmp_file="$SETTINGS_FILE.tmp"
                    jq ".models.openai.model = \"$2\"" "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"

                    echo -e "${GREEN}✓ Model switched to: $2${NC}"
                    echo ""
                    echo "Note: This affects the queue processor. Changes take effect on next message."
                    ;;
                *)
                    echo "Usage: $0 model {sonnet|opus|gpt-5.2|gpt-5.3-codex}"
                    echo ""
                    echo "Anthropic models:"
                    echo "  sonnet            # Claude Sonnet (fast)"
                    echo "  opus              # Claude Opus (smartest)"
                    echo ""
                    echo "OpenAI models:"
                    echo "  gpt-5.3-codex     # GPT-5.3 Codex"
                    echo "  gpt-5.2           # GPT-5.2"
                    echo ""
                    echo "Examples:"
                    echo "  $0 model                # Show current model"
                    echo "  $0 model sonnet         # Switch to Claude Sonnet"
                    echo "  $0 model gpt-5.3-codex  # Switch to GPT-5.3 Codex"
                    exit 1
                    ;;
            esac
        fi
        ;;
    agent)
        case "${2:-}" in
            list|ls)
                agent_list
                ;;
            add)
                agent_add
                ;;
            remove|rm)
                if [ -z "$3" ]; then
                    echo "Usage: $0 agent remove <agent_id>"
                    exit 1
                fi
                agent_remove "$3"
                ;;
            show)
                if [ -z "$3" ]; then
                    echo "Usage: $0 agent show <agent_id>"
                    exit 1
                fi
                agent_show "$3"
                ;;
            reset)
                if [ -z "$3" ]; then
                    echo "Usage: $0 agent reset <agent_id> [agent_id2 ...]"
                    exit 1
                fi
                shift 2  # remove 'agent' and 'reset'
                agent_reset_multiple "$@"
                ;;
            provider)
                if [ -z "$3" ]; then
                    echo "Usage: $0 agent provider <agent_id> [provider] [--model MODEL_NAME]"
                    echo ""
                    echo "Examples:"
                    echo "  $0 agent provider coder                                    # Show current provider/model"
                    echo "  $0 agent provider coder anthropic                           # Switch to Anthropic"
                    echo "  $0 agent provider coder openai                              # Switch to OpenAI"
                    echo "  $0 agent provider coder anthropic --model opus              # Switch to Anthropic Opus"
                    echo "  $0 agent provider coder openai --model gpt-5.3-codex        # Switch to OpenAI GPT-5.3 Codex"
                    exit 1
                fi
                agent_provider "$3" "$4" "$5" "$6"
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
                echo "Examples:"
                echo "  $0 agent list"
                echo "  $0 agent add"
                echo "  $0 agent show coder"
                echo "  $0 agent remove coder"
                echo "  $0 agent reset coder"
                echo "  $0 agent reset coder researcher"
                echo "  $0 agent provider coder anthropic --model opus"
                echo ""
                echo "In chat, use '@agent_id message' to route to a specific agent."
                exit 1
                ;;
        esac
        ;;
    team)
        case "${2:-}" in
            list|ls)
                team_list
                ;;
            add)
                team_add
                ;;
            remove|rm)
                if [ -z "$3" ]; then
                    echo "Usage: $0 team remove <team_id>"
                    exit 1
                fi
                team_remove "$3"
                ;;
            show)
                if [ -z "$3" ]; then
                    echo "Usage: $0 team show <team_id>"
                    exit 1
                fi
                team_show "$3"
                ;;
            visualize|viz)
                # Build visualizer if needed
                if [ ! -f "$SCRIPT_DIR/dist/visualizer/team-visualizer.js" ] || \
                   [ "$SCRIPT_DIR/src/visualizer/team-visualizer.tsx" -nt "$SCRIPT_DIR/dist/visualizer/team-visualizer.js" ]; then
                    echo -e "${BLUE}Building team visualizer...${NC}"
                    cd "$SCRIPT_DIR" && npm run build:visualizer 2>/dev/null
                    if [ $? -ne 0 ]; then
                        echo -e "${RED}Failed to build visualizer.${NC}"
                        exit 1
                    fi
                fi
                if [ -n "$3" ]; then
                    node "$SCRIPT_DIR/dist/visualizer/team-visualizer.js" --team "$3"
                else
                    node "$SCRIPT_DIR/dist/visualizer/team-visualizer.js"
                fi
                ;;
            *)
                echo "Usage: $0 team {list|add|remove|show|visualize}"
                echo ""
                echo "Team Commands:"
                echo "  list                   List all configured teams"
                echo "  add                    Add a new team interactively"
                echo "  remove <id>            Remove a team"
                echo "  show <id>              Show team configuration"
                echo "  visualize [team_id]    Live TUI dashboard for team collaboration"
                echo ""
                echo "Examples:"
                echo "  $0 team list"
                echo "  $0 team add"
                echo "  $0 team show dev"
                echo "  $0 team remove dev"
                echo "  $0 team visualize"
                echo "  $0 team visualize dev"
                echo ""
                echo "In chat, use '@team_id message' to route to a team's leader agent."
                echo "Agents can collaborate by mentioning @teammate in responses."
                exit 1
                ;;
        esac
        ;;
    pairing)
        pairing_command "${2:-}" "${3:-}"
        ;;
    attach)
        tmux attach -t "$TMUX_SESSION"
        ;;
    setup)
        "$SCRIPT_DIR/lib/setup-wizard.sh"
        ;;
    update)
        do_update
        ;;
    *)
        local_names=$(IFS='|'; echo "${ALL_CHANNELS[*]}")
        echo -e "${BLUE}TinyClaw - Claude Code + Messaging Channels${NC}"
        echo ""
        echo "Usage: $0 {start|stop|restart|status|setup|send|logs|reset <agent_id>|channels|provider|model|agent|team|pairing|update|attach}"
        echo ""
        echo "Commands:"
        echo "  start                    Start TinyClaw"
        echo "  stop                     Stop all processes"
        echo "  restart                  Restart TinyClaw"
        echo "  status                   Show current status"
        echo "  setup                    Run setup wizard (change channels/provider/model/heartbeat)"
        echo "  send <msg>               Send message to AI manually"
        echo "  logs [type]              View logs ($local_names|heartbeat|daemon|queue|all)"
        echo "  reset <id> [id2 ...]     Reset specific agent conversation(s)"
        echo "  channels reset <channel> Reset channel auth ($local_names)"
        echo "  provider [name] [--model model]  Show or switch AI provider"
        echo "  model [name]             Show or switch AI model"
        echo "  agent {list|add|remove|show|reset|provider}  Manage agents"
        echo "  team {list|add|remove|show|visualize}  Manage teams"
        echo "  pairing {pending|approved|list|approve <code>|unpair <channel> <sender_id>}  Manage sender approvals"
        echo "  update                   Update TinyClaw to latest version"
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
