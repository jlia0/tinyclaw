#!/usr/bin/env bash
# TinyClaw - Main daemon using tmux + claude -c -p + messaging channels
#
# To add a new channel:
#   1. Create src/channels/<channel>-client.ts
#   2. Add the channel ID to ALL_CHANNELS in lib/common.sh
#   3. Fill in the CHANNEL_* registry arrays in lib/common.sh
#   4. Run setup wizard to enable it

# Use TINYCLAW_HOME if set (for CLI wrapper), otherwise detect from script location
if [ -n "$TINYCLAW_HOME" ]; then
    SCRIPT_DIR="$TINYCLAW_HOME"
else
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
TMUX_SESSION="tinyclaw"
# Centralize all logs to ~/.tinyclaw/logs
LOG_DIR="$HOME/.tinyclaw/logs"
if [ -f "$SCRIPT_DIR/.tinyclaw/settings.json" ]; then
    SETTINGS_FILE="$SCRIPT_DIR/.tinyclaw/settings.json"
else
    SETTINGS_FILE="$HOME/.tinyclaw/settings.json"
fi

mkdir -p "$LOG_DIR"

# Source library files
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/daemon.sh"
source "$SCRIPT_DIR/lib/messaging.sh"
source "$SCRIPT_DIR/lib/agents.sh"
source "$SCRIPT_DIR/lib/teams.sh"
source "$SCRIPT_DIR/lib/pairing.sh"
source "$SCRIPT_DIR/lib/update.sh"

sandbox_show() {
    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found. Run setup first.${NC}"
        return 1
    fi

    if ! command -v jq >/dev/null 2>&1; then
        echo -e "${RED}jq is required for sandbox commands.${NC}"
        return 1
    fi

    echo -e "${BLUE}Sandbox Configuration${NC}"
    echo "====================="
    jq '.sandbox // {
      mode: "host",
      timeout_seconds: 600,
      max_attempts: 3,
      env_allowlist: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
      path_mapping_mode: "mapped",
      docker: {
        image: "tinyclaw/agent-runner:latest",
        network: "default",
        memory: "2g",
        cpus: "1.0",
        pids_limit: 256
      },
      apple: {
        runtime_command: "apple-container",
        image: "tinyclaw/agent-runner:latest",
        network: "default",
        memory: "2g",
        cpus: "1.0"
      }
    }' "$SETTINGS_FILE"
}

sandbox_set() {
    local mode="$1"
    if [ -z "$mode" ]; then
        echo "Usage: $0 sandbox set {host|docker|apple}"
        return 1
    fi

    case "$mode" in
        host|docker|apple) ;;
        *)
            echo "Usage: $0 sandbox set {host|docker|apple}"
            return 1
            ;;
    esac

    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found. Run setup first.${NC}"
        return 1
    fi
    if ! command -v jq >/dev/null 2>&1; then
        echo -e "${RED}jq is required for sandbox commands.${NC}"
        return 1
    fi

    local tmp_file="$SETTINGS_FILE.tmp"
    jq ".sandbox.mode = \"$mode\"" "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
    echo -e "${GREEN}✓ Sandbox mode set to: $mode${NC}"

    if [ "$mode" != "host" ]; then
        echo ""
        echo "Run doctor before restarting TinyClaw:"
        echo -e "  ${GREEN}$0 sandbox doctor${NC}"
    fi
}

