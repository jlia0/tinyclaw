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
OPENVIKING_ENABLED="false"
OPENVIKING_AUTO_START="false"
OPENVIKING_HOST="127.0.0.1"
OPENVIKING_PORT="8320"
OPENVIKING_BASE_URL="http://127.0.0.1:8320"
OPENVIKING_CONFIG_PATH="$HOME/.openviking/ov.conf"
OPENVIKING_PROJECT=""
OPENVIKING_API_KEY=""
OPENVIKING_NATIVE_SESSION="false"
OPENVIKING_NATIVE_SEARCH="false"
OPENVIKING_PREFETCH="false"
OPENVIKING_AUTOSYNC="true"
OPENVIKING_PREFETCH_TIMEOUT_MS="5000"
OPENVIKING_COMMIT_TIMEOUT_MS="30000"
OPENVIKING_PREFETCH_MAX_CHARS="1200"
OPENVIKING_PREFETCH_MAX_TURNS="4"
OPENVIKING_PREFETCH_MAX_HITS="8"
OPENVIKING_PREFETCH_RESOURCE_SUPPLEMENT_MAX="2"
OPENVIKING_PREFETCH_GATE_MODE="rule"
OPENVIKING_PREFETCH_FORCE_PATTERNS="based on memory,using memory,from your memory,from long term memory,long-term memory,use long term memory,memory only,remember what i told you,what do you remember,what i told you before,based on our previous chats,previously told,according to memory,根据记忆,按记忆,按长期记忆,基于记忆,结合记忆,只根据记忆,只基于记忆,你还记得,你记得我说过,回忆一下,我之前告诉过,我之前提过,我之前说过,之前聊过,根据我们之前的对话,之前说过,长期记忆"
OPENVIKING_PREFETCH_SKIP_PATTERNS="latest news,latest update,breaking news,today weather,live score,current price,price now,stock price,crypto price,search web,web search,search online,browse internet,browse web,run command,run this command,execute this command,execute command,terminal command,shell command,npm run,git ,最新新闻,最新动态,今天天气,当前价格,实时价格,在线搜索,网页搜索,上网查,终端命令,shell命令,执行命令,执行这个命令,跑一下命令,查一下最新,查今日"
OPENVIKING_PREFETCH_RULE_THRESHOLD="3"
OPENVIKING_PREFETCH_LLM_AMBIGUITY_LOW="1"
OPENVIKING_PREFETCH_LLM_AMBIGUITY_HIGH="2"
OPENVIKING_PREFETCH_LLM_TIMEOUT_MS="1500"
OPENVIKING_CLOSED_SESSION_RETENTION_DAYS="0"

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

    # Load OpenViking settings
    OPENVIKING_ENABLED=$(jq -r '.openviking.enabled // false' "$SETTINGS_FILE" 2>/dev/null)
    OPENVIKING_AUTO_START=$(jq -r '.openviking.auto_start // false' "$SETTINGS_FILE" 2>/dev/null)
    OPENVIKING_HOST=$(jq -r '.openviking.host // "127.0.0.1"' "$SETTINGS_FILE" 2>/dev/null)
    OPENVIKING_PORT=$(jq -r '.openviking.port // 8320' "$SETTINGS_FILE" 2>/dev/null)
    OPENVIKING_BASE_URL=$(jq -r '.openviking.base_url // "http://127.0.0.1:8320"' "$SETTINGS_FILE" 2>/dev/null)
    OPENVIKING_CONFIG_PATH=$(jq -r '.openviking.config_path // empty' "$SETTINGS_FILE" 2>/dev/null)
    if [ -z "$OPENVIKING_CONFIG_PATH" ]; then
        OPENVIKING_CONFIG_PATH="$HOME/.openviking/ov.conf"
    fi
    OPENVIKING_PROJECT=$(jq -r '.openviking.project // empty' "$SETTINGS_FILE" 2>/dev/null)
    OPENVIKING_API_KEY=$(jq -r '.openviking.api_key // empty' "$SETTINGS_FILE" 2>/dev/null)
    OPENVIKING_NATIVE_SESSION=$(jq -r '.openviking.native_session // false' "$SETTINGS_FILE" 2>/dev/null)
    OPENVIKING_NATIVE_SEARCH=$(jq -r '.openviking.native_search // false' "$SETTINGS_FILE" 2>/dev/null)
    OPENVIKING_PREFETCH=$(jq -r '.openviking.prefetch // false' "$SETTINGS_FILE" 2>/dev/null)
    OPENVIKING_AUTOSYNC=$(jq -r '.openviking.autosync // true' "$SETTINGS_FILE" 2>/dev/null)
    OPENVIKING_PREFETCH_TIMEOUT_MS=$(jq -r '.openviking.prefetch_timeout_ms // 5000' "$SETTINGS_FILE" 2>/dev/null)
    OPENVIKING_COMMIT_TIMEOUT_MS=$(jq -r '.openviking.commit_timeout_ms // 30000' "$SETTINGS_FILE" 2>/dev/null)
    OPENVIKING_PREFETCH_MAX_CHARS=$(jq -r '.openviking.prefetch_max_chars // 1200' "$SETTINGS_FILE" 2>/dev/null)
    OPENVIKING_PREFETCH_MAX_TURNS=$(jq -r '.openviking.prefetch_max_turns // 4' "$SETTINGS_FILE" 2>/dev/null)
    OPENVIKING_PREFETCH_MAX_HITS=$(jq -r '.openviking.prefetch_max_hits // 8' "$SETTINGS_FILE" 2>/dev/null)
    OPENVIKING_PREFETCH_RESOURCE_SUPPLEMENT_MAX=$(jq -r '.openviking.prefetch_resource_supplement_max // 2' "$SETTINGS_FILE" 2>/dev/null)
    OPENVIKING_PREFETCH_GATE_MODE=$(jq -r '.openviking.prefetch_gate_mode // "rule"' "$SETTINGS_FILE" 2>/dev/null)
    OPENVIKING_PREFETCH_FORCE_PATTERNS=$(jq -r '(.openviking.prefetch_force_patterns // []) | join(",")' "$SETTINGS_FILE" 2>/dev/null)
    OPENVIKING_PREFETCH_SKIP_PATTERNS=$(jq -r '(.openviking.prefetch_skip_patterns // []) | join(",")' "$SETTINGS_FILE" 2>/dev/null)
    OPENVIKING_PREFETCH_RULE_THRESHOLD=$(jq -r '.openviking.prefetch_rule_threshold // 3' "$SETTINGS_FILE" 2>/dev/null)
    OPENVIKING_PREFETCH_LLM_AMBIGUITY_LOW=$(jq -r '.openviking.prefetch_llm_ambiguity_low // 1' "$SETTINGS_FILE" 2>/dev/null)
    OPENVIKING_PREFETCH_LLM_AMBIGUITY_HIGH=$(jq -r '.openviking.prefetch_llm_ambiguity_high // 2' "$SETTINGS_FILE" 2>/dev/null)
    OPENVIKING_PREFETCH_LLM_TIMEOUT_MS=$(jq -r '.openviking.prefetch_llm_timeout_ms // 1500' "$SETTINGS_FILE" 2>/dev/null)
    OPENVIKING_CLOSED_SESSION_RETENTION_DAYS=$(jq -r '.openviking.closed_session_retention_days // 0' "$SETTINGS_FILE" 2>/dev/null)
    if [ -z "$OPENVIKING_PREFETCH_FORCE_PATTERNS" ]; then
        OPENVIKING_PREFETCH_FORCE_PATTERNS="based on memory,using memory,from your memory,from long term memory,long-term memory,use long term memory,memory only,remember what i told you,what do you remember,what i told you before,based on our previous chats,previously told,according to memory,根据记忆,按记忆,按长期记忆,基于记忆,结合记忆,只根据记忆,只基于记忆,你还记得,你记得我说过,回忆一下,我之前告诉过,我之前提过,我之前说过,之前聊过,根据我们之前的对话,之前说过,长期记忆"
    fi
    if [ -z "$OPENVIKING_PREFETCH_SKIP_PATTERNS" ]; then
        OPENVIKING_PREFETCH_SKIP_PATTERNS="latest news,latest update,breaking news,today weather,live score,current price,price now,stock price,crypto price,search web,web search,search online,browse internet,browse web,run command,run this command,execute this command,execute command,terminal command,shell command,npm run,git ,最新新闻,最新动态,今天天气,当前价格,实时价格,在线搜索,网页搜索,上网查,终端命令,shell命令,执行命令,执行这个命令,跑一下命令,查一下最新,查今日"
    fi

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
