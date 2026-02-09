#!/bin/bash
# TinyClaw Simple - Main daemon using tmux + claude -c -p + WhatsApp + Discord

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMUX_SESSION="tinyclaw"
LOG_DIR="$SCRIPT_DIR/.tinyclaw/logs"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

mkdir -p "$LOG_DIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_DIR/daemon.log"
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

    # Build TypeScript if needed
    if [ ! -d "$SCRIPT_DIR/dist" ] || [ "$SCRIPT_DIR/src/whatsapp-client.ts" -nt "$SCRIPT_DIR/dist/whatsapp-client.js" ] || [ "$SCRIPT_DIR/src/queue-processor.ts" -nt "$SCRIPT_DIR/dist/queue-processor.js" ] || [ "$SCRIPT_DIR/src/discord-client.ts" -nt "$SCRIPT_DIR/dist/discord-client.js" ]; then
        echo -e "${YELLOW}Building TypeScript...${NC}"
        cd "$SCRIPT_DIR"
        npm run build
    fi

    # Configuration
    CHANNEL_CONFIG="$SCRIPT_DIR/.tinyclaw/channel"
    MODEL_CONFIG="$SCRIPT_DIR/.tinyclaw/model"
    HAS_DISCORD=false
    HAS_WHATSAPP=false

    # First-run setup
    if [ ! -f "$CHANNEL_CONFIG" ] || [ ! -f "$MODEL_CONFIG" ]; then
        echo ""
        echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${GREEN}  TinyClaw - First Time Setup${NC}"
        echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""

        if [ ! -f "$CHANNEL_CONFIG" ]; then
            echo "Which messaging channel do you want to use?"
            echo ""
            echo "  1) Discord"
            echo "  2) WhatsApp"
            echo "  3) Both"
            echo ""
            read -rp "Choose [1-3]: " CHANNEL_CHOICE

            case "$CHANNEL_CHOICE" in
                1) echo "discord" > "$CHANNEL_CONFIG" ;;
                2) echo "whatsapp" > "$CHANNEL_CONFIG" ;;
                3) echo "both" > "$CHANNEL_CONFIG" ;;
                *)
                    echo -e "${RED}Invalid choice${NC}"
                    return 1
                    ;;
            esac
            echo -e "${GREEN}✓ Channel: $(cat "$CHANNEL_CONFIG")${NC}"
            echo ""
        fi

        if [ ! -f "$MODEL_CONFIG" ]; then
            echo "Which Claude model?"
            echo ""
            echo "  1) Sonnet  (fast, recommended)"
            echo "  2) Opus    (smartest)"
            echo ""
            read -rp "Choose [1-2]: " MODEL_CHOICE

            case "$MODEL_CHOICE" in
                1) echo "sonnet" > "$MODEL_CONFIG" ;;
                2) echo "opus" > "$MODEL_CONFIG" ;;
                *)
                    echo -e "${RED}Invalid choice${NC}"
                    return 1
                    ;;
            esac
            echo -e "${GREEN}✓ Model: $(cat "$MODEL_CONFIG")${NC}"
            echo ""
        fi

        echo -e "  (Run './tinyclaw.sh setup' to change later)"
        echo ""
    fi

    CHANNEL=$(cat "$CHANNEL_CONFIG")

    # Set flags from config
    case "$CHANNEL" in
        discord) HAS_DISCORD=true ;;
        whatsapp) HAS_WHATSAPP=true ;;
        both) HAS_DISCORD=true; HAS_WHATSAPP=true ;;
        *)
            echo -e "${RED}Invalid channel config: $CHANNEL${NC}"
            echo "Run './tinyclaw.sh setup' to reconfigure"
            return 1
            ;;
    esac

    # Validate: Discord needs a token in .env
    if [ "$HAS_DISCORD" = true ]; then
        DISCORD_TOKEN=""
        if [ -f "$SCRIPT_DIR/.env" ]; then
            DISCORD_TOKEN=$(grep -s '^DISCORD_BOT_TOKEN=' "$SCRIPT_DIR/.env" | cut -d'=' -f2)
        fi
        if [ -z "$DISCORD_TOKEN" ] || [ "$DISCORD_TOKEN" = "your_token_here" ]; then
            echo -e "${RED}Discord is configured but DISCORD_BOT_TOKEN is missing from .env${NC}"
            echo "  Add your bot token to .env and try again"
            return 1
        fi
    fi

    # Report channels
    echo -e "${BLUE}Channels:${NC}"
    [ "$HAS_DISCORD" = true ] && echo -e "  ${GREEN}✓${NC} Discord"
    [ "$HAS_WHATSAPP" = true ] && echo -e "  ${GREEN}✓${NC} WhatsApp"
    echo ""

    # Build log tail command based on available channels
    LOG_TAIL_CMD="tail -f .tinyclaw/logs/queue.log"
    if [ "$HAS_DISCORD" = true ]; then
        LOG_TAIL_CMD="$LOG_TAIL_CMD .tinyclaw/logs/discord.log"
    fi
    if [ "$HAS_WHATSAPP" = true ]; then
        LOG_TAIL_CMD="$LOG_TAIL_CMD .tinyclaw/logs/whatsapp.log"
    fi

    tmux new-session -d -s "$TMUX_SESSION" -n "tinyclaw" -c "$SCRIPT_DIR"

    if [ "$HAS_WHATSAPP" = true ] && [ "$HAS_DISCORD" = true ]; then
        # Both channels: 5 panes
        # ┌──────────┬──────────┬──────────┐
        # │ WhatsApp │ Discord  │  Queue   │
        # ├──────────┴──────────┼──────────┤
        # │     Heartbeat       │   Logs   │
        # └─────────────────────┴──────────┘
        tmux split-window -v -t "$TMUX_SESSION" -c "$SCRIPT_DIR"
        tmux split-window -h -t "$TMUX_SESSION:0.0" -c "$SCRIPT_DIR"
        tmux split-window -h -t "$TMUX_SESSION:0.1" -c "$SCRIPT_DIR"
        tmux split-window -h -t "$TMUX_SESSION:0.3" -c "$SCRIPT_DIR"

        tmux send-keys -t "$TMUX_SESSION:0.0" "cd '$SCRIPT_DIR' && node dist/whatsapp-client.js" C-m
        tmux send-keys -t "$TMUX_SESSION:0.1" "cd '$SCRIPT_DIR' && node dist/discord-client.js" C-m
        tmux send-keys -t "$TMUX_SESSION:0.2" "cd '$SCRIPT_DIR' && node dist/queue-processor.js" C-m
        tmux send-keys -t "$TMUX_SESSION:0.3" "cd '$SCRIPT_DIR' && ./heartbeat-cron.sh" C-m
        tmux send-keys -t "$TMUX_SESSION:0.4" "cd '$SCRIPT_DIR' && $LOG_TAIL_CMD" C-m

        tmux select-pane -t "$TMUX_SESSION:0.0" -T "WhatsApp"
        tmux select-pane -t "$TMUX_SESSION:0.1" -T "Discord"
        tmux select-pane -t "$TMUX_SESSION:0.2" -T "Queue"
        tmux select-pane -t "$TMUX_SESSION:0.3" -T "Heartbeat"
        tmux select-pane -t "$TMUX_SESSION:0.4" -T "Logs"

        PANE_COUNT=5
        WHATSAPP_PANE=0

    elif [ "$HAS_DISCORD" = true ]; then
        # Discord only: 4 panes (2x2 grid)
        # ┌──────────┬──────────┐
        # │ Discord  │  Queue   │
        # ├──────────┼──────────┤
        # │Heartbeat │   Logs   │
        # └──────────┴──────────┘
        tmux split-window -v -t "$TMUX_SESSION" -c "$SCRIPT_DIR"
        tmux split-window -h -t "$TMUX_SESSION:0.0" -c "$SCRIPT_DIR"
        tmux split-window -h -t "$TMUX_SESSION:0.2" -c "$SCRIPT_DIR"

        tmux send-keys -t "$TMUX_SESSION:0.0" "cd '$SCRIPT_DIR' && node dist/discord-client.js" C-m
        tmux send-keys -t "$TMUX_SESSION:0.1" "cd '$SCRIPT_DIR' && node dist/queue-processor.js" C-m
        tmux send-keys -t "$TMUX_SESSION:0.2" "cd '$SCRIPT_DIR' && ./heartbeat-cron.sh" C-m
        tmux send-keys -t "$TMUX_SESSION:0.3" "cd '$SCRIPT_DIR' && $LOG_TAIL_CMD" C-m

        tmux select-pane -t "$TMUX_SESSION:0.0" -T "Discord"
        tmux select-pane -t "$TMUX_SESSION:0.1" -T "Queue"
        tmux select-pane -t "$TMUX_SESSION:0.2" -T "Heartbeat"
        tmux select-pane -t "$TMUX_SESSION:0.3" -T "Logs"

        PANE_COUNT=4
        WHATSAPP_PANE=-1

    else
        # WhatsApp only: 4 panes (2x2 grid)
        # ┌──────────┬──────────┐
        # │ WhatsApp │  Queue   │
        # ├──────────┼──────────┤
        # │Heartbeat │   Logs   │
        # └──────────┴──────────┘
        tmux split-window -v -t "$TMUX_SESSION" -c "$SCRIPT_DIR"
        tmux split-window -h -t "$TMUX_SESSION:0.0" -c "$SCRIPT_DIR"
        tmux split-window -h -t "$TMUX_SESSION:0.2" -c "$SCRIPT_DIR"

        tmux send-keys -t "$TMUX_SESSION:0.0" "cd '$SCRIPT_DIR' && node dist/whatsapp-client.js" C-m
        tmux send-keys -t "$TMUX_SESSION:0.1" "cd '$SCRIPT_DIR' && node dist/queue-processor.js" C-m
        tmux send-keys -t "$TMUX_SESSION:0.2" "cd '$SCRIPT_DIR' && ./heartbeat-cron.sh" C-m
        tmux send-keys -t "$TMUX_SESSION:0.3" "cd '$SCRIPT_DIR' && $LOG_TAIL_CMD" C-m

        tmux select-pane -t "$TMUX_SESSION:0.0" -T "WhatsApp"
        tmux select-pane -t "$TMUX_SESSION:0.1" -T "Queue"
        tmux select-pane -t "$TMUX_SESSION:0.2" -T "Heartbeat"
        tmux select-pane -t "$TMUX_SESSION:0.3" -T "Logs"

        PANE_COUNT=4
        WHATSAPP_PANE=0
    fi

    echo ""
    echo -e "${GREEN}✓ TinyClaw started${NC}"
    echo ""

    # WhatsApp QR code flow — only when WhatsApp is being started
    if [ "$WHATSAPP_PANE" -ge 0 ]; then
        echo -e "${YELLOW}📱 Starting WhatsApp client...${NC}"
        echo ""

        QR_FILE="$SCRIPT_DIR/.tinyclaw/channels/whatsapp_qr.txt"
        READY_FILE="$SCRIPT_DIR/.tinyclaw/channels/whatsapp_ready"
        QR_DISPLAYED=false

        # Poll for ready flag (up to 60 seconds)
        for i in {1..60}; do
            sleep 1

            # Check if ready flag exists (WhatsApp is fully connected)
            if [ -f "$READY_FILE" ]; then
                echo ""
                echo -e "${GREEN}✅ WhatsApp connected and ready!${NC}"
                # Clean up QR code file if it exists
                rm -f "$QR_FILE"
                break
            fi

            # Check if QR code needs to be displayed
            if [ -f "$QR_FILE" ] && [ "$QR_DISPLAYED" = false ]; then
                # Wait a bit more to ensure file is fully written
                sleep 1

                clear
                echo ""
                echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
                echo -e "${GREEN}                    WhatsApp QR Code${NC}"
                echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
                echo ""
                # Display QR code from file (no tmux distortion!)
                cat "$QR_FILE"
                echo ""
                echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
                echo ""
                echo -e "${YELLOW}📱 Scan this QR code with WhatsApp:${NC}"
                echo ""
                echo "   1. Open WhatsApp on your phone"
                echo "   2. Go to Settings → Linked Devices"
                echo "   3. Tap 'Link a Device'"
                echo "   4. Scan the QR code above"
                echo ""
                echo -e "${BLUE}Waiting for connection...${NC}"
                QR_DISPLAYED=true
            fi

            # Show progress dots (only if QR was displayed or after 10 seconds)
            if [ "$QR_DISPLAYED" = true ] || [ $i -gt 10 ]; then
                echo -n "."
            fi
        done
        echo ""

        # Timeout warning
        if [ $i -eq 60 ] && [ ! -f "$READY_FILE" ]; then
            echo ""
            echo -e "${RED}⚠️  WhatsApp didn't connect within 60 seconds${NC}"
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

    # Dynamic layout display
    echo ""
    echo -e "${BLUE}Tmux Session Layout:${NC}"
    if [ "$HAS_WHATSAPP" = true ] && [ "$HAS_DISCORD" = true ]; then
        echo "  ┌──────────┬──────────┬──────────┐"
        echo "  │ WhatsApp │ Discord  │  Queue   │"
        echo "  ├──────────┴──────────┼──────────┤"
        echo "  │     Heartbeat       │   Logs   │"
        echo "  └─────────────────────┴──────────┘"
    elif [ "$HAS_DISCORD" = true ]; then
        echo "  ┌──────────┬──────────┐"
        echo "  │ Discord  │  Queue   │"
        echo "  ├──────────┼──────────┤"
        echo "  │Heartbeat │   Logs   │"
        echo "  └──────────┴──────────┘"
    else
        echo "  ┌──────────┬──────────┐"
        echo "  │ WhatsApp │  Queue   │"
        echo "  ├──────────┼──────────┤"
        echo "  │Heartbeat │   Logs   │"
        echo "  └──────────┴──────────┘"
    fi
    echo ""
    echo -e "${GREEN}Commands:${NC}"
    echo "  Status:  ./tinyclaw.sh status"
    echo "  Logs:    ./tinyclaw.sh logs [whatsapp|discord|queue]"
    echo "  Attach:  tmux attach -t $TMUX_SESSION"
    echo "  Stop:    ./tinyclaw.sh stop"
    echo ""
    if [ "$HAS_WHATSAPP" = true ] && [ "$HAS_DISCORD" = true ]; then
        echo -e "${YELLOW}Send a WhatsApp or Discord DM to test!${NC}"
    elif [ "$HAS_DISCORD" = true ]; then
        echo -e "${YELLOW}Send a Discord DM to test!${NC}"
    else
        echo -e "${YELLOW}Send a WhatsApp message to test!${NC}"
    fi
    echo ""

    log "Daemon started with $PANE_COUNT panes (discord=$HAS_DISCORD, whatsapp=$HAS_WHATSAPP)"
}