sandbox_doctor() {
    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found. Run setup first.${NC}"
        return 1
    fi
    if ! command -v jq >/dev/null 2>&1; then
        echo -e "${RED}jq is required for sandbox commands.${NC}"
        return 1
    fi

    local mode
    mode=$(jq -r '.sandbox.mode // "host"' "$SETTINGS_FILE" 2>/dev/null)
    local workspace
    workspace=$(jq -r '.workspace.path // empty' "$SETTINGS_FILE" 2>/dev/null)
    [ -z "$workspace" ] && workspace="$HOME/tinyclaw-workspace"

    local runtime_cmd=""
    local image=""
    case "$mode" in
        host)
            runtime_cmd="host"
            ;;
        docker)
            runtime_cmd="docker"
            image=$(jq -r '.sandbox.docker.image // "tinyclaw/agent-runner:latest"' "$SETTINGS_FILE" 2>/dev/null)
            ;;
        apple)
            runtime_cmd=$(jq -r '.sandbox.apple.runtime_command // "apple-container"' "$SETTINGS_FILE" 2>/dev/null)
            image=$(jq -r '.sandbox.apple.image // "tinyclaw/agent-runner:latest"' "$SETTINGS_FILE" 2>/dev/null)
            ;;
        *)
            echo -e "${RED}Invalid sandbox mode in settings: $mode${NC}"
            return 1
            ;;
    esac

    echo -e "${BLUE}Sandbox Doctor${NC}"
    echo "=============="
    echo "Mode: $mode"
    echo ""

    local failures=0

    # Workspace check
    if [ -d "$workspace" ]; then
        echo -e "${GREEN}✓${NC} Workspace exists: $workspace"
    else
        echo -e "${RED}✗${NC} Workspace missing: $workspace"
        failures=$((failures + 1))
    fi

    if [ "$mode" = "host" ]; then
        if command -v claude >/dev/null 2>&1 || command -v codex >/dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} Host provider CLI detected"
        else
            echo -e "${RED}✗${NC} Neither claude nor codex CLI is installed"
            failures=$((failures + 1))
        fi
    else
        if command -v "$runtime_cmd" >/dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} Runtime available: $runtime_cmd"
        else
            echo -e "${RED}✗${NC} Runtime not found: $runtime_cmd"
            failures=$((failures + 1))
        fi

        if [ -n "$image" ] && command -v "$runtime_cmd" >/dev/null 2>&1; then
            if "$runtime_cmd" image inspect "$image" >/dev/null 2>&1; then
                echo -e "${GREEN}✓${NC} Image available: $image"
                if "$runtime_cmd" run --rm "$image" sh -lc "command -v claude >/dev/null 2>&1 || command -v codex >/dev/null 2>&1" >/dev/null 2>&1; then
                    echo -e "${GREEN}✓${NC} Provider CLI detected inside image"
                else
                    echo -e "${YELLOW}⚠${NC} Could not detect claude/codex inside image"
                    echo "  Your sandbox image should include provider CLIs."
                fi
            else
                echo -e "${YELLOW}⚠${NC} Image not found locally: $image"
                echo "  Pull/build before running in sandbox mode."
            fi
        fi
    fi

    # Required provider env vars (based on configured providers).
    local requires_anthropic=0
    local requires_openai=0
    if jq -e '.models.provider == "anthropic"' "$SETTINGS_FILE" >/dev/null 2>&1; then
        requires_anthropic=1
    fi
    if jq -e '.models.provider == "openai"' "$SETTINGS_FILE" >/dev/null 2>&1; then
        requires_openai=1
    fi
    if jq -e '(.agents // {}) | to_entries[]? | select(.value.provider == "anthropic")' "$SETTINGS_FILE" >/dev/null 2>&1; then
        requires_anthropic=1
    fi
    if jq -e '(.agents // {}) | to_entries[]? | select(.value.provider == "openai")' "$SETTINGS_FILE" >/dev/null 2>&1; then
        requires_openai=1
    fi

    local allowlist
    allowlist=$(jq -c '.sandbox.env_allowlist // ["ANTHROPIC_API_KEY","OPENAI_API_KEY"]' "$SETTINGS_FILE" 2>/dev/null)
    if [ "$requires_anthropic" -eq 1 ]; then
        if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
            echo -e "${GREEN}✓${NC} ANTHROPIC_API_KEY is set"
        else
            echo -e "${RED}✗${NC} ANTHROPIC_API_KEY is missing"
            failures=$((failures + 1))
        fi
        if echo "$allowlist" | jq -e 'index("ANTHROPIC_API_KEY")' >/dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} ANTHROPIC_API_KEY is allowlisted"
        else
            echo -e "${RED}✗${NC} ANTHROPIC_API_KEY missing from sandbox.env_allowlist"
            failures=$((failures + 1))
        fi
    fi

    if [ "$requires_openai" -eq 1 ]; then
        if [ -n "${OPENAI_API_KEY:-}" ]; then
            echo -e "${GREEN}✓${NC} OPENAI_API_KEY is set"
        else
            echo -e "${RED}✗${NC} OPENAI_API_KEY is missing"
            failures=$((failures + 1))
        fi
        if echo "$allowlist" | jq -e 'index("OPENAI_API_KEY")' >/dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} OPENAI_API_KEY is allowlisted"
        else
            echo -e "${RED}✗${NC} OPENAI_API_KEY missing from sandbox.env_allowlist"
            failures=$((failures + 1))
        fi
    fi

    if [ "$failures" -eq 0 ]; then
        echo ""
        echo -e "${GREEN}Sandbox doctor passed.${NC}"
        return 0
    fi

    echo ""
    echo -e "${RED}Sandbox doctor found $failures issue(s).${NC}"
    return 1
}

