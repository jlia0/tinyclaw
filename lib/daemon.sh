#!/usr/bin/env bash
# Daemon runtime for TinyAGI
# Lifecycle (start/stop/restart/status), update checks, agent skills sync, log viewing

# Start daemon
start_daemon() {
    # Parse flags
    local skip_setup=false
    for arg in "$@"; do
        case "$arg" in
            --skip-setup) skip_setup=true ;;
        esac
    done

    if session_exists; then
        echo -e "${YELLOW}Session already running${NC}"
        return 1
    fi

    show_banner
    log "Starting TinyAGI daemon..."

    # Check if Node.js dependencies are installed
    if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
        echo -e "${YELLOW}Installing Node.js dependencies...${NC}"
        cd "$SCRIPT_DIR"
        PUPPETEER_SKIP_DOWNLOAD=true npm install
    fi

    # Build TypeScript if any package isn't built
    local needs_build=false
    for pkg in core teams server channels main; do
        if [ ! -d "$SCRIPT_DIR/packages/$pkg/dist" ]; then
            needs_build=true
            break
        fi
    done
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
            echo "  Or reconfigure: tinyagi setup"
            return 1
        fi
    elif [ $load_rc -ne 0 ]; then
        if [ "$skip_setup" = true ]; then
            # --skip-setup: start API server only, let user complete setup via web
            echo -e "${YELLOW}No configuration found. Starting API server for web setup...${NC}"
            echo ""
            _start_server_only
            return
        fi
        echo -e "${YELLOW}No configuration found. Running setup wizard...${NC}"
        echo ""
        node "$SCRIPT_DIR/packages/cli/dist/setup-wizard.js"

        if ! load_settings; then
            echo -e "${RED}Setup failed or was cancelled${NC}"
            return 1
        fi
    fi

    if [ ${#ACTIVE_CHANNELS[@]} -eq 0 ]; then
        if [ "$skip_setup" = true ]; then
            # Settings exist but no channels — start API-only mode
            _start_server_only
            return
        fi
        echo -e "${RED}No channels configured. Run 'tinyagi setup' to reconfigure${NC}"
        return 1
    fi

    # Ensure all agent workspaces have .agents/skills symlink
    ensure_agent_skills_links

    # Validate tokens for channels that need them
    for ch in "${ACTIVE_CHANNELS[@]}"; do
        local token_key
        token_key="$(channel_token_key "$ch")"
        if [ -n "$token_key" ] && [ -z "$(get_channel_token "$ch")" ]; then
            echo -e "${RED}$(channel_display "$ch") is configured but bot token is missing${NC}"
            echo "Run 'tinyagi setup' to reconfigure"
            return 1
        fi
    done

    # Write tokens to .env for the Node.js clients
    local env_file="$SCRIPT_DIR/.env"
    : > "$env_file"
    for ch in "${ACTIVE_CHANNELS[@]}"; do
        local env_var
        env_var="$(channel_token_env "$ch")"
        local token_val
        token_val="$(get_channel_token "$ch")"
        if [ -n "$env_var" ] && [ -n "$token_val" ]; then
            echo "${env_var}=${token_val}" >> "$env_file"
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
        echo -e "  ${GREEN}✓${NC} $(channel_display "$ch")"
    done
    echo ""

    # --- Build tmux session dynamically ---
    # Total panes = N channels + 2 (queue, heartbeat)
    local total_panes=$(( ${#ACTIVE_CHANNELS[@]} + 2 ))

    tmux new-session -d -s "$TMUX_SESSION" -n "tinyagi" -c "$SCRIPT_DIR"

    # Detect tmux base indices (user may have base-index or pane-base-index set)
    local win_base
    win_base=$(tmux show-option -gv base-index 2>/dev/null || echo 0)
    local pane_base
    pane_base=$(tmux show-option -gv pane-base-index 2>/dev/null || echo 0)

    # Create remaining panes (first pane already exists)
    for ((i=1; i<total_panes; i++)); do
        tmux split-window -t "$TMUX_SESSION" -c "$SCRIPT_DIR"
        tmux select-layout -t "$TMUX_SESSION" tiled  # rebalance after each split
    done

    # Wait for pane shells to finish initializing (.zshrc, conda init, nvm, etc.)
    # Without this delay, commands sent via send-keys run in a half-initialized
    # shell and exit silently. See: https://github.com/TinyAGI/tinyagi/issues/156
    sleep 2

    # Assign channel panes
    local pane_idx=$pane_base
    local whatsapp_pane=-1
    for ch in "${ACTIVE_CHANNELS[@]}"; do
        [ "$ch" = "whatsapp" ] && whatsapp_pane=$pane_idx
        tmux send-keys -t "$TMUX_SESSION:${win_base}.$pane_idx" "cd '$SCRIPT_DIR' && node $(channel_script "$ch")" C-m
        tmux select-pane -t "$TMUX_SESSION:${win_base}.$pane_idx" -T "$(channel_display "$ch")"
        pane_idx=$((pane_idx + 1))
    done

    # Queue pane
    tmux send-keys -t "$TMUX_SESSION:${win_base}.$pane_idx" "cd '$SCRIPT_DIR' && node packages/main/dist/index.js" C-m
    tmux select-pane -t "$TMUX_SESSION:${win_base}.$pane_idx" -T "Queue"
    pane_idx=$((pane_idx + 1))

    # Heartbeat pane
    tmux send-keys -t "$TMUX_SESSION:${win_base}.$pane_idx" "cd '$SCRIPT_DIR' && ./lib/heartbeat-cron.sh" C-m
    tmux select-pane -t "$TMUX_SESSION:${win_base}.$pane_idx" -T "Heartbeat"

    echo ""
    echo -e "${GREEN}✓ TinyAGI started${NC}"
    echo ""

    # WhatsApp QR code flow — only when WhatsApp is being started
    if [ "$whatsapp_pane" -ge 0 ]; then
        echo -e "${YELLOW}Starting WhatsApp client...${NC}"
        echo ""

        QR_FILE="$TINYAGI_HOME/channels/whatsapp_qr.txt"
        READY_FILE="$TINYAGI_HOME/channels/whatsapp_ready"
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
            echo -e "${YELLOW}Try restarting TinyAGI:${NC}"
            echo -e "  ${GREEN}tinyagi restart${NC}"
            echo ""
            echo "Or check WhatsApp client status:"
            echo -e "  ${GREEN}tmux attach -t $TMUX_SESSION${NC}"
            echo ""
            echo "Or check logs:"
            echo -e "  ${GREEN}tinyagi logs whatsapp${NC}"
            echo ""
        fi
    fi

    # Build channel names for help line
    local channel_names
    channel_names=$(IFS='|'; echo "${ACTIVE_CHANNELS[*]}")

    echo ""
    echo -e "${GREEN}Commands:${NC}"
    echo "  Status:  tinyagi status"
    echo "  Logs:    tinyagi logs [$channel_names|queue]"
    echo "  Attach:  tmux attach -t $TMUX_SESSION"
    echo ""

    local ch_list
    ch_list=$(IFS=','; echo "${ACTIVE_CHANNELS[*]}")
    log "Daemon started with $total_panes panes (channels=$ch_list)"
}

# Start queue processor + API server only (--skip-setup mode, no settings yet).
# Creates a proper tmux session so tinyagi stop/restart still work.
_start_server_only() {
    # Ensure TINYAGI_HOME directories exist so the server can write settings
    mkdir -p "$TINYAGI_HOME/logs"
    mkdir -p "$TINYAGI_HOME/files"

    # Create tmux session with a single queue-processor pane
    tmux new-session -d -s "$TMUX_SESSION" -n "tinyagi" -c "$SCRIPT_DIR"

    local win_base
    win_base=$(tmux show-option -gv base-index 2>/dev/null || echo 0)
    local pane_base
    pane_base=$(tmux show-option -gv pane-base-index 2>/dev/null || echo 0)

    sleep 2
    tmux send-keys -t "$TMUX_SESSION:${win_base}.$pane_base" "cd '$SCRIPT_DIR' && node packages/main/dist/index.js" C-m
    tmux select-pane -t "$TMUX_SESSION:${win_base}.$pane_base" -T "Queue"

    echo -e "${GREEN}✓ TinyAGI started (setup mode — no channels)${NC}"
    echo ""
    echo -e "API server: ${BLUE}http://localhost:${TINYAGI_API_PORT:-3777}${NC}"
    echo ""
    echo -e "Complete setup in your browser:"
    echo -e "  ${BLUE}http://localhost:3000/setup${NC}  (TinyOffice)"
    echo -e "  or run: ${BLUE}tinyagi office${NC}"
    echo ""
    echo -e "Once setup is complete, restart to enable channels:"
    echo -e "  ${BLUE}tinyagi restart${NC}"
    echo ""

    log "Started in skip-setup mode (queue + API only, no channels)"
}

# ── Granular service management ───────────────────────────────────────────

# Start a single channel in the running tmux session
start_channel() {
    local channel="$1"
    if [ -z "$channel" ]; then
        echo -e "${RED}Usage: tinyagi channel start <channel_id>${NC}"
        return 1
    fi

    # Validate channel exists
    local valid=false
    for ch in "${ALL_CHANNELS[@]}"; do
        [ "$ch" = "$channel" ] && valid=true
    done
    if [ "$valid" = false ]; then
        echo -e "${RED}Unknown channel: $channel${NC}"
        return 1
    fi

    if ! session_exists; then
        echo -e "${RED}No tmux session running. Start TinyAGI first.${NC}"
        return 1
    fi

    # Check if pane already exists
    local existing
    existing=$(tmux list-panes -t "$TMUX_SESSION" -F '#{pane_title}' 2>/dev/null | grep -x "$(channel_display "$channel")" || true)
    if [ -n "$existing" ]; then
        echo -e "${YELLOW}$(channel_display "$channel") is already running${NC}"
        return 0
    fi

    # Write token to .env if needed
    load_settings 2>/dev/null || true
    local env_var
    env_var="$(channel_token_env "$channel")"
    local token_val
    token_val="$(get_channel_token "$channel")"
    if [ -n "$env_var" ] && [ -n "$token_val" ]; then
        local env_file="$SCRIPT_DIR/.env"
        # Append or update the token line
        if [ -f "$env_file" ] && grep -q "^${env_var}=" "$env_file" 2>/dev/null; then
            sed -i.bak "s|^${env_var}=.*|${env_var}=${token_val}|" "$env_file" && rm -f "${env_file}.bak"
        else
            echo "${env_var}=${token_val}" >> "$env_file"
        fi
    fi

    # Add pane
    tmux split-window -t "$TMUX_SESSION" -c "$SCRIPT_DIR"
    tmux select-layout -t "$TMUX_SESSION" tiled
    sleep 1
    # Find the newest pane (highest id) — that's the one we just created
    local new_pane
    new_pane=$(tmux list-panes -t "$TMUX_SESSION" -F '#{pane_id}' | tail -1)
    tmux send-keys -t "$new_pane" "cd '$SCRIPT_DIR' && node $(channel_script "$channel")" C-m
    tmux select-pane -t "$new_pane" -T "$(channel_display "$channel")"

    echo -e "${GREEN}✓ $(channel_display "$channel") started${NC}"
    log "Channel $channel started (pane $new_pane)"
}

# Stop a single channel in the running tmux session
stop_channel() {
    local channel="$1"
    if [ -z "$channel" ]; then
        echo -e "${RED}Usage: tinyagi channel stop <channel_id>${NC}"
        return 1
    fi

    if ! session_exists; then
        echo -e "${YELLOW}No tmux session running${NC}"
        return 0
    fi

    local display
    display="$(channel_display "$channel")"
    local pane_id
    pane_id=$(tmux list-panes -t "$TMUX_SESSION" -F '#{pane_id} #{pane_title}' 2>/dev/null | grep " ${display}$" | awk '{print $1}' | head -1)

    if [ -n "$pane_id" ]; then
        tmux kill-pane -t "$pane_id" 2>/dev/null || true
        echo -e "${GREEN}✓ $(channel_display "$channel") stopped${NC}"
        log "Channel $channel stopped (pane $pane_id)"
    else
        echo -e "${YELLOW}$(channel_display "$channel") pane not found${NC}"
    fi

    # Kill any remaining process as fallback
    pkill -f "$(channel_script "$channel")" 2>/dev/null || true
}

# Start heartbeat in the running tmux session
start_heartbeat() {
    if ! session_exists; then
        echo -e "${RED}No tmux session running. Start TinyAGI first.${NC}"
        return 1
    fi

    # Check if already running
    local existing
    existing=$(tmux list-panes -t "$TMUX_SESSION" -F '#{pane_title}' 2>/dev/null | grep -x "Heartbeat" || true)
    if [ -n "$existing" ]; then
        echo -e "${YELLOW}Heartbeat is already running${NC}"
        return 0
    fi

    tmux split-window -t "$TMUX_SESSION" -c "$SCRIPT_DIR"
    tmux select-layout -t "$TMUX_SESSION" tiled
    sleep 1
    local new_pane
    new_pane=$(tmux list-panes -t "$TMUX_SESSION" -F '#{pane_id}' | tail -1)
    tmux send-keys -t "$new_pane" "cd '$SCRIPT_DIR' && ./lib/heartbeat-cron.sh" C-m
    tmux select-pane -t "$new_pane" -T "Heartbeat"

    echo -e "${GREEN}✓ Heartbeat started${NC}"
    log "Heartbeat started (pane $new_pane)"
}

# Stop heartbeat in the running tmux session
stop_heartbeat() {
    if ! session_exists; then
        echo -e "${YELLOW}No tmux session running${NC}"
        return 0
    fi

    local pane_id
    pane_id=$(tmux list-panes -t "$TMUX_SESSION" -F '#{pane_id} #{pane_title}' 2>/dev/null | grep " Heartbeat$" | awk '{print $1}' | head -1)

    if [ -n "$pane_id" ]; then
        tmux kill-pane -t "$pane_id" 2>/dev/null || true
        echo -e "${GREEN}✓ Heartbeat stopped${NC}"
        log "Heartbeat stopped (pane $pane_id)"
    else
        echo -e "${YELLOW}Heartbeat pane not found${NC}"
    fi

    pkill -f "heartbeat-cron.sh" 2>/dev/null || true
}

# Stop daemon
stop_daemon() {
    log "Stopping TinyAGI..."

    if session_exists; then
        tmux kill-session -t "$TMUX_SESSION"
    fi

    # Kill any remaining channel processes
    for ch in "${ALL_CHANNELS[@]}"; do
        pkill -f "$(channel_script "$ch")" || true
    done
    pkill -f "packages/main/dist/index.js" || true
    pkill -f "heartbeat-cron.sh" || true

    echo -e "${GREEN}✓ TinyAGI stopped${NC}"
    log "Daemon stopped"
}

# Restart daemon safely even when called from inside TinyAGI's tmux session
restart_daemon() {
    if session_exists && [ -n "${TMUX:-}" ]; then
        local current_session
        current_session=$(tmux display-message -p '#S' 2>/dev/null || true)
        if [ "$current_session" = "$TMUX_SESSION" ]; then
            local bash_bin
            bash_bin=$(command -v bash)
            log "Restart requested from inside tmux session; scheduling detached restart..."
            nohup "$bash_bin" "$SCRIPT_DIR/lib/tinyagi.sh" __delayed_start >/dev/null 2>&1 &
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
    show_banner
    echo -e "${BLUE}TinyAGI Status${NC}"
    echo "==============="
    echo ""

    if session_exists; then
        echo -e "Tmux Session: ${GREEN}Running${NC}"
        echo "  Attach: tmux attach -t $TMUX_SESSION"
    else
        echo -e "Tmux Session: ${RED}Not Running${NC}"
        echo "  Start: tinyagi start"
    fi

    echo ""

    # Channel process status
    local ready_file="$TINYAGI_HOME/channels/whatsapp_ready"

    for ch in "${ALL_CHANNELS[@]}"; do
        local display
        display="$(channel_display "$ch")"
        local script
        script="$(channel_script "$ch")"
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
    if pgrep -f "packages/main/dist/index.js" > /dev/null; then
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
            echo "Recent $(channel_display "$ch") Activity:"
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
        local display
        display="$(channel_display "$ch")"
        local pad=""
        while [ $((${#display} + ${#pad})) -lt 10 ]; do pad="$pad "; done
        echo "  ${display}:${pad}tail -f $LOG_DIR/${ch}.log"
    done
    echo "  Heartbeat: tail -f $LOG_DIR/heartbeat.log"
    echo "  Daemon:    tail -f $LOG_DIR/daemon.log"
}

# --- Agent skills management (called by start_daemon) ---

# Ensure all agent workspaces have .agents/skills synced from SCRIPT_DIR
# and .claude/skills as a symlink to .agents/skills
ensure_agent_skills_links() {
    local skills_src="$SCRIPT_DIR/.agents/skills"
    [ -d "$skills_src" ] || return 0

    local agents_dir="$WORKSPACE_PATH"
    [ -d "$agents_dir" ] || return 0

    local agent_ids
    agent_ids=$(jq -r '(.agents // {}) | keys[]' "$SETTINGS_FILE" 2>/dev/null) || return 0

    for agent_id in $agent_ids; do
        local agent_dir="$agents_dir/$agent_id"
        [ -d "$agent_dir" ] || continue

        # Sync default skills into .agents/skills
        mkdir -p "$agent_dir/.agents/skills"
        for skill_dir in "$skills_src"/*/; do
            [ -d "$skill_dir" ] || continue
            local skill_name
            skill_name="$(basename "$skill_dir")"
            rm -rf "$agent_dir/.agents/skills/$skill_name"
            cp -r "$skill_dir" "$agent_dir/.agents/skills/$skill_name"
        done

        # Ensure .claude/skills is a symlink to ../.agents/skills
        mkdir -p "$agent_dir/.claude"
        if [ -L "$agent_dir/.claude/skills" ]; then
            rm "$agent_dir/.claude/skills"
        elif [ -d "$agent_dir/.claude/skills" ]; then
            rm -rf "$agent_dir/.claude/skills"
        fi
        ln -s ../.agents/skills "$agent_dir/.claude/skills"
    done
}

# --- Log viewing ---

# View logs (uses tail -f, requires terminal)
logs() {
    local target="${1:-}"

    # Check known channels (by id or alias)
    for ch in "${ALL_CHANNELS[@]}"; do
        if [ "$target" = "$ch" ] || [ "$target" = "$(channel_alias "$ch")" ]; then
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
