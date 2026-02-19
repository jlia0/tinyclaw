#!/usr/bin/env bash
# Messaging and logging functions for TinyClaw

# Send message by writing to the incoming queue
send_message() {
    local message="$1"
    local channel="${2:-cli}"

    local queue_incoming="$TINYCLAW_HOME/queue/incoming"
    mkdir -p "$queue_incoming"

    local timestamp
    timestamp=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')
    local msg_id="${channel}_${timestamp}_$$"
    local queue_file="$queue_incoming/${msg_id}.json"

    # Write queue message in the same format used by other channels
    cat > "$queue_file" <<QEOF
{
  "channel": "$channel",
  "sender": "CLI User",
  "senderId": "cli",
  "message": $(printf '%s' "$message" | jq -Rs .),
  "timestamp": $timestamp,
  "messageId": "$msg_id"
}
QEOF

    log "[$channel] Queued message: ${message:0:50}..."
    echo -e "${GREEN}✓ Message queued${NC} (id: $msg_id)"
    echo "The queue processor will handle it. Check logs with: tinyclaw logs queue"
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
        echo -e "  ${GREEN}tinyclaw restart${NC}"
        return
    fi

    # Token-based channels
    local token_key="${CHANNEL_TOKEN_KEY[$ch]:-}"
    if [ -n "$token_key" ]; then
        echo ""
        echo "To reset ${display}, run the setup wizard to update your bot token:"
        echo -e "  ${GREEN}tinyclaw setup${NC}"
        echo ""
        echo "Or manually edit .tinyclaw/settings.json to change ${token_key}"
    fi
}