sandbox_build_image() {
    if ! command -v docker >/dev/null 2>&1; then
        echo -e "${RED}docker is required for sandbox build-image.${NC}"
        return 1
    fi
    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found. Run setup first.${NC}"
        return 1
    fi
    if ! command -v jq >/dev/null 2>&1; then
        echo -e "${RED}jq is required for sandbox commands.${NC}"
        return 1
    fi

    local image
    image=$(jq -r '.sandbox.docker.image // "tinyclaw/agent-runner:latest"' "$SETTINGS_FILE" 2>/dev/null)
    local dockerfile="$SCRIPT_DIR/Dockerfile.agent-runner"
    if [ ! -f "$dockerfile" ]; then
        echo -e "${RED}Missing Dockerfile.agent-runner at $dockerfile${NC}"
        return 1
    fi

    echo "Building sandbox image: $image"
    docker build -f "$dockerfile" -t "$image" "$SCRIPT_DIR"
}

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
        echo -e "${YELLOW}Resetting conversation...${NC}"
        touch "$SCRIPT_DIR/.tinyclaw/reset_flag"
        echo -e "${GREEN}✓ Reset flag set${NC}"
        echo ""
        echo "The next message will start a fresh conversation (without -c)."
        echo "After that, conversation will continue normally."
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
    sandbox)
        case "${2:-}" in
            show)
                sandbox_show
                ;;
            set)
                sandbox_set "$3"
                ;;
            doctor)
                sandbox_doctor
                ;;
            build-image)
                sandbox_build_image
                ;;
            *)
                echo "Usage: $0 sandbox {show|set|doctor|build-image}"
                echo ""
                echo "Sandbox Commands:"
                echo "  show                    Show sandbox configuration"
                echo "  set <mode>              Set sandbox mode (host|docker|apple)"
                echo "  doctor                  Validate runtime/image/env settings"
                echo "  build-image             Build Docker sandbox image"
                echo ""
                echo "Examples:"
                echo "  $0 sandbox show"
                echo "  $0 sandbox set docker"
                echo "  $0 sandbox doctor"
                echo "  $0 sandbox build-image"
                exit 1
                ;;
        esac
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
                    echo "Usage: $0 agent reset <agent_id>"
                    exit 1
                fi
                agent_reset "$3"
                ;;
            *)
                echo "Usage: $0 agent {list|add|remove|show|reset}"
                echo ""
                echo "Agent Commands:"
                echo "  list                   List all configured agents"
                echo "  add                    Add a new agent interactively"
                echo "  remove <id>            Remove an agent"
                echo "  show <id>              Show agent configuration"
                echo "  reset <id>             Reset an agent's conversation"
                echo ""
                echo "Examples:"
                echo "  $0 agent list"
                echo "  $0 agent add"
                echo "  $0 agent show coder"
                echo "  $0 agent remove coder"
                echo "  $0 agent reset coder"
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
        echo "Usage: $0 {start|stop|restart|status|setup|send|logs|reset|channels|provider|model|agent|team|pairing|update|attach}"
        echo ""
        echo "Commands:"
        echo "  start                    Start TinyClaw"
        echo "  stop                     Stop all processes"
        echo "  restart                  Restart TinyClaw"
        echo "  status                   Show current status"
        echo "  setup                    Run setup wizard (change channels/provider/model/heartbeat)"
        echo "  send <msg>               Send message to AI manually"
        echo "  logs [type]              View logs ($local_names|heartbeat|daemon|queue|all)"
        echo "  reset                    Reset conversation (next message starts fresh)"
        echo "  channels reset <channel> Reset channel auth ($local_names)"
        echo "  provider [name] [--model model]  Show or switch AI provider"
        echo "  model [name]             Show or switch AI model"
        echo "  sandbox {show|set|doctor|build-image}  Manage sandbox runtime"
        echo "  agent {list|add|remove|show|reset}  Manage agents"
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
        echo "  $0 sandbox show"
        echo "  $0 sandbox set docker"
        echo "  $0 sandbox doctor"
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