# Stop daemon
stop_daemon() {
    log "Stopping TinyClaw..."

    if session_exists; then
        tmux kill-session -t "$TMUX_SESSION"
    fi

    # Kill any remaining processes
    pkill -f "dist/whatsapp-client.js" || true
    pkill -f "dist/discord-client.js" || true
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

    # Use claude -c -p to continue and get final response
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

    READY_FILE="$SCRIPT_DIR/.tinyclaw/channels/whatsapp_ready"

    if pgrep -f "dist/whatsapp-client.js" > /dev/null; then
        if [ -f "$READY_FILE" ]; then
            echo -e "WhatsApp Client: ${GREEN}Running & Ready${NC}"
        else
            echo -e "WhatsApp Client: ${YELLOW}Running (not ready yet)${NC}"
        fi
    else
        echo -e "WhatsApp Client: ${RED}Not Running${NC}"
    fi

    if pgrep -f "dist/discord-client.js" > /dev/null; then
        echo -e "Discord Client:  ${GREEN}Running${NC}"
    else
        echo -e "Discord Client:  ${RED}Not Running${NC}"
    fi

    if pgrep -f "dist/queue-processor.js" > /dev/null; then
        echo -e "Queue Processor: ${GREEN}Running${NC}"
    else
        echo -e "Queue Processor: ${RED}Not Running${NC}"
    fi

    if pgrep -f "heartbeat-cron.sh" > /dev/null; then
        echo -e "Heartbeat: ${GREEN}Running${NC}"
    else
        echo -e "Heartbeat: ${RED}Not Running${NC}"
    fi

    echo ""
    echo "Recent WhatsApp Activity:"
    echo "────────────────────────"
    tail -n 5 "$LOG_DIR/whatsapp.log" 2>/dev/null || echo "  No WhatsApp activity yet"

    echo ""
    echo "Recent Discord Activity:"
    echo "───────────────────────"
    tail -n 5 "$LOG_DIR/discord.log" 2>/dev/null || echo "  No Discord activity yet"

    echo ""
    echo "Recent Heartbeats:"
    echo "─────────────────"
    tail -n 3 "$LOG_DIR/heartbeat.log" 2>/dev/null || echo "  No heartbeat logs yet"

    echo ""
    echo "Logs:"
    echo "  WhatsApp: tail -f $LOG_DIR/whatsapp.log"
    echo "  Discord:  tail -f $LOG_DIR/discord.log"
    echo "  Heartbeat: tail -f $LOG_DIR/heartbeat.log"
    echo "  Daemon: tail -f $LOG_DIR/daemon.log"
}

