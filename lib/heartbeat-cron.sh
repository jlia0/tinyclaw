#!/usr/bin/env bash
# Heartbeat - Periodically prompts all agents via the API server

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TINYAGI_HOME="${TINYAGI_HOME:-$HOME/.tinyagi}"
LOG_FILE="$TINYAGI_HOME/logs/heartbeat.log"
SETTINGS_FILE="$TINYAGI_HOME/settings.json"
API_PORT="${TINYAGI_API_PORT:-3777}"
API_URL="http://localhost:${API_PORT}"
MEMORY_MAINTENANCE_PROMPT_FILE="$PROJECT_ROOT/memory-maintenance-heartbeat.md"
MEMORY_MAINTENANCE_INTERVAL=$((7 * 24 * 60 * 60))
PENDING_MAINTENANCE_TTL=$((24 * 60 * 60))

# Read interval from settings.json, default to 3600
if [ -f "$SETTINGS_FILE" ]; then
    if command -v jq &> /dev/null; then
        INTERVAL=$(jq -r '.monitoring.heartbeat_interval // empty' "$SETTINGS_FILE" 2>/dev/null)
    fi
fi
INTERVAL=${INTERVAL:-3600}

declare -A LAST_SENT
declare -A PENDING_MAINTENANCE_DIR
declare -A PENDING_MAINTENANCE_BY_AGENT
declare -A PENDING_MAINTENANCE_AGENT
declare -A PENDING_MAINTENANCE_STARTED

get_override_enabled() {
    local agent_id="$1"
    if [ -f "$SETTINGS_FILE" ] && command -v jq &> /dev/null; then
        jq -r "(.agents // {}).\"${agent_id}\".heartbeat.enabled // empty" "$SETTINGS_FILE" 2>/dev/null
    fi
}

get_override_interval() {
    local agent_id="$1"
    if [ -f "$SETTINGS_FILE" ] && command -v jq &> /dev/null; then
        jq -r "(.agents // {}).\"${agent_id}\".heartbeat.interval // empty" "$SETTINGS_FILE" 2>/dev/null
    fi
}

get_min_override_interval() {
    if [ -f "$SETTINGS_FILE" ] && command -v jq &> /dev/null; then
        jq -r '(.agents // {} | to_entries | map(.value.heartbeat.interval) | map(select(type=="number" and . > 0)) | min) // empty' "$SETTINGS_FILE" 2>/dev/null
    fi
}

mkdir -p "$(dirname "$LOG_FILE")"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

needs_memory_maintenance() {
    local agent_dir="$1"
    local now="$2"
    local stamp_file="$agent_dir/.tinyclaw/last-memory-maintenance"

    if [ ! -f "$stamp_file" ]; then
        return 0
    fi

    local last_run
    last_run=$(tr -cd '0-9' < "$stamp_file")
    if [ -z "$last_run" ]; then
        return 0
    fi

    if [ $((now - last_run)) -ge "$MEMORY_MAINTENANCE_INTERVAL" ]; then
        return 0
    fi

    return 1
}

mark_memory_maintenance_completed() {
    local agent_dir="$1"
    local now="$2"
    mkdir -p "$agent_dir/.tinyclaw"
    printf '%s\n' "$now" > "$agent_dir/.tinyclaw/last-memory-maintenance"
}

get_memory_maintenance_prompt() {
    if [ -f "$MEMORY_MAINTENANCE_PROMPT_FILE" ]; then
        cat "$MEMORY_MAINTENANCE_PROMPT_FILE"
        return
    fi

    return 1
}

clear_pending_maintenance() {
    local message_id="$1"
    local agent_id="$2"

    unset "PENDING_MAINTENANCE_DIR[$message_id]"
    unset "PENDING_MAINTENANCE_AGENT[$message_id]"
    unset "PENDING_MAINTENANCE_STARTED[$message_id]"

    if [ -n "$agent_id" ]; then
        unset "PENDING_MAINTENANCE_BY_AGENT[$agent_id]"
    fi
}

