#!/usr/bin/env bash
# TinyClaw - Main daemon using tmux + claude -c -p + messaging channels
#
# To add a new channel:
#   1. Create src/<channel>-client.ts
#   2. Add the channel ID to ALL_CHANNELS below
#   3. Fill in the CHANNEL_* registry arrays
#   4. Run setup wizard to enable it

# Check bash version (need 4.0+ for associative arrays)
if [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
    echo "Error: This script requires bash 4.0 or higher (you have ${BASH_VERSION})"
    echo ""
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macOS ships with bash 3.2. Install a newer version:"
        echo "  brew install bash"
        echo ""
        echo "Then either:"
        echo "  1. Run with: /opt/homebrew/bin/bash $0"
        echo "  2. Add to your PATH: export PATH=\"/opt/homebrew/bin:\$PATH\""
    else
        echo "Install bash 4.0+ using your package manager:"
        echo "  Ubuntu/Debian: sudo apt-get install bash"
        echo "  CentOS/RHEL: sudo yum install bash"
    fi
    exit 1
fi

# Use TINYCLAW_HOME if set (for CLI wrapper), otherwise detect from script location
if [ -n "$TINYCLAW_HOME" ]; then
    SCRIPT_DIR="$TINYCLAW_HOME"
else
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
TMUX_SESSION="tinyclaw"
LOG_DIR="$SCRIPT_DIR/.tinyclaw/logs"
SETTINGS_FILE="$SCRIPT_DIR/.tinyclaw/settings.json"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

mkdir -p "$LOG_DIR"

# --- Channel registry ---
# Single source of truth. Add new channels here and everything else adapts.

ALL_CHANNELS=(discord whatsapp telegram)

declare -A CHANNEL_DISPLAY=(
    [discord]="Discord"
    [whatsapp]="WhatsApp"
    [telegram]="Telegram"
)
declare -A CHANNEL_SCRIPT=(
    [discord]="dist/discord-client.js"
    [whatsapp]="dist/whatsapp-client.js"
    [telegram]="dist/telegram-client.js"
)
declare -A CHANNEL_ALIAS=(
    [discord]="dc"
    [whatsapp]="wa"
    [telegram]="tg"
)
declare -A CHANNEL_TOKEN_KEY=(
    [discord]="discord_bot_token"
    [telegram]="telegram_bot_token"
)
declare -A CHANNEL_TOKEN_ENV=(
    [discord]="DISCORD_BOT_TOKEN"
    [telegram]="TELEGRAM_BOT_TOKEN"
)

# Runtime state: filled by load_settings
ACTIVE_CHANNELS=()
declare -A CHANNEL_TOKENS=()

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_DIR/daemon.log"
}

# Load settings from JSON
load_settings() {
    if [ ! -f "$SETTINGS_FILE" ]; then
        return 1
    fi

    # Check if jq is available for JSON parsing
    if ! command -v jq &> /dev/null; then
        echo -e "${RED}Error: jq is required for parsing settings${NC}"
        echo "Install with: brew install jq (macOS) or apt-get install jq (Linux)"
        return 1
    fi

    # Read enabled channels array
    local channels_json
    channels_json=$(jq -r '.channels.enabled[]' "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$channels_json" ]; then
        return 1
    fi

    # Parse into array
    ACTIVE_CHANNELS=()
    while IFS= read -r ch; do
        ACTIVE_CHANNELS+=("$ch")
    done <<< "$channels_json"

    # Load tokens for each channel from nested structure
    for ch in "${ALL_CHANNELS[@]}"; do
        local token_key="${CHANNEL_TOKEN_KEY[$ch]:-}"
        if [ -n "$token_key" ]; then
            CHANNEL_TOKENS[$ch]=$(jq -r ".channels.${ch}.bot_token // empty" "$SETTINGS_FILE" 2>/dev/null)
        fi
    done

    return 0
}

# Check if a channel is active
is_active() {
    local target="$1"
    for ch in "${ACTIVE_CHANNELS[@]}"; do
        [ "$ch" = "$target" ] && return 0
    done
    return 1
}

