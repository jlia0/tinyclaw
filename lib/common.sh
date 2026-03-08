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
        discord)  echo "dist/channels/discord-client.js" ;;
        whatsapp) echo "dist/channels/whatsapp-client.js" ;;
        telegram) echo "dist/channels/telegram-client.js" ;;
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

# Structured log helpers
rotate_log_file() {
    local file="$1"
    local max_bytes=$((10 * 1024 * 1024))
    local max_files=5

    [ -f "$file" ] || return 0

    local size
    size=$(wc -c < "$file" | tr -d ' ')
    if [ "$size" -lt "$max_bytes" ]; then
        return 0
    fi

    local ext="${file##*.}"
    local base="${file%.*}"
    local i
    for ((i=max_files; i>=1; i--)); do
        local current="${base}.${i}.${ext}"
        local previous
        if [ "$i" -eq 1 ]; then
            previous="$file"
        else
            previous="${base}.$((i-1)).${ext}"
        fi

        [ -f "$previous" ] || continue
        [ ! -f "$current" ] || rm -f "$current"
        mv "$previous" "$current"
    done
}

write_structured_log() {
    local source="$1"
    local component="$2"
    local level="$3"
    shift 3

    local msg="$*"
    local file="$LOG_DIR/${source}.log"
    local timestamp
    timestamp=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

    mkdir -p "$LOG_DIR"
    rotate_log_file "$file"

    if command -v jq >/dev/null 2>&1; then
        jq -nc \
            --arg time "$timestamp" \
            --arg level "$level" \
            --arg source "$source" \
            --arg component "$component" \
            --arg msg "$msg" \
            '{time:$time,level:$level,source:$source,component:$component,msg:$msg}' >> "$file"
    else
        node -e 'const [time, level, source, component, msg] = process.argv.slice(1); console.log(JSON.stringify({ time, level, source, component, msg }));' \
            "$timestamp" "$level" "$source" "$component" "$msg" >> "$file"
    fi
}

normalize_log_level() {
    local raw
    raw=$(printf '%s' "${1:-info}" | tr '[:upper:]' '[:lower:]')
    case "$raw" in
        trace|verbose) echo "debug" ;;
        debug) echo "debug" ;;
        info|"") echo "info" ;;
        warn|warning) echo "warn" ;;
        error|err|fatal) echo "error" ;;
        *) echo "info" ;;
    esac
}

log_level_priority() {
    case "$(normalize_log_level "$1")" in
        debug) echo 0 ;;
        info) echo 1 ;;
        warn) echo 2 ;;
        error) echo 3 ;;
        *) echo 1 ;;
    esac
}

log() {
    local candidate_level="${1:-}"
    local level="info"
    local threshold
    local msg

    case "$(normalize_log_level "$candidate_level")" in
        debug|info|warn|error)
            if [ "$candidate_level" = "$(normalize_log_level "$candidate_level")" ] || \
               [ "$candidate_level" = "DEBUG" ] || [ "$candidate_level" = "INFO" ] || \
               [ "$candidate_level" = "WARN" ] || [ "$candidate_level" = "WARNING" ] || \
               [ "$candidate_level" = "ERROR" ] || [ "$candidate_level" = "verbose" ] || \
               [ "$candidate_level" = "VERBOSE" ] || [ "$candidate_level" = "trace" ] || \
               [ "$candidate_level" = "TRACE" ] || [ "$candidate_level" = "fatal" ] || \
               [ "$candidate_level" = "FATAL" ] || [ "$candidate_level" = "err" ] || \
               [ "$candidate_level" = "ERR" ]; then
                level="$(normalize_log_level "$candidate_level")"
                shift
            fi
            ;;
    esac

    msg="$*"
    [ -n "$msg" ] || return 0

    threshold="$(normalize_log_level "${LOG_LEVEL:-info}")"
    if [ "$(log_level_priority "$level")" -lt "$(log_level_priority "$threshold")" ]; then
        return 0
    fi

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $msg"
    write_structured_log "daemon" "daemon" "$level" "$msg"
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
        WORKSPACE_PATH="$HOME/tinyclaw-workspace"
    fi

    # Read enabled channels array
    local channels_json
    channels_json=$(jq -r '.channels.enabled[]' "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$channels_json" ]; then
        return 1
    fi

    # Parse into array
    ACTIVE_CHANNELS=()
    while IFS= read -r ch; do
        ACTIVE_CHANNELS+=("$ch")
    done <<< "$channels_json"

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
