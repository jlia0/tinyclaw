#!/usr/bin/env bash
# Heartbeat - Periodically prompts all teams via queue system

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$PROJECT_ROOT/.tinyclaw/logs/heartbeat.log"
QUEUE_INCOMING="$PROJECT_ROOT/.tinyclaw/queue/incoming"
QUEUE_OUTGOING="$PROJECT_ROOT/.tinyclaw/queue/outgoing"
SETTINGS_FILE="$PROJECT_ROOT/.tinyclaw/settings.json"

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

    log "Heartbeat check - scanning all teams..."

    # Get all teams from settings
    if [ ! -f "$SETTINGS_FILE" ]; then
        log "WARNING: No settings file found, skipping heartbeat"
        continue
    fi

    # Get workspace path
    WORKSPACE_PATH=$(jq -r '.workspace.path // empty' "$SETTINGS_FILE" 2>/dev/null)
    if [ -z "$WORKSPACE_PATH" ]; then
        WORKSPACE_PATH="$HOME/tinyclaw-workspace"
    fi

    # Get all team IDs
    TEAM_IDS=$(jq -r '.teams // {} | keys[]' "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$TEAM_IDS" ]; then
        log "No teams configured - using default team"
        TEAM_IDS="default"
    fi

    TEAM_COUNT=0

    # Send heartbeat to each team
    for TEAM_ID in $TEAM_IDS; do
        TEAM_COUNT=$((TEAM_COUNT + 1))

        # Get team's working directory
        TEAM_DIR=$(jq -r ".teams.\"${TEAM_ID}\".working_directory // empty" "$SETTINGS_FILE" 2>/dev/null)
        if [ -z "$TEAM_DIR" ]; then
            TEAM_DIR="$WORKSPACE_PATH/$TEAM_ID"
        fi

        # Read team-specific heartbeat.md
        HEARTBEAT_FILE="$TEAM_DIR/heartbeat.md"
        if [ -f "$HEARTBEAT_FILE" ]; then
            PROMPT=$(cat "$HEARTBEAT_FILE")
            log "  → Team @$TEAM_ID: using custom heartbeat.md"
        else
            PROMPT="Quick status check: Any pending tasks? Keep response brief."
            log "  → Team @$TEAM_ID: using default prompt"
        fi

        # Generate unique message ID
        MESSAGE_ID="heartbeat_${TEAM_ID}_$(date +%s)_$$"

        # Write to queue with @team_id routing prefix
        cat > "$QUEUE_INCOMING/${MESSAGE_ID}.json" << EOF
{
  "channel": "heartbeat",
  "sender": "System",
  "senderId": "heartbeat_${TEAM_ID}",
  "message": "@${TEAM_ID} ${PROMPT}",
  "timestamp": $(date +%s)000,
  "messageId": "$MESSAGE_ID"
}
EOF

        log "  ✓ Queued for @$TEAM_ID: $MESSAGE_ID"
    done

    log "Heartbeat sent to $TEAM_COUNT team(s)"

    # Optional: wait and log responses
    sleep 10

    # Check for responses and log brief summaries
    for TEAM_ID in $TEAM_IDS; do
        MESSAGE_ID="heartbeat_${TEAM_ID}_"

        # Find response files for this team's heartbeat
        for RESPONSE_FILE in "$QUEUE_OUTGOING"/${MESSAGE_ID}*.json; do
            if [ -f "$RESPONSE_FILE" ]; then
                RESPONSE=$(cat "$RESPONSE_FILE" | jq -r '.message' 2>/dev/null || echo "")
                if [ -n "$RESPONSE" ]; then
                    log "  ← @$TEAM_ID: ${RESPONSE:0:80}..."
                    # Clean up response file
                    rm "$RESPONSE_FILE"
                fi
            fi
        done
    done
done
