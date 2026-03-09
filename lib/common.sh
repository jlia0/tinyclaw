#!/usr/bin/env bash
# Common utilities and configuration for TinyClaw
# Sourced by main tinyclaw.sh script
# Compatible with bash 3.2+ (no associative arrays)

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# --- Channel registry ---
# Source of truth is channels/*.json manifests.

CHANNELS_DIR="$SCRIPT_DIR/channels"
ALL_CHANNELS=()

_channel_manifest_path() {
    local channel_id="$1"
    local manifest="$CHANNELS_DIR/${channel_id}.json"
    local file

    if [ -f "$manifest" ]; then
        echo "$manifest"
        return
    fi

    for file in "$CHANNELS_DIR"/*.json; do
        [ -f "$file" ] || continue
        if [ "$(jq -r '.id // empty' "$file" 2>/dev/null)" = "$channel_id" ]; then
            echo "$file"
            return
        fi
    done
}

_channel_manifest_value() {
    local channel_id="$1"
    local query="$2"
    local manifest
    manifest="$(_channel_manifest_path "$channel_id")"
    if [ -z "$manifest" ]; then
        return
    fi
    jq -r "${query} // empty" "$manifest" 2>/dev/null
}

channel_display() {
    _channel_manifest_value "$1" '.display_name'
}

channel_script() {
    _channel_manifest_value "$1" '.script'
}

channel_alias() {
    _channel_manifest_value "$1" '.alias'
}

channel_token_key() {
    _channel_manifest_value "$1" '.token.settings_key'
}

channel_token_env() {
    _channel_manifest_value "$1" '.token.env_var'
}

channel_token_prompt() {
    _channel_manifest_value "$1" '.token.prompt'
}

channel_token_help() {
    _channel_manifest_value "$1" '.token.help'
}

load_channel_registry() {
    ALL_CHANNELS=()

    if [ ! -d "$CHANNELS_DIR" ]; then
        echo -e "${RED}Channel registry not found: ${CHANNELS_DIR}${NC}"
        return 1
    fi

    if ! command -v jq &> /dev/null; then
        echo -e "${RED}Error: jq is required for channel registry parsing${NC}"
        echo "Install with: brew install jq (macOS) or apt-get install jq (Linux)"
        return 1
    fi

    local file
    while IFS= read -r file; do
        local id
        id=$(jq -r '.id // empty' "$file" 2>/dev/null)
        if [ -z "$id" ] || [ "$id" = "null" ]; then
            echo -e "${YELLOW}Skipping invalid channel manifest (missing id): ${file}${NC}"
            continue
        fi
        ALL_CHANNELS+=("$id")
    done < <(find "$CHANNELS_DIR" -maxdepth 1 -type f -name '*.json' | sort)

    if [ ${#ALL_CHANNELS[@]} -eq 0 ]; then
        echo -e "${RED}Channel registry loaded zero channels from ${CHANNELS_DIR}${NC}"
        return 1
    fi

    return 0
}

# Runtime state: filled by load_settings
ACTIVE_CHANNELS=()
WORKSPACE_PATH=""

# Per-channel token storage (parallel array, bash 3.2 compatible)
_CHANNEL_TOKEN_KEYS=()
_CHANNEL_TOKEN_VALS=()

_set_channel_token() {
    local ch="$1" val="$2"
    local i
    for i in "${!_CHANNEL_TOKEN_KEYS[@]}"; do
        if [ "${_CHANNEL_TOKEN_KEYS[$i]}" = "$ch" ]; then
            _CHANNEL_TOKEN_VALS[$i]="$val"
            return
        fi
    done
    _CHANNEL_TOKEN_KEYS+=("$ch")
    _CHANNEL_TOKEN_VALS+=("$val")
}

get_channel_token() {
    local ch="$1"
    local i
    for i in "${!_CHANNEL_TOKEN_KEYS[@]}"; do
        if [ "${_CHANNEL_TOKEN_KEYS[$i]}" = "$ch" ]; then
            echo "${_CHANNEL_TOKEN_VALS[$i]}"
            return
        fi
    done
}

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_DIR/daemon.log"
}

# Load settings from JSON
# Returns: 0 = success, 1 = file not found / no config, 2 = invalid JSON
load_settings() {
    if [ ! -f "$SETTINGS_FILE" ]; then
        return 1
    fi

    if ! command -v jq &> /dev/null; then
        echo -e "${RED}Error: jq is required for parsing settings${NC}"
        echo "Install with: brew install jq (macOS) or apt-get install jq (Linux)"
        return 1
    fi

    if ! jq empty "$SETTINGS_FILE" 2>/dev/null; then
        return 2
    fi

    WORKSPACE_PATH=$(jq -r '.workspace.path // empty' "$SETTINGS_FILE" 2>/dev/null)
    if [ -z "$WORKSPACE_PATH" ]; then
        WORKSPACE_PATH="$HOME/tinyclaw-workspace"
    fi

    local channels_json
    channels_json=$(jq -r '.channels.enabled[]' "$SETTINGS_FILE" 2>/dev/null)
    if [ -z "$channels_json" ]; then
        return 1
    fi

    ACTIVE_CHANNELS=()
    while IFS= read -r ch; do
        ACTIVE_CHANNELS+=("$ch")
    done <<< "$channels_json"

    _CHANNEL_TOKEN_KEYS=()
    _CHANNEL_TOKEN_VALS=()
    for ch in "${ALL_CHANNELS[@]}"; do
        local token_key
        token_key="$(channel_token_key "$ch")"
        if [ -n "$token_key" ]; then
            local token_val
            token_val=$(jq -r ".channels.${ch}.${token_key} // empty" "$SETTINGS_FILE" 2>/dev/null)
            _set_channel_token "$ch" "$token_val"
        fi
    done

    return 0
}

# Check if a channel is active (enabled in settings)
is_active() {
    local channel="$1"
    local ch
    for ch in "${ACTIVE_CHANNELS[@]}"; do
        if [ "$ch" = "$channel" ]; then
            return 0
        fi
    done
    return 1
}

# Check if tmux session exists
session_exists() {
    tmux has-session -t "$TMUX_SESSION" 2>/dev/null
}
