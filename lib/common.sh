#!/usr/bin/env bash
# Common utilities and configuration for TinyAGI
# Sourced by main tinyagi.sh script
# Compatible with bash 3.2+ (no associative arrays)

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# --- ASCII Banner ---
show_banner() {
    echo '  ▀█▀ █ █▄ █ █▄█ █▀█ █▀▀ █'
    echo '   █  █ █ ▀█  █  █▀█ █▄█ █'
    echo ""
}

# --- Channel registry ---
# Single source of truth. Add new channels here and everything else adapts.

ALL_CHANNELS=(discord whatsapp telegram)

# Channel lookup functions (bash 3.2 compatible, no associative arrays)
channel_display() {
    case "$1" in
        discord)  echo "Discord" ;;
        whatsapp) echo "WhatsApp" ;;
        telegram) echo "Telegram" ;;
    esac
}

channel_script() {
    case "$1" in
        discord)  echo "packages/channels/dist/discord.js" ;;
        whatsapp) echo "packages/channels/dist/whatsapp.js" ;;
        telegram) echo "packages/channels/dist/telegram.js" ;;
    esac
}

channel_alias() {
    case "$1" in
        discord)  echo "dc" ;;
        whatsapp) echo "wa" ;;
        telegram) echo "tg" ;;
    esac
}

channel_token_key() {
    case "$1" in
        discord)  echo "discord_bot_token" ;;
        telegram) echo "telegram_bot_token" ;;
    esac
}

channel_token_env() {
    case "$1" in
        discord)  echo "DISCORD_BOT_TOKEN" ;;
        telegram) echo "TELEGRAM_BOT_TOKEN" ;;
    esac
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

    # Check if jq is available for JSON parsing
    if ! command -v jq &> /dev/null; then
        echo -e "${RED}Error: jq is required for parsing settings${NC}"
        echo "Install with: brew install jq (macOS) or apt-get install jq (Linux)"
        return 1
    fi

    # Validate JSON syntax before attempting to parse
    if ! jq empty "$SETTINGS_FILE" 2>/dev/null; then
        return 2
    fi

    # Load workspace path
    WORKSPACE_PATH=$(jq -r '.workspace.path // empty' "$SETTINGS_FILE" 2>/dev/null)
    if [ -z "$WORKSPACE_PATH" ]; then
        # Fallback for old configs without workspace
        WORKSPACE_PATH="$HOME/tinyagi-workspace"
    fi

    # Read enabled channels array (empty is OK — channels are optional)
    local channels_json
    channels_json=$(jq -r '.channels.enabled[]' "$SETTINGS_FILE" 2>/dev/null)

    ACTIVE_CHANNELS=()
    if [ -n "$channels_json" ]; then
        while IFS= read -r ch; do
            ACTIVE_CHANNELS+=("$ch")
        done <<< "$channels_json"
    fi

    # Load tokens for each channel from nested structure
    for ch in "${ALL_CHANNELS[@]}"; do
        local token_key
        token_key="$(channel_token_key "$ch")"
        if [ -n "$token_key" ]; then
            local token_val
            token_val=$(jq -r ".channels.${ch}.bot_token // empty" "$SETTINGS_FILE" 2>/dev/null)
            _set_channel_token "$ch" "$token_val"
        fi
    done

    return 0
}

# Check if a channel is active (enabled in settings)
is_active() {
    local channel="$1"
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