cleanup_stale_pending_maintenance() {
    local now="$1"

    for message_id in "${!PENDING_MAINTENANCE_STARTED[@]}"; do
        local started_at="${PENDING_MAINTENANCE_STARTED[$message_id]}"
        if [ -z "$started_at" ]; then
            continue
        fi

        if [ $((now - started_at)) -lt "$PENDING_MAINTENANCE_TTL" ]; then
            continue
        fi

        local agent_id="${PENDING_MAINTENANCE_AGENT[$message_id]}"
        clear_pending_maintenance "$message_id" "$agent_id"
        if [ -n "$agent_id" ]; then
            log "  → Agent @$agent_id: stale pending memory maintenance expired"
        else
            log "  → Cleared stale pending memory maintenance for message $message_id"
        fi
    done
}

MIN_OVERRIDE_INTERVAL=$(get_min_override_interval)
BASE_INTERVAL="$INTERVAL"
if [ -n "$MIN_OVERRIDE_INTERVAL" ]; then
    if [ "$MIN_OVERRIDE_INTERVAL" -lt "$BASE_INTERVAL" ]; then
        BASE_INTERVAL="$MIN_OVERRIDE_INTERVAL"
    fi
fi
if [ "$BASE_INTERVAL" -lt 10 ]; then
    BASE_INTERVAL=10
fi

log "Heartbeat started (base interval: ${BASE_INTERVAL}s, default interval: ${INTERVAL}s, API: ${API_URL})"

while true; do
    sleep "$BASE_INTERVAL"

    log "Heartbeat check - scanning all agents..."

    # Get all agents from settings
    if [ ! -f "$SETTINGS_FILE" ]; then
        log "WARNING: No settings file found, skipping heartbeat"
        continue
    fi

    # Get workspace path
    WORKSPACE_PATH=$(jq -r '.workspace.path // empty' "$SETTINGS_FILE" 2>/dev/null)
    if [ -z "$WORKSPACE_PATH" ]; then
        WORKSPACE_PATH="$HOME/tinyagi-workspace"
    fi

    # Get all agent IDs
    AGENT_IDS=$(jq -r '(.agents // {}) | keys[]' "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$AGENT_IDS" ]; then
        log "No agents configured - using default agent"
        AGENT_IDS="default"
    fi

    AGENT_COUNT=0

    NOW=$(date +%s)
    cleanup_stale_pending_maintenance "$NOW"

    # Send heartbeat to each agent
    for AGENT_ID in $AGENT_IDS; do
        AGENT_COUNT=$((AGENT_COUNT + 1))

        OVERRIDE_ENABLED=$(get_override_enabled "$AGENT_ID")
        if [ "$OVERRIDE_ENABLED" = "false" ]; then
            log "  → Agent @$AGENT_ID: heartbeat disabled (override)"
            continue
        fi

        AGENT_INTERVAL=$(get_override_interval "$AGENT_ID")
        if [ -z "$AGENT_INTERVAL" ]; then
            AGENT_INTERVAL="$INTERVAL"
        fi

        LAST_SENT_AT=${LAST_SENT["$AGENT_ID"]}
        if [ -n "$LAST_SENT_AT" ]; then
            ELAPSED=$((NOW - LAST_SENT_AT))
            if [ "$ELAPSED" -lt "$AGENT_INTERVAL" ]; then
                continue
            fi
        fi

        # Get agent's working directory
        AGENT_DIR=$(jq -r "(.agents // {}).\"${AGENT_ID}\".working_directory // empty" "$SETTINGS_FILE" 2>/dev/null)
        if [ -z "$AGENT_DIR" ]; then
            AGENT_DIR="$WORKSPACE_PATH/$AGENT_ID"
        fi

        # Read agent-specific heartbeat.md
        HEARTBEAT_FILE="$AGENT_DIR/heartbeat.md"
        if [ -f "$HEARTBEAT_FILE" ]; then
            PROMPT=$(cat "$HEARTBEAT_FILE")
            log "  → Agent @$AGENT_ID: using custom heartbeat.md"
        else
            PROMPT="Quick status check: Any pending tasks? Keep response brief."
            log "  → Agent @$AGENT_ID: using default prompt"
        fi

        SHOULD_RUN_MEMORY_MAINTENANCE=0
        if [ -n "${PENDING_MAINTENANCE_BY_AGENT["$AGENT_ID"]}" ]; then
            log "  → Agent @$AGENT_ID: memory maintenance already pending"
        elif needs_memory_maintenance "$AGENT_DIR" "$NOW"; then
            if MEMORY_MAINTENANCE_PROMPT=$(get_memory_maintenance_prompt); then
                SHOULD_RUN_MEMORY_MAINTENANCE=1
                PROMPT="${MEMORY_MAINTENANCE_PROMPT}

