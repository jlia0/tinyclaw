#!/bin/bash
# TinyClaw Simple - Main daemon using tmux + claude -c -p + WhatsApp

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
        npm install
    fi

    # Check if WhatsApp session already exists
    SESSION_EXISTS=false
    if [ -d "$SCRIPT_DIR/.tinyclaw/whatsapp-session" ] && [ "$(ls -A $SCRIPT_DIR/.tinyclaw/whatsapp-session 2>/dev/null)" ]; then
        SESSION_EXISTS=true
        echo -e "${GREEN}✓ WhatsApp session found, skipping QR code${NC}"
    fi

    # Create detached tmux session with 4 panes
    tmux new-session -d -s "$TMUX_SESSION" -n "tinyclaw" -c "$SCRIPT_DIR"

    # Split into 4 panes: 2 rows, 2 columns
    tmux split-window -v -t "$TMUX_SESSION" -c "$SCRIPT_DIR"
    tmux split-window -h -t "$TMUX_SESSION:0.0" -c "$SCRIPT_DIR"
    tmux split-window -h -t "$TMUX_SESSION:0.2" -c "$SCRIPT_DIR"

    # Pane 0 (top-left): WhatsApp client
    tmux send-keys -t "$TMUX_SESSION:0.0" "cd '$SCRIPT_DIR' && node whatsapp-client.js" C-m

    # Pane 1 (top-right): Queue processor
    tmux send-keys -t "$TMUX_SESSION:0.1" "cd '$SCRIPT_DIR' && node queue-processor.js" C-m

    # Pane 2 (bottom-left): Heartbeat
    tmux send-keys -t "$TMUX_SESSION:0.2" "cd '$SCRIPT_DIR' && ./heartbeat-cron.sh" C-m

    # Pane 3 (bottom-right): Logs
    tmux send-keys -t "$TMUX_SESSION:0.3" "cd '$SCRIPT_DIR' && tail -f .tinyclaw/logs/queue.log" C-m

    # Set pane titles
    tmux select-pane -t "$TMUX_SESSION:0.0" -T "WhatsApp"
    tmux select-pane -t "$TMUX_SESSION:0.1" -T "Queue"
    tmux select-pane -t "$TMUX_SESSION:0.2" -T "Heartbeat"
    tmux select-pane -t "$TMUX_SESSION:0.3" -T "Logs"

    echo ""
    echo -e "${GREEN}✓ TinyClaw started${NC}"
    echo ""

    # If no existing session, wait for QR code and display it
    if [ "$SESSION_EXISTS" = false ]; then
        echo -e "${YELLOW}📱 Waiting for QR code...${NC}"
        echo ""

        # Wait for QR code to appear (up to 20 seconds)
        for i in {1..20}; do
            sleep 1
            # Capture the WhatsApp pane with more lines (-S for scrollback, large number for full capture)
            QR_OUTPUT=$(tmux capture-pane -t "$TMUX_SESSION:0.0" -p -S -200 2>/dev/null)

            # Check if QR code is present (looks for QR pattern characters)
            if echo "$QR_OUTPUT" | grep -q "█"; then
                # Wait a bit more to ensure full QR code is rendered
                sleep 2

                # Capture again to get the complete QR code
                QR_OUTPUT=$(tmux capture-pane -t "$TMUX_SESSION:0.0" -p -S -200 2>/dev/null)

                clear
                echo ""
                echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
                echo -e "${GREEN}                    WhatsApp QR Code${NC}"
                echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
                echo ""
                # Show QR code without filtering (full capture)
                echo "$QR_OUTPUT" | grep -v "^$" | head -80
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
                echo -e "${BLUE}Waiting for authentication...${NC}"

                # Wait for authentication (watch logs)
                for j in {1..30}; do
                    sleep 1
                    LOG_OUTPUT=$(tail -5 "$LOG_DIR/whatsapp.log" 2>/dev/null)
                    if echo "$LOG_OUTPUT" | grep -q "authenticated\|ready"; then
                        echo ""
                        echo -e "${GREEN}✅ WhatsApp connected successfully!${NC}"
                        break
                    fi
                    echo -n "."
                done
                echo ""
                break
            fi
        done

        # If QR didn't show in terminal, give instructions
        if [ $i -eq 20 ]; then
            echo ""
            echo -e "${YELLOW}⚠️  QR code not captured in terminal${NC}"
            echo ""
            echo "To see the QR code, use one of these options:"
            echo ""
            echo -e "  ${GREEN}Option 1:${NC} ./show-qr.sh"
            echo -e "  ${GREEN}Option 2:${NC} tmux attach -t $TMUX_SESSION"
            echo ""
            echo "The QR code is in the top pane."
            echo ""
        fi
    else
        echo -e "${GREEN}✓ WhatsApp should connect automatically${NC}"
        sleep 2

        # Check if connected
        for i in {1..10}; do
            sleep 1
            LOG_OUTPUT=$(tail -5 "$LOG_DIR/whatsapp.log" 2>/dev/null)
            if echo "$LOG_OUTPUT" | grep -q "ready"; then
                echo -e "${GREEN}✅ WhatsApp connected!${NC}"
                break
            fi
            echo -n "."
        done
        echo ""
    fi

    echo ""
    echo -e "${BLUE}Tmux Session Layout:${NC}"
    echo "  ┌──────────────┬──────────────┐"
    echo "  │  WhatsApp    │    Queue     │"
    echo "  ├──────────────┼──────────────┤"
    echo "  │  Heartbeat   │    Logs      │"
    echo "  └──────────────┴──────────────┘"
    echo ""
    echo -e "${GREEN}Commands:${NC}"
    echo "  Status:  ./tinyclaw.sh status"
    echo "  Logs:    ./tinyclaw.sh logs whatsapp"
    echo "  Attach:  tmux attach -t $TMUX_SESSION"
    echo "  Stop:    ./tinyclaw.sh stop"
    echo ""
    echo -e "${YELLOW}💬 Send a WhatsApp message to test!${NC}"
    echo ""

    log "Daemon started with 3 panes"
}

