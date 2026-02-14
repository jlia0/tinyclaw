#!/usr/bin/env bash
# Common utilities and configuration for TinyClaw
# Sourced by main tinyclaw.sh script

# Check bash version (need 4.0+ for associative arrays)
if [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
    echo "Error: This script requires bash 4.0 or higher (you have ${BASH_VERSION})"
    echo ""
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macOS ships with bash 3.2. Install a newer version:"
        echo "  brew install bash"
        echo ""
        echo "Then either:"
        echo "  1. Run with: /opt/homebrew/bin/bash $0"
        echo "  2. Add to your PATH: export PATH=\"/opt/homebrew/bin:\$PATH\""
    else
        echo "Install bash 4.0+ using your package manager:"
        echo "  Ubuntu/Debian: sudo apt-get install bash"
        echo "  CentOS/RHEL: sudo yum install bash"
    fi
    exit 1
fi

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# --- Channel registry ---
# Single source of truth. Add new channels here and everything else adapts.

ALL_CHANNELS=(discord whatsapp telegram)

declare -A CHANNEL_DISPLAY=(
    [discord]="Discord"
    [whatsapp]="WhatsApp"
    [telegram]="Telegram"
)
declare -A CHANNEL_SCRIPT=(
    [discord]="dist/channels/discord-client.js"
    [whatsapp]="dist/channels/whatsapp-client.js"
    [telegram]="dist/channels/telegram-client.js"
)
declare -A CHANNEL_ALIAS=(
    [discord]="dc"
    [whatsapp]="wa"
    [telegram]="tg"
)
declare -A CHANNEL_TOKEN_KEY=(
    [discord]="discord_bot_token"
    [telegram]="telegram_bot_token"
)
declare -A CHANNEL_TOKEN_ENV=(
    [discord]="DISCORD_BOT_TOKEN"
    [telegram]="TELEGRAM_BOT_TOKEN"
)

# Runtime state: filled by load_settings
ACTIVE_CHANNELS=()
declare -A CHANNEL_TOKENS=()
WORKSPACE_PATH=""

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_DIR/daemon.log"
}

# Attempt to auto-fix common JSON issues in settings file
# Uses Node.js (already a project dependency) for robust fixing
fix_settings_json() {
    # Create a backup first
    cp "$SETTINGS_FILE" "${SETTINGS_FILE}.bak"
    echo -e "  Backup saved to ${SETTINGS_FILE}.bak"

    # Use Node.js to attempt common JSON fixes
    local fixed
    local fix_rc
    fixed=$(node -e '
const fs = require("fs");
try {
    let c = fs.readFileSync(process.argv[1], "utf8");
    // Strip BOM
    c = c.replace(/^\uFEFF/, "");
    // Strip single-line comments (// ...) but not inside strings
    c = c.replace(/("(?:[^"\\]|\\.)*")|\/\/.*$/gm, function(m, g) { return g || ""; });
    // Strip multi-line comments
    c = c.replace(/\/\*[\s\S]*?\*\//g, "");
    // Remove trailing commas before } or ]
    c = c.replace(/,(\s*[}\]])/g, "$1");
    // Trim whitespace
    c = c.trim();
    if (!c) { process.exit(1); }
    const parsed = JSON.parse(c);
    process.stdout.write(JSON.stringify(parsed, null, 2) + "\n");
} catch(e) {
    process.stderr.write(e.message + "\n");
    process.exit(1);
}
' "$SETTINGS_FILE" 2>/dev/null)
    fix_rc=$?

    if [ $fix_rc -eq 0 ] && [ -n "$fixed" ]; then
        echo "$fixed" > "$SETTINGS_FILE"
        return 0
    fi

    return 1
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
        local token_key="${CHANNEL_TOKEN_KEY[$ch]:-}"
        if [ -n "$token_key" ]; then
            CHANNEL_TOKENS[$ch]=$(jq -r ".channels.${ch}.bot_token // empty" "$SETTINGS_FILE" 2>/dev/null)
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