${PROMPT}"
                log "  → Agent @$AGENT_ID: memory maintenance due"
            else
                log "  → Agent @$AGENT_ID: memory maintenance prompt file missing, skipping"
            fi
        fi

        # Enqueue via API server
        RESPONSE=$(curl -s -X POST "${API_URL}/api/message" \
            -H "Content-Type: application/json" \
            -d "$(jq -n \
                --arg message "$PROMPT" \
                --arg agent "$AGENT_ID" \
                --arg channel "heartbeat" \
                --arg sender "System" \
                '{message: $message, agent: $agent, channel: $channel, sender: $sender}'
            )" 2>&1)

        if echo "$RESPONSE" | jq -e '.ok' &>/dev/null; then
            MESSAGE_ID=$(echo "$RESPONSE" | jq -r '.messageId')
            log "  ✓ Queued for @$AGENT_ID: $MESSAGE_ID"
            LAST_SENT["$AGENT_ID"]="$NOW"
            if [ "$SHOULD_RUN_MEMORY_MAINTENANCE" -eq 1 ]; then
                PENDING_MAINTENANCE_DIR["$MESSAGE_ID"]="$AGENT_DIR"
                PENDING_MAINTENANCE_BY_AGENT["$AGENT_ID"]="$MESSAGE_ID"
                PENDING_MAINTENANCE_AGENT["$MESSAGE_ID"]="$AGENT_ID"
                PENDING_MAINTENANCE_STARTED["$MESSAGE_ID"]="$NOW"
            fi
        else
            log "  ✗ Failed to queue for @$AGENT_ID: $RESPONSE"
        fi
    done

    log "Heartbeat sent to $AGENT_COUNT agent(s)"

    # Optional: wait and log responses
    sleep 10

    # Check recent responses for heartbeat messages
    RESPONSES=$(curl -s "${API_URL}/api/responses?limit=20" 2>&1)
    if echo "$RESPONSES" | jq -e '.' &>/dev/null; then
        for MESSAGE_ID in "${!PENDING_MAINTENANCE_DIR[@]}"; do
            if echo "$RESPONSES" | jq -e --arg mid "$MESSAGE_ID" '.[] | select(.channel == "heartbeat" and .messageId == $mid)' >/dev/null 2>&1; then
                AGENT_DIR="${PENDING_MAINTENANCE_DIR["$MESSAGE_ID"]}"
                AGENT_ID="${PENDING_MAINTENANCE_AGENT["$MESSAGE_ID"]}"
                mark_memory_maintenance_completed "$AGENT_DIR" "$(date +%s)"
                clear_pending_maintenance "$MESSAGE_ID" "$AGENT_ID"
                if [ -n "$AGENT_ID" ]; then
                    log "  ↺ @$AGENT_ID: memory maintenance completed"
                fi
            fi
        done

        for AGENT_ID in $AGENT_IDS; do
            RESP=$(echo "$RESPONSES" | jq -r \
                --arg ch "heartbeat" \
                '.[] | select(.channel == $ch) | .message' 2>/dev/null | head -1)
            if [ -n "$RESP" ]; then
                log "  ← @$AGENT_ID: ${RESP:0:80}..."
            fi
        done
    fi
done
