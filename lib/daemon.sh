#!/usr/bin/env bash
# Daemon lifecycle management for TinyClaw
# Handles starting, stopping, restarting, and status checking

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
    load_settings
    local load_rc=$?

    if [ $load_rc -eq 2 ]; then
        # JSON file exists but contains invalid JSON
        echo -e "${RED}Error: settings.json exists but contains invalid JSON${NC}"
        echo ""
        local jq_err
        jq_err=$(jq empty "$SETTINGS_FILE" 2>&1)
        echo -e "  ${YELLOW}${jq_err}${NC}"
        echo ""

        # Attempt auto-fix using jsonrepair (npm package)
        echo -e "${YELLOW}Attempting to auto-fix...${NC}"
        local repair_output
        repair_output=$(node -e 'const{jsonrepair}=require("jsonrepair");const fs=require("fs");try{const raw=fs.readFileSync(process.argv[1],"utf8");const fixed=jsonrepair(raw);JSON.parse(fixed);fs.copyFileSync(process.argv[1],process.argv[1]+".bak");fs.writeFileSync(process.argv[1],JSON.stringify(JSON.parse(fixed),null,2)+"\n");console.log("ok")}catch(e){console.error(e.message);process.exit(1)}' "$SETTINGS_FILE" 2>&1)

        if [ $? -eq 0 ]; then
            echo -e "  ${GREEN}✓ JSON auto-fixed successfully${NC}"
            echo -e "  Backup saved to ${SETTINGS_FILE}.bak"
            echo ""
            load_settings
            load_rc=$?
        fi

        if [ $load_rc -ne 0 ]; then
            echo -e "${RED}Could not repair settings.json${NC}"
            echo "  Fix manually: $SETTINGS_FILE"
            echo "  Or reconfigure: tinyclaw setup"
            return 1
        fi
    elif [ $load_rc -ne 0 ]; then
        echo -e "${YELLOW}No configuration found. Running setup wizard...${NC}"
        echo ""
        "$SCRIPT_DIR/lib/setup-wizard.sh"

        if ! load_settings; then
            echo -e "${RED}Setup failed or was cancelled${NC}"
            return 1
        fi
    fi

    if [ ${#ACTIVE_CHANNELS[@]} -eq 0 ]; then
        echo -e "${RED}No channels configured. Run 'tinyclaw setup' to reconfigure${NC}"
        return 1
    fi

    # Ensure all agent workspaces have .agents/skills symlink
    ensure_agent_skills_links

    # Validate tokens for channels that need them
    for ch in "${ACTIVE_CHANNELS[@]}"; do
        local token_key="${CHANNEL_TOKEN_KEY[$ch]:-}"
        if [ -n "$token_key" ] && [ -z "${CHANNEL_TOKENS[$ch]:-}" ]; then
            echo -e "${RED}${CHANNEL_DISPLAY[$ch]} is configured but bot token is missing${NC}"
            echo "Run 'tinyclaw setup' to reconfigure"
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

    # Check for updates (non-blocking)
    local update_info
    update_info=$(check_for_updates 2>/dev/null || true)
    if [ -n "$update_info" ]; then
        IFS='|' read -r current latest <<< "$update_info"
        show_update_notification "$current" "$latest"
    fi

    # Report channels
    echo -e "${BLUE}Channels:${NC}"
    for ch in "${ACTIVE_CHANNELS[@]}"; do
        echo -e "  ${GREEN}✓${NC} ${CHANNEL_DISPLAY[$ch]}"
    done
    echo ""

    # Build log tail command
    local log_tail_cmd="tail -f $LOG_DIR/queue.log"
    for ch in "${ACTIVE_CHANNELS[@]}"; do
        log_tail_cmd="$log_tail_cmd $LOG_DIR/${ch}.log"
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

        QR_FILE="$TINYCLAW_HOME/channels/whatsapp_qr.txt"
        READY_FILE="$TINYCLAW_HOME/channels/whatsapp_ready"
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
            echo -e "  ${GREEN}tinyclaw restart${NC}"
            echo ""
            echo "Or check WhatsApp client status:"
            echo -e "  ${GREEN}tmux attach -t $TMUX_SESSION${NC}"
            echo ""
            echo "Or check logs:"
            echo -e "  ${GREEN}tinyclaw logs whatsapp${NC}"
            echo ""
        fi
    fi

    # Build channel names for help line
    local channel_names
    channel_names=$(IFS='|'; echo "${ACTIVE_CHANNELS[*]}")

    echo ""
    echo -e "${GREEN}Commands:${NC}"
    echo "  Status:  tinyclaw status"
    echo "  Logs:    tinyclaw logs [$channel_names|queue]"
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

# Restart daemon safely even when called from inside TinyClaw's tmux session
restart_daemon() {
    if session_exists && [ -n "${TMUX:-}" ]; then
        local current_session
        current_session=$(tmux display-message -p '#S' 2>/dev/null || true)
        if [ "$current_session" = "$TMUX_SESSION" ]; then
            local bash_bin
            bash_bin=$(command -v bash)
            log "Restart requested from inside tmux session; scheduling detached restart..."
            nohup "$bash_bin" "$SCRIPT_DIR/tinyclaw.sh" __delayed_start >/dev/null 2>&1 &
            stop_daemon
            return
        fi
    fi

    stop_daemon
    sleep 2
    start_daemon
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
        echo "  Start: tinyclaw start"
    fi

    echo ""

    # Channel process status
    local ready_file="$TINYCLAW_HOME/channels/whatsapp_ready"

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