# View logs
logs() {
    case "${1:-whatsapp}" in
        whatsapp|wa)
            tail -f "$LOG_DIR/whatsapp.log"
            ;;
        discord|dc)
            tail -f "$LOG_DIR/discord.log"
            ;;
        heartbeat|hb)
            tail -f "$LOG_DIR/heartbeat.log"
            ;;
        daemon|all)
            tail -f "$LOG_DIR/daemon.log"
            ;;
        *)
            echo "Usage: $0 logs [whatsapp|discord|heartbeat|daemon]"
            ;;
    esac
}

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
        echo -e "${YELLOW}🔄 Resetting conversation...${NC}"
        touch "$SCRIPT_DIR/.tinyclaw/reset_flag"
        echo -e "${GREEN}✓ Reset flag set${NC}"
        echo ""
        echo "The next message will start a fresh conversation (without -c)."
        echo "After that, conversation will continue normally."
        ;;
    attach)
        tmux attach -t "$TMUX_SESSION"
        ;;
    setup)
        CHANNEL_CONFIG="$SCRIPT_DIR/.tinyclaw/channel"
        MODEL_CONFIG="$SCRIPT_DIR/.tinyclaw/model"

        echo ""
        echo "Which messaging channel do you want to use?"
        echo ""
        echo "  1) Discord"
        echo "  2) WhatsApp"
        echo "  3) Both"
        echo ""
        if [ -f "$CHANNEL_CONFIG" ]; then
            echo -e "  ${YELLOW}Current: $(cat "$CHANNEL_CONFIG")${NC}"
            echo ""
        fi
        read -rp "Choose [1-3]: " CHANNEL_CHOICE
        case "$CHANNEL_CHOICE" in
            1) echo "discord" > "$CHANNEL_CONFIG" ;;
            2) echo "whatsapp" > "$CHANNEL_CONFIG" ;;
            3) echo "both" > "$CHANNEL_CONFIG" ;;
            *)
                echo -e "${RED}Invalid choice${NC}"
                exit 1
                ;;
        esac
        echo -e "${GREEN}✓ Channel: $(cat "$CHANNEL_CONFIG")${NC}"

        echo ""
        echo "Which Claude model?"
        echo ""
        echo "  1) Sonnet  (fast, recommended)"
        echo "  2) Opus    (smartest)"
        echo ""
        if [ -f "$MODEL_CONFIG" ]; then
            echo -e "  ${YELLOW}Current: $(cat "$MODEL_CONFIG")${NC}"
            echo ""
        fi
        read -rp "Choose [1-2]: " MODEL_CHOICE
        case "$MODEL_CHOICE" in
            1) echo "sonnet" > "$MODEL_CONFIG" ;;
            2) echo "opus" > "$MODEL_CONFIG" ;;
            *)
                echo -e "${RED}Invalid choice${NC}"
                exit 1
                ;;
        esac
        echo -e "${GREEN}✓ Model: $(cat "$MODEL_CONFIG")${NC}"

        echo ""
        echo "Restart to apply: ./tinyclaw.sh restart"
        ;;
    *)
        echo -e "${BLUE}TinyClaw Simple - Claude Code + WhatsApp + Discord${NC}"
        echo ""
        echo "Usage: $0 {start|stop|restart|status|setup|send|logs|reset|attach}"
        echo ""
        echo "Commands:"
        echo "  start          Start TinyClaw"
        echo "  stop           Stop all processes"
        echo "  restart        Restart TinyClaw"
        echo "  status         Show current status"
        echo "  setup          Change messaging channel (Discord/WhatsApp/Both)"
        echo "  send <msg>     Send message to Claude manually"
        echo "  logs [type]    View logs (whatsapp|discord|heartbeat|daemon|queue)"
        echo "  reset          Reset conversation (next message starts fresh)"
        echo "  attach         Attach to tmux session"
        echo ""
        echo "Examples:"
        echo "  $0 start"
        echo "  $0 status"
        echo "  $0 send 'What time is it?'"
        echo "  $0 reset"
        echo "  $0 logs discord"
        echo ""
        exit 1
        ;;
esac
