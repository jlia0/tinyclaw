#!/usr/bin/env bash
# Heartbeat - Periodically prompts all agents via queue system

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [ -z "$TINYCLAW_HOME" ]; then
    if [ -f "$PROJECT_ROOT/.tinyclaw/settings.json" ]; then
        TINYCLAW_HOME="$PROJECT_ROOT/.tinyclaw"
    else
        TINYCLAW_HOME="$HOME/.tinyclaw"
    fi
fi
LOG_FILE="$TINYCLAW_HOME/logs/heartbeat.log"
QUEUE_INCOMING="$TINYCLAW_HOME/queue/incoming"
QUEUE_OUTGOING="$TINYCLAW_HOME/queue/outgoing"
SETTINGS_FILE="$TINYCLAW_HOME/settings.json"

# Read interval from settings.json, default to 3600
if [ -f "$SETTINGS_FILE" ]; then
    if command -v jq &> /dev/null; then
        INTERVAL=$(jq -r '.monitoring.heartbeat_interval // empty' "$SETTINGS_FILE" 2>/dev/null)
    fi
fi
INTERVAL=${INTERVAL:-3600}

mkdir -p "$(dirname "$LOG_FILE")" "$QUEUE_INCOMING" "$QUEUE_OUTGOING"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log "Heartbeat started (interval: ${INTERVAL}s)"

while true; do
    sleep "$INTERVAL"

    log "Heartbeat check - scanning all agents..."

    # Get all agents from settings
    if [ ! -f "$SETTINGS_FILE" ]; then
        log "WARNING: No settings file found, skipping heartbeat"
        continue
    fi

    # Get workspace path
    WORKSPACE_PATH=$(jq -r '.workspace.path // empty' "$SETTINGS_FILE" 2>/dev/null)
    if [ -z "$WORKSPACE_PATH" ]; then
        WORKSPACE_PATH="$HOME/tinyclaw-workspace"
    fi

    # Get all agent IDs
    AGENT_IDS=$(jq -r '(.agents // {}) | keys[]' "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$AGENT_IDS" ]; then
        log "No agents configured - using default agent"
        AGENT_IDS="default"
    fi

    AGENT_COUNT=0

    # Send heartbeat to each agent
    for AGENT_ID in $AGENT_IDS; do
        AGENT_COUNT=$((AGENT_COUNT + 1))

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

        # Generate unique message ID
        MESSAGE_ID="heartbeat_${AGENT_ID}_$(date +%s)_$$"

        # Write to queue with @agent_id routing prefix
        cat > "$QUEUE_INCOMING/${MESSAGE_ID}.json" << EOF
{
  "channel": "heartbeat",
  "sender": "System",
  "senderId": "heartbeat_${AGENT_ID}",
  "message": "@${AGENT_ID} ${PROMPT}",
  "timestamp": $(date +%s)000,
  "messageId": "$MESSAGE_ID"
}
EOF

        log "  ✓ Queued for @$AGENT_ID: $MESSAGE_ID"
    done

    log "Heartbeat sent to $AGENT_COUNT agent(s)"

    # Optional: wait and log responses
    sleep 10

    # Check for responses and log brief summaries
    for AGENT_ID in $AGENT_IDS; do
        MESSAGE_ID="heartbeat_${AGENT_ID}_"

        # Find response files for this agent's heartbeat
        for RESPONSE_FILE in "$QUEUE_OUTGOING"/${MESSAGE_ID}*.json; do
            if [ -f "$RESPONSE_FILE" ]; then
                RESPONSE=$(cat "$RESPONSE_FILE" | jq -r '.message' 2>/dev/null || echo "")
                if [ -n "$RESPONSE" ]; then
                    log "  ← @$AGENT_ID: ${RESPONSE:0:80}..."
                    # Clean up response file
                    rm "$RESPONSE_FILE"
                fi
            fi
        done
    done
done