# Stop daemon
stop_daemon() {
    log "Stopping TinyClaw..."

    if session_exists; then
        tmux kill-session -t "$TMUX_SESSION"
    fi

    # Kill any remaining processes
    pkill -f "whatsapp-client.js" || true
    pkill -f "queue-processor.js" || true
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

    if pgrep -f "whatsapp-client.js" > /dev/null; then
        echo -e "WhatsApp Client: ${GREEN}Running${NC}"
    else
        echo -e "WhatsApp Client: ${RED}Not Running${NC}"
    fi

    if pgrep -f "queue-processor.js" > /dev/null; then
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
    echo "Recent Activity:"
    echo "───────────────"
    tail -n 5 "$LOG_DIR/whatsapp.log" 2>/dev/null || echo "  No WhatsApp activity yet"

    echo ""
    echo "Recent Heartbeats:"
    echo "─────────────────"
    tail -n 3 "$LOG_DIR/heartbeat.log" 2>/dev/null || echo "  No heartbeat logs yet"

    echo ""
    echo "Logs:"
    echo "  WhatsApp: tail -f $LOG_DIR/whatsapp.log"
    echo "  Heartbeat: tail -f $LOG_DIR/heartbeat.log"
    echo "  Daemon: tail -f $LOG_DIR/daemon.log"
}

# View logs
logs() {
    case "${1:-whatsapp}" in
        whatsapp|wa)
            tail -f "$LOG_DIR/whatsapp.log"
            ;;
        heartbeat|hb)
            tail -f "$LOG_DIR/heartbeat.log"
            ;;
        daemon|all)
            tail -f "$LOG_DIR/daemon.log"
            ;;
        *)
            echo "Usage: $0 logs [whatsapp|heartbeat|daemon]"
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
    *)
        echo -e "${BLUE}TinyClaw Simple - Claude Code + WhatsApp${NC}"
        echo ""
        echo "Usage: $0 {start|stop|restart|status|send|logs|reset|attach}"
        echo ""
        echo "Commands:"
        echo "  start          Start TinyClaw (shows QR code for WhatsApp)"
        echo "  stop           Stop all processes"
        echo "  restart        Restart TinyClaw"
        echo "  status         Show current status"
        echo "  send <msg>     Send message to Claude manually"
        echo "  logs [type]    View logs (whatsapp|heartbeat|daemon|queue)"
        echo "  reset          Reset conversation (next message starts fresh)"
        echo "  attach         Attach to tmux session"
        echo ""
        echo "Examples:"
        echo "  $0 start"
        echo "  $0 status"
        echo "  $0 send 'What time is it?'"
        echo "  $0 reset"
        echo "  $0 logs queue"
        echo ""
        exit 1
        ;;
esac
