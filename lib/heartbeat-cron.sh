#!/usr/bin/env bash
# Heartbeat - Periodically prompts all agents via the API server

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TINYAGI_HOME="${TINYAGI_HOME:-$HOME/.tinyagi}"
LOG_FILE="$TINYAGI_HOME/logs/heartbeat.log"
SETTINGS_FILE="$TINYAGI_HOME/settings.json"
API_PORT="${TINYAGI_API_PORT:-3777}"
API_URL="http://localhost:${API_PORT}"

# Read interval from settings.json, default to 3600
if [ -f "$SETTINGS_FILE" ]; then
    if command -v jq &> /dev/null; then
        INTERVAL=$(jq -r '.monitoring.heartbeat_interval // empty' "$SETTINGS_FILE" 2>/dev/null)
    fi
fi
INTERVAL=${INTERVAL:-3600}

declare -A LAST_SENT

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