# Check if session exists
session_exists() {
    tmux has-session -t "$TMUX_SESSION" 2>/dev/null
}

# Start daemon
start_daemon() {
    if session_exists; then
        echo -e "${YELLOW}Session already running${NC}"
        return 1
    fi

    log "Starting TinyClaw daemon..."

    # Check if Node.js dependencies are installed
    if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
        echo -e "${YELLOW}Installing Node.js dependencies...${NC}"
        cd "$SCRIPT_DIR"
        PUPPETEER_SKIP_DOWNLOAD=true npm install
    fi

    # Build TypeScript if any src file is newer than its dist counterpart
    local needs_build=false
    if [ ! -d "$SCRIPT_DIR/dist" ]; then
        needs_build=true
    else
        for ts_file in "$SCRIPT_DIR"/src/*.ts; do
            local js_file="$SCRIPT_DIR/dist/$(basename "${ts_file%.ts}.js")"
            if [ ! -f "$js_file" ] || [ "$ts_file" -nt "$js_file" ]; then
                needs_build=true
                break
            fi
        done
    fi
    if [ "$needs_build" = true ]; then
        echo -e "${YELLOW}Building TypeScript...${NC}"
        cd "$SCRIPT_DIR"
        npm run build
    fi

    # Load settings or run setup wizard
    if ! load_settings; then
        echo -e "${YELLOW}No configuration found. Running setup wizard...${NC}"
        echo ""
        "$SCRIPT_DIR/lib/setup-wizard.sh"

        if ! load_settings; then
            echo -e "${RED}Setup failed or was cancelled${NC}"
            return 1
        fi
    fi

    if [ ${#ACTIVE_CHANNELS[@]} -eq 0 ]; then
        echo -e "${RED}No channels configured. Run './tinyclaw.sh setup' to reconfigure${NC}"
        return 1
    fi

    # Validate tokens for channels that need them
    for ch in "${ACTIVE_CHANNELS[@]}"; do
        local token_key="${CHANNEL_TOKEN_KEY[$ch]:-}"
        if [ -n "$token_key" ] && [ -z "${CHANNEL_TOKENS[$ch]:-}" ]; then
            echo -e "${RED}${CHANNEL_DISPLAY[$ch]} is configured but bot token is missing${NC}"
            echo "Run './tinyclaw.sh setup' to reconfigure"
            return 1
        fi
    done

    # Write tokens to .env for the Node.js clients
    local env_file="$SCRIPT_DIR/.env"
    : > "$env_file"
    for ch in "${ACTIVE_CHANNELS[@]}"; do
        local env_var="${CHANNEL_TOKEN_ENV[$ch]:-}"
        if [ -n "$env_var" ] && [ -n "${CHANNEL_TOKENS[$ch]:-}" ]; then
            echo "${env_var}=${CHANNEL_TOKENS[$ch]}" >> "$env_file"
        fi
    done

    # Report channels
    echo -e "${BLUE}Channels:${NC}"
    for ch in "${ACTIVE_CHANNELS[@]}"; do
        echo -e "  ${GREEN}✓${NC} ${CHANNEL_DISPLAY[$ch]}"
    done
    echo ""

    # Build log tail command
    local log_tail_cmd="tail -f .tinyclaw/logs/queue.log"
    for ch in "${ACTIVE_CHANNELS[@]}"; do
        log_tail_cmd="$log_tail_cmd .tinyclaw/logs/${ch}.log"
    done

    # --- Build tmux session dynamically ---
    # Total panes = N channels + 3 (queue, heartbeat, logs)
    local total_panes=$(( ${#ACTIVE_CHANNELS[@]} + 3 ))

    tmux new-session -d -s "$TMUX_SESSION" -n "tinyclaw" -c "$SCRIPT_DIR"

    # Create remaining panes (pane 0 already exists)
    for ((i=1; i<total_panes; i++)); do
        tmux split-window -t "$TMUX_SESSION" -c "$SCRIPT_DIR"
        tmux select-layout -t "$TMUX_SESSION" tiled  # rebalance after each split
    done

    # Assign channel panes
    local pane_idx=0
    local whatsapp_pane=-1
    for ch in "${ACTIVE_CHANNELS[@]}"; do
        [ "$ch" = "whatsapp" ] && whatsapp_pane=$pane_idx
        tmux send-keys -t "$TMUX_SESSION:0.$pane_idx" "cd '$SCRIPT_DIR' && node ${CHANNEL_SCRIPT[$ch]}" C-m
        tmux select-pane -t "$TMUX_SESSION:0.$pane_idx" -T "${CHANNEL_DISPLAY[$ch]}"
        pane_idx=$((pane_idx + 1))
    done

    # Queue pane
    tmux send-keys -t "$TMUX_SESSION:0.$pane_idx" "cd '$SCRIPT_DIR' && node dist/queue-processor.js" C-m
    tmux select-pane -t "$TMUX_SESSION:0.$pane_idx" -T "Queue"
    pane_idx=$((pane_idx + 1))

    # Heartbeat pane
    tmux send-keys -t "$TMUX_SESSION:0.$pane_idx" "cd '$SCRIPT_DIR' && ./lib/heartbeat-cron.sh" C-m
    tmux select-pane -t "$TMUX_SESSION:0.$pane_idx" -T "Heartbeat"
    pane_idx=$((pane_idx + 1))

    # Logs pane
    tmux send-keys -t "$TMUX_SESSION:0.$pane_idx" "cd '$SCRIPT_DIR' && $log_tail_cmd" C-m
    tmux select-pane -t "$TMUX_SESSION:0.$pane_idx" -T "Logs"

    echo ""
    echo -e "${GREEN}✓ TinyClaw started${NC}"
    echo ""

    # WhatsApp QR code flow — only when WhatsApp is being started
    if [ "$whatsapp_pane" -ge 0 ]; then
        echo -e "${YELLOW}Starting WhatsApp client...${NC}"
        echo ""

        QR_FILE="$SCRIPT_DIR/.tinyclaw/channels/whatsapp_qr.txt"
        READY_FILE="$SCRIPT_DIR/.tinyclaw/channels/whatsapp_ready"
        QR_DISPLAYED=false

        for i in {1..60}; do
            sleep 1

            if [ -f "$READY_FILE" ]; then
                echo ""
                echo -e "${GREEN}WhatsApp connected and ready!${NC}"
                rm -f "$QR_FILE"
                break
            fi

            if [ -f "$QR_FILE" ] && [ "$QR_DISPLAYED" = false ]; then
                sleep 1
                clear
                echo ""
                echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
                echo -e "${GREEN}                    WhatsApp QR Code${NC}"
                echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
                echo ""
                cat "$QR_FILE"
                echo ""
                echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
                echo ""
                echo -e "${YELLOW}Scan this QR code with WhatsApp:${NC}"
                echo ""
                echo "   1. Open WhatsApp on your phone"
                echo "   2. Go to Settings -> Linked Devices"
                echo "   3. Tap 'Link a Device'"
                echo "   4. Scan the QR code above"
                echo ""
                echo -e "${BLUE}Waiting for connection...${NC}"
                QR_DISPLAYED=true
            fi

            if [ "$QR_DISPLAYED" = true ] || [ $i -gt 10 ]; then
                echo -n "."
            fi
        done
        echo ""

        if [ $i -eq 60 ] && [ ! -f "$READY_FILE" ]; then
            echo ""
            echo -e "${RED}WhatsApp didn't connect within 60 seconds${NC}"
            echo ""
            echo -e "${YELLOW}Try restarting TinyClaw:${NC}"
            echo -e "  ${GREEN}./tinyclaw.sh restart${NC}"
            echo ""
            echo "Or check WhatsApp client status:"
            echo -e "  ${GREEN}tmux attach -t $TMUX_SESSION${NC}"
            echo ""
            echo "Or check logs:"
            echo -e "  ${GREEN}./tinyclaw.sh logs whatsapp${NC}"
            echo ""
        fi
    fi

    # Build channel names for help line
    local channel_names
    channel_names=$(IFS='|'; echo "${ACTIVE_CHANNELS[*]}")

    echo ""
    echo -e "${GREEN}Commands:${NC}"
    echo "  Status:  ./tinyclaw.sh status"
    echo "  Logs:    ./tinyclaw.sh logs [$channel_names|queue]"
    echo "  Attach:  tmux attach -t $TMUX_SESSION"
    echo ""

    local ch_list
    ch_list=$(IFS=','; echo "${ACTIVE_CHANNELS[*]}")
    log "Daemon started with $total_panes panes (channels=$ch_list)"
}

# Stop daemon
stop_daemon() {
    log "Stopping TinyClaw..."

    if session_exists; then
        tmux kill-session -t "$TMUX_SESSION"
    fi

    # Kill any remaining channel processes
    for ch in "${ALL_CHANNELS[@]}"; do
        pkill -f "${CHANNEL_SCRIPT[$ch]}" || true
    done
    pkill -f "dist/queue-processor.js" || true
    pkill -f "heartbeat-cron.sh" || true

    echo -e "${GREEN}✓ TinyClaw stopped${NC}"
    log "Daemon stopped"
}

# Send message to Claude and get response
send_message() {
    local message="$1"
    local source="${2:-manual}"

    log "[$source] Sending: ${message:0:50}..."

    cd "$SCRIPT_DIR"
    RESPONSE=$(claude --dangerously-skip-permissions -c -p "$message" 2>&1)

    echo "$RESPONSE"

    log "[$source] Response length: ${#RESPONSE} chars"
}

# Status
status_daemon() {
    echo -e "${BLUE}TinyClaw Status${NC}"
    echo "==============="
    echo ""

    if session_exists; then
        echo -e "Tmux Session: ${GREEN}Running${NC}"
        echo "  Attach: tmux attach -t $TMUX_SESSION"
    else
        echo -e "Tmux Session: ${RED}Not Running${NC}"
        echo "  Start: ./tinyclaw.sh start"
    fi

    echo ""

    # Channel process status
    local ready_file="$SCRIPT_DIR/.tinyclaw/channels/whatsapp_ready"

    for ch in "${ALL_CHANNELS[@]}"; do
        local display="${CHANNEL_DISPLAY[$ch]}"
        local script="${CHANNEL_SCRIPT[$ch]}"
        local pad=""
        # Pad display name to align output
        while [ $((${#display} + ${#pad})) -lt 16 ]; do pad="$pad "; done

        if pgrep -f "$script" > /dev/null; then
            if [ "$ch" = "whatsapp" ] && [ -f "$ready_file" ]; then
                echo -e "${display}:${pad}${GREEN}Running & Ready${NC}"
            elif [ "$ch" = "whatsapp" ]; then
                echo -e "${display}:${pad}${YELLOW}Running (not ready yet)${NC}"
            else
                echo -e "${display}:${pad}${GREEN}Running${NC}"
            fi
        else
            echo -e "${display}:${pad}${RED}Not Running${NC}"
        fi
    done

    # Core processes
    if pgrep -f "dist/queue-processor.js" > /dev/null; then
        echo -e "Queue Processor: ${GREEN}Running${NC}"
    else
        echo -e "Queue Processor: ${RED}Not Running${NC}"
    fi

    if pgrep -f "heartbeat-cron.sh" > /dev/null; then
        echo -e "Heartbeat:       ${GREEN}Running${NC}"
    else
        echo -e "Heartbeat:       ${RED}Not Running${NC}"
    fi

    # Recent activity per channel (only show if log file exists)
    for ch in "${ALL_CHANNELS[@]}"; do
        if [ -f "$LOG_DIR/${ch}.log" ]; then
            echo ""
            echo "Recent ${CHANNEL_DISPLAY[$ch]} Activity:"
            printf '%0.s─' {1..24}; echo ""
            tail -n 5 "$LOG_DIR/${ch}.log"
        fi
    done

    echo ""
    echo "Recent Heartbeats:"
    printf '%0.s─' {1..18}; echo ""
    tail -n 3 "$LOG_DIR/heartbeat.log" 2>/dev/null || echo "  No heartbeat logs yet"

    echo ""
    echo "Logs:"
    for ch in "${ALL_CHANNELS[@]}"; do
        local display="${CHANNEL_DISPLAY[$ch]}"
        local pad=""
        while [ $((${#display} + ${#pad})) -lt 10 ]; do pad="$pad "; done
        echo "  ${display}:${pad}tail -f $LOG_DIR/${ch}.log"
    done
    echo "  Heartbeat: tail -f $LOG_DIR/heartbeat.log"
    echo "  Daemon:    tail -f $LOG_DIR/daemon.log"
}

# View logs
logs() {
    local target="${1:-}"

    # Check known channels (by id or alias)
    for ch in "${ALL_CHANNELS[@]}"; do
        if [ "$target" = "$ch" ] || [ "$target" = "${CHANNEL_ALIAS[$ch]:-}" ]; then
            tail -f "$LOG_DIR/${ch}.log"
            return
        fi
    done

    # Built-in log types
    case "$target" in
        heartbeat|hb) tail -f "$LOG_DIR/heartbeat.log" ;;
        daemon) tail -f "$LOG_DIR/daemon.log" ;;
        queue) tail -f "$LOG_DIR/queue.log" ;;
        all) tail -f "$LOG_DIR"/*.log ;;
        *)
            local channel_names
            channel_names=$(IFS='|'; echo "${ALL_CHANNELS[*]}")
            echo "Usage: $0 logs [$channel_names|heartbeat|daemon|queue|all]"
            ;;
    esac
}

# Reset a channel's authentication
channels_reset() {
    local ch="$1"
    local display="${CHANNEL_DISPLAY[$ch]:-}"

    if [ -z "$display" ]; then
        local channel_names
        channel_names=$(IFS='|'; echo "${ALL_CHANNELS[*]}")
        echo "Usage: $0 channels reset {$channel_names}"
        exit 1
    fi

    echo -e "${YELLOW}Resetting ${display} authentication...${NC}"

    # WhatsApp has local session files to clear
    if [ "$ch" = "whatsapp" ]; then
        rm -rf "$SCRIPT_DIR/.tinyclaw/whatsapp-session"
        rm -f "$SCRIPT_DIR/.tinyclaw/channels/whatsapp_ready"
        rm -f "$SCRIPT_DIR/.tinyclaw/channels/whatsapp_qr.txt"
        rm -rf "$SCRIPT_DIR/.wwebjs_cache"
        echo -e "${GREEN}✓ WhatsApp session cleared${NC}"
        echo ""
        echo "Restart TinyClaw to re-authenticate:"
        echo -e "  ${GREEN}./tinyclaw.sh restart${NC}"
        return
    fi

    # Token-based channels
    local token_key="${CHANNEL_TOKEN_KEY[$ch]:-}"
    if [ -n "$token_key" ]; then
        echo ""
        echo "To reset ${display}, run the setup wizard to update your bot token:"
        echo -e "  ${GREEN}./tinyclaw.sh setup${NC}"
        echo ""
        echo "Or manually edit .tinyclaw/settings.json to change ${token_key}"
    fi
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
        stop_daemon
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
                        echo "Use './tinyclaw.sh model {sonnet|opus}' to set the model."
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
                        echo "Use './tinyclaw.sh model {gpt-5.3-codex|gpt-5.2}' to set the model."
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
    attach)
        tmux attach -t "$TMUX_SESSION"
        ;;
    setup)
        "$SCRIPT_DIR/lib/setup-wizard.sh"
        ;;
    *)
        local_names=$(IFS='|'; echo "${ALL_CHANNELS[*]}")
        echo -e "${BLUE}TinyClaw - Claude Code + Messaging Channels${NC}"
        echo ""
        echo "Usage: $0 {start|stop|restart|status|setup|send|logs|reset|channels|provider|model|attach}"
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
        echo "  attach                   Attach to tmux session"
        echo ""
        echo "Examples:"
        echo "  $0 start"
        echo "  $0 status"
        echo "  $0 provider openai --model gpt-5.3-codex"
        echo "  $0 model opus"
        echo "  $0 send 'What time is it?'"
        echo "  $0 channels reset whatsapp"
        echo "  $0 logs telegram"
        echo ""
        exit 1
        ;;
esac
