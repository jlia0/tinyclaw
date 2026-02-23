#!/usr/bin/env bash
# Messaging and logging functions for TinyClaw

# Send message via the API server queue
send_message() {
    local message="$1"
    local source="${2:-manual}"
    local api_port="${TINYCLAW_API_PORT:-3777}"
    local api_url="http://localhost:${api_port}"

    log "[$source] Sending: ${message:0:50}..."

    local result
    result=$(curl -s -X POST "${api_url}/api/message" \
        -H "Content-Type: application/json" \
        -d "$(jq -n \
            --arg message "$message" \
            --arg channel "cli" \
            --arg sender "$source" \
            '{message: $message, channel: $channel, sender: $sender}'
        )" 2>&1)

    if echo "$result" | jq -e '.ok' &>/dev/null; then
        local message_id
        message_id=$(echo "$result" | jq -r '.messageId')
        echo "Message enqueued: $message_id"
        log "[$source] Enqueued: $message_id"
    else
        echo "Failed to enqueue message: $result" >&2
        log "[$source] ERROR: $result"
    fi
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
