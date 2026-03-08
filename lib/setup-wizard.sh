#!/usr/bin/env bash
# TinyClaw Setup Wizard

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SETTINGS_FILE="$HOME/.tinyclaw/settings.json"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  TinyClaw - Setup Wizard${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# --- Channel registry ---
ALL_CHANNELS=(telegram discord whatsapp)

_sw_channel_display() {
    case "$1" in
        telegram) echo "Telegram" ;; discord) echo "Discord" ;; whatsapp) echo "WhatsApp" ;;
    esac
}
_sw_channel_token_key() {
    case "$1" in
        discord) echo "discord_bot_token" ;; telegram) echo "telegram_bot_token" ;;
    esac
}
_sw_channel_token_prompt() {
    case "$1" in
        discord) echo "Enter your Discord bot token:" ;; telegram) echo "Enter your Telegram bot token:" ;;
    esac
}
_sw_channel_token_help() {
    case "$1" in
        discord) echo "(Get one at: https://discord.com/developers/applications)" ;;
        telegram) echo "(Create a bot via @BotFather on Telegram to get a token)" ;;
    esac
}

# Channel selection - simple checklist
echo "Which messaging channels (Telegram, Discord, WhatsApp) do you want to enable?"
echo ""

ENABLED_CHANNELS=()
for ch in "${ALL_CHANNELS[@]}"; do
    read -rp "  Enable $(_sw_channel_display "$ch")? [y/N]: " choice
    if [[ "$choice" =~ ^[yY] ]]; then
        ENABLED_CHANNELS+=("$ch")
        echo -e "    ${GREEN}✓ $(_sw_channel_display "$ch") enabled${NC}"
    fi
done
echo ""

if [ ${#ENABLED_CHANNELS[@]} -eq 0 ]; then
    echo -e "${RED}No channels selected. At least one channel is required.${NC}"
    exit 1
fi

# Collect tokens for channels that need them
# Use parallel arrays for bash 3.2 compatibility
_TOKEN_CHANNEL_KEYS=()
_TOKEN_CHANNEL_VALS=()

for ch in "${ENABLED_CHANNELS[@]}"; do
    token_key="$(_sw_channel_token_key "$ch")"
    if [ -n "$token_key" ]; then
        echo "$(_sw_channel_token_prompt "$ch")"
        echo -e "${YELLOW}$(_sw_channel_token_help "$ch")${NC}"
        echo ""
        read -rp "Token: " token_value

        if [ -z "$token_value" ]; then
            echo -e "${RED}$(_sw_channel_display "$ch") bot token is required${NC}"
            exit 1
        fi
        _TOKEN_CHANNEL_KEYS+=("$ch")
        _TOKEN_CHANNEL_VALS+=("$token_value")
        echo -e "${GREEN}✓ $(_sw_channel_display "$ch") token saved${NC}"
        echo ""
    fi
done

# Helper to look up a collected token
_get_token() {
    local ch="$1" i
    for i in "${!_TOKEN_CHANNEL_KEYS[@]}"; do
        if [ "${_TOKEN_CHANNEL_KEYS[$i]}" = "$ch" ]; then
            echo "${_TOKEN_CHANNEL_VALS[$i]}"
            return
        fi
    done
}

# Provider selection
echo "Which AI provider?"
echo ""
echo "  1) Anthropic (Claude)  (recommended)"
echo "  2) OpenAI (Codex/GPT)"
echo "  3) OpenCode"
echo "  4) Kimi"
echo "  5) MiniMax"
echo ""
read -rp "Choose [1-5]: " PROVIDER_CHOICE

case "$PROVIDER_CHOICE" in
    1) PROVIDER="anthropic" ;;
    2) PROVIDER="openai" ;;
    3) PROVIDER="opencode" ;;
    4) PROVIDER="kimi" ;;
    5) PROVIDER="minimax" ;;
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac
echo -e "${GREEN}✓ Provider: $PROVIDER${NC}"
echo ""

# API Key collection for providers that require it
API_KEY=""
if [ "$PROVIDER" = "kimi" ] || [ "$PROVIDER" = "minimax" ]; then
    PROVIDER_DISPLAY="$PROVIDER"
    [ "$PROVIDER" = "kimi" ] && PROVIDER_DISPLAY="Kimi"
    [ "$PROVIDER" = "minimax" ] && PROVIDER_DISPLAY="MiniMax"

    echo "Enter your $PROVIDER_DISPLAY API key:"
    echo -e "${YELLOW}(Get one at: https://www.kimi.com/code/console for Kimi, https://platform.minimax.io for MiniMax)${NC}"
    echo ""
    read -rp "API Key: " API_KEY

    if [ -z "$API_KEY" ]; then
        echo -e "${RED}API key is required for $PROVIDER_DISPLAY${NC}"
        exit 1
    fi

    # Optional validation (best effort)
    echo ""
    echo -e "${BLUE}Validating API key...${NC}"
    VALIDATION_URL=""
    [ "$PROVIDER" = "kimi" ] && VALIDATION_URL="https://api.kimi.com/coding/models"
    [ "$PROVIDER" = "minimax" ] && VALIDATION_URL="https://api.minimax.io/anthropic/v1/models"

    if command -v curl > /dev/null 2>&1; then
        HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $API_KEY" "$VALIDATION_URL" 2>/dev/null || echo "000")
        if [ "$HTTP_STATUS" = "200" ]; then
            echo -e "${GREEN}✓ API key validated${NC}"
        elif [ "$HTTP_STATUS" = "401" ] || [ "$HTTP_STATUS" = "403" ]; then
            echo -e "${YELLOW}⚠ Warning: API key appears invalid (HTTP $HTTP_STATUS)${NC}"
            read -rp "Continue anyway? [y/N]: " CONTINUE_ANYWAY
            if [[ ! "$CONTINUE_ANYWAY" =~ ^[yY] ]]; then
                exit 1
            fi
        else
            echo -e "${YELLOW}⚠ Could not validate API key (HTTP $HTTP_STATUS)${NC}"
            echo -e "${YELLOW}  Continuing anyway...${NC}"
        fi
    else
        echo -e "${YELLOW}⚠ curl not available, skipping validation${NC}"
    fi
    echo ""
fi

# Model selection based on provider
if [ "$PROVIDER" = "anthropic" ]; then
    echo "Which Claude model?"
    echo ""
    echo "  1) Sonnet  (fast, recommended)"
    echo "  2) Opus    (smartest)"
    echo "  3) Custom  (enter model name)"
    echo ""
    read -rp "Choose [1-3]: " MODEL_CHOICE

    case "$MODEL_CHOICE" in
        1) MODEL="sonnet" ;;
        2) MODEL="opus" ;;
        3)
            read -rp "Enter model name: " MODEL
            if [ -z "$MODEL" ]; then
                echo -e "${RED}Model name required${NC}"
                exit 1
            fi
            ;;
        *)
            echo -e "${RED}Invalid choice${NC}"
            exit 1
            ;;
    esac
    echo -e "${GREEN}✓ Model: $MODEL${NC}"
    echo ""
elif [ "$PROVIDER" = "opencode" ]; then
    echo "Which OpenCode model? (provider/model format)"
    echo ""
    echo "  1) opencode/claude-sonnet-4-5  (recommended)"
    echo "  2) opencode/claude-opus-4-6"
    echo "  3) opencode/gemini-3-flash"
    echo "  4) opencode/gemini-3-pro"
    echo "  5) anthropic/claude-sonnet-4-5"
    echo "  6) anthropic/claude-opus-4-6"
    echo "  7) openai/gpt-5.3-codex"
    echo "  8) Custom  (enter model name)"
    echo ""
    read -rp "Choose [1-8, default: 1]: " MODEL_CHOICE

    case "$MODEL_CHOICE" in
        2) MODEL="opencode/claude-opus-4-6" ;;
        3) MODEL="opencode/gemini-3-flash" ;;
        4) MODEL="opencode/gemini-3-pro" ;;
        5) MODEL="anthropic/claude-sonnet-4-5" ;;
        6) MODEL="anthropic/claude-opus-4-6" ;;
        7) MODEL="openai/gpt-5.3-codex" ;;
        8)
            read -rp "Enter model name (e.g. provider/model): " MODEL
            if [ -z "$MODEL" ]; then
                echo -e "${RED}Model name required${NC}"
                exit 1
            fi
            ;;
        *) MODEL="opencode/claude-sonnet-4-5" ;;
    esac
    echo -e "${GREEN}✓ Model: $MODEL${NC}"
    echo ""
elif [ "$PROVIDER" = "kimi" ]; then
    echo "Which Kimi model?"
    echo ""
    echo "  1) kimi2.5  (recommended)"
    echo ""
    read -rp "Choose [1]: " MODEL_CHOICE

    case "$MODEL_CHOICE" in
        *) MODEL="kimi2.5" ;;
    esac
    echo -e "${GREEN}✓ Model: $MODEL${NC}"
    echo ""
elif [ "$PROVIDER" = "minimax" ]; then
    echo "Which MiniMax model?"
    echo ""
    echo "  1) MiniMax-M2.5  (recommended)"
    echo ""
    read -rp "Choose [1]: " MODEL_CHOICE

    case "$MODEL_CHOICE" in
        *) MODEL="MiniMax-M2.5" ;;
    esac
    echo -e "${GREEN}✓ Model: $MODEL${NC}"
    echo ""
else
    # OpenAI models
    echo "Which OpenAI model?"
    echo ""
    echo "  1) GPT-5.3 Codex  (recommended)"
    echo "  2) GPT-5.2"
    echo "  3) Custom  (enter model name)"
    echo ""
    read -rp "Choose [1-3]: " MODEL_CHOICE

    case "$MODEL_CHOICE" in
        1) MODEL="gpt-5.3-codex" ;;
        2) MODEL="gpt-5.2" ;;
        3)
            read -rp "Enter model name: " MODEL
            if [ -z "$MODEL" ]; then
                echo -e "${RED}Model name required${NC}"
                exit 1
            fi
            ;;
        *)
            echo -e "${RED}Invalid choice${NC}"
            exit 1
            ;;
    esac
    echo -e "${GREEN}✓ Model: $MODEL${NC}"
    echo ""
fi

# Heartbeat interval
echo "Heartbeat interval (seconds)?"
echo -e "${YELLOW}(How often Claude checks in proactively)${NC}"
echo ""
read -rp "Interval in seconds [default: 3600]: " HEARTBEAT_INPUT
HEARTBEAT_INTERVAL=${HEARTBEAT_INPUT:-3600}

if ! [[ "$HEARTBEAT_INTERVAL" =~ ^[0-9]+$ ]]; then
    echo -e "${RED}Invalid interval, using default 3600${NC}"
    HEARTBEAT_INTERVAL=3600
fi
echo -e "${GREEN}✓ Heartbeat interval: ${HEARTBEAT_INTERVAL}s${NC}"
echo ""

# Workspace configuration
echo "Workspace name (where agent directories will be stored)?"
echo -e "${YELLOW}(Creates ~/your-workspace-name/)${NC}"
echo ""
read -rp "Workspace name [default: tinyclaw-workspace]: " WORKSPACE_INPUT
WORKSPACE_NAME=${WORKSPACE_INPUT:-tinyclaw-workspace}
# Clean workspace name
WORKSPACE_NAME=$(echo "$WORKSPACE_NAME" | tr ' ' '-' | tr -cd 'a-zA-Z0-9_/~.-')
if [[ "$WORKSPACE_NAME" == /* || "$WORKSPACE_NAME" == ~* ]]; then
  WORKSPACE_PATH="${WORKSPACE_NAME/#\~/$HOME}"
else
  WORKSPACE_PATH="$HOME/$WORKSPACE_NAME"
fi
echo -e "${GREEN}✓ Workspace: $WORKSPACE_PATH${NC}"
echo ""

# Default agent name
echo "Name your default agent?"
echo -e "${YELLOW}(The main AI assistant you'll interact with)${NC}"
echo ""
read -rp "Default agent name [default: assistant]: " DEFAULT_AGENT_INPUT
DEFAULT_AGENT_NAME=${DEFAULT_AGENT_INPUT:-assistant}
# Clean agent name
DEFAULT_AGENT_NAME=$(echo "$DEFAULT_AGENT_NAME" | tr ' ' '-' | tr -cd 'a-zA-Z0-9_-' | tr '[:upper:]' '[:lower:]')
echo -e "${GREEN}✓ Default agent: $DEFAULT_AGENT_NAME${NC}"
echo ""

# --- Additional Agents (optional) ---
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Additional Agents (Optional)${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "You can set up multiple agents with different roles, models, and working directories."
echo "Users route messages with '@agent_id message' in chat."
echo ""
read -rp "Set up additional agents? [y/N]: " SETUP_AGENTS

AGENTS_JSON=""
# Always create the default agent
DEFAULT_AGENT_DIR="$WORKSPACE_PATH/$DEFAULT_AGENT_NAME"
# Capitalize first letter of agent name (proper bash method)
DEFAULT_AGENT_DISPLAY="$(tr '[:lower:]' '[:upper:]' <<< "${DEFAULT_AGENT_NAME:0:1}")${DEFAULT_AGENT_NAME:1}"

# Create default agent JSON using jq
if [ -n "$API_KEY" ] && ([ "$PROVIDER" = "kimi" ] || [ "$PROVIDER" = "minimax" ]); then
    AGENTS_JSON=$(jq -n \
        --arg id "$DEFAULT_AGENT_NAME" \
        --arg name "$DEFAULT_AGENT_DISPLAY" \
        --arg provider "$PROVIDER" \
        --arg model "$MODEL" \
        --arg workdir "$DEFAULT_AGENT_DIR" \
        --arg apiKey "$API_KEY" \
        '{($id): {name: $name, provider: $provider, model: $model, working_directory: $workdir, apiKey: $apiKey}}')
else
    AGENTS_JSON=$(jq -n \
        --arg id "$DEFAULT_AGENT_NAME" \
        --arg name "$DEFAULT_AGENT_DISPLAY" \
        --arg provider "$PROVIDER" \
        --arg model "$MODEL" \
        --arg workdir "$DEFAULT_AGENT_DIR" \
        '{($id): {name: $name, provider: $provider, model: $model, working_directory: $workdir}}')
fi

ADDITIONAL_AGENTS=()  # Track additional agent IDs for directory creation

if [[ "$SETUP_AGENTS" =~ ^[yY] ]]; then

    # Add more agents
    ADDING_AGENTS=true
    while [ "$ADDING_AGENTS" = true ]; do
        echo ""
        read -rp "Add another agent? [y/N]: " ADD_MORE
        if [[ ! "$ADD_MORE" =~ ^[yY] ]]; then
            ADDING_AGENTS=false
            continue
        fi

        read -rp "  Agent ID (lowercase, no spaces): " NEW_AGENT_ID
        NEW_AGENT_ID=$(echo "$NEW_AGENT_ID" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')
        if [ -z "$NEW_AGENT_ID" ]; then
            echo -e "${RED}  Invalid ID, skipping${NC}"
            continue
        fi

        read -rp "  Display name: " NEW_AGENT_NAME
        [ -z "$NEW_AGENT_NAME" ] && NEW_AGENT_NAME="$NEW_AGENT_ID"

        echo "  Provider: 1) Anthropic  2) OpenAI  3) OpenCode  4) Kimi  5) MiniMax"
        read -rp "  Choose [1-5, default: 1]: " NEW_PROVIDER_CHOICE
        case "$NEW_PROVIDER_CHOICE" in
            2) NEW_PROVIDER="openai" ;;
            3) NEW_PROVIDER="opencode" ;;
            4) NEW_PROVIDER="kimi" ;;
            5) NEW_PROVIDER="minimax" ;;
            *) NEW_PROVIDER="anthropic" ;;
        esac

        # API Key prompt for kimi/minimax additional agents
        NEW_API_KEY=""
        if [ "$NEW_PROVIDER" = "kimi" ] || [ "$NEW_PROVIDER" = "minimax" ]; then
            PROVIDER_DISPLAY="$NEW_PROVIDER"
            [ "$NEW_PROVIDER" = "kimi" ] && PROVIDER_DISPLAY="Kimi"
            [ "$NEW_PROVIDER" = "minimax" ] && PROVIDER_DISPLAY="MiniMax"

            # Check if we have a global key for this provider
            GLOBAL_KEY=""
            if [ "$NEW_PROVIDER" = "kimi" ] && [ -n "$API_KEY" ] && [ "$PROVIDER" = "kimi" ]; then
                GLOBAL_KEY="$API_KEY"
            elif [ "$NEW_PROVIDER" = "minimax" ] && [ -n "$API_KEY" ] && [ "$PROVIDER" = "minimax" ]; then
                GLOBAL_KEY="$API_KEY"
            fi

            if [ -n "$GLOBAL_KEY" ]; then
                # Show masked global key
                MASKED_KEY="${GLOBAL_KEY:0:4}...${GLOBAL_KEY: -4}"
                echo "  Global $PROVIDER_DISPLAY API key found: $MASKED_KEY"
                read -rp "  Use global key? [Y/n]: " USE_GLOBAL
                if [[ "$USE_GLOBAL" =~ ^[nN] ]]; then
                    read -rp "  Enter different API key for this agent: " NEW_API_KEY
                fi
            else
                read -rp "  Enter $PROVIDER_DISPLAY API key for this agent: " NEW_API_KEY
            fi

            if [ -n "$NEW_API_KEY" ]; then
                # Validate the new key
                echo "  Validating API key..."
                VALIDATION_URL=""
                [ "$NEW_PROVIDER" = "kimi" ] && VALIDATION_URL="https://api.kimi.com/coding/models"
                [ "$NEW_PROVIDER" = "minimax" ] && VALIDATION_URL="https://api.minimax.io/anthropic/v1/models"

                if command -v curl > /dev/null 2>&1; then
                    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $NEW_API_KEY" "$VALIDATION_URL" 2>/dev/null || echo "000")
                    if [ "$HTTP_STATUS" = "200" ]; then
                        echo -e "  ${GREEN}✓ API key validated${NC}"
                    else
                        echo -e "  ${YELLOW}⚠ Warning: API key validation failed (HTTP $HTTP_STATUS)${NC}"
                    fi
                fi
            fi
        fi

        if [ "$NEW_PROVIDER" = "anthropic" ]; then
            echo "  Model: 1) Sonnet  2) Opus  3) Custom"
            read -rp "  Choose [1-3, default: 1]: " NEW_MODEL_CHOICE
            case "$NEW_MODEL_CHOICE" in
                2) NEW_MODEL="opus" ;;
                3) read -rp "  Enter model name: " NEW_MODEL ;;
                *) NEW_MODEL="sonnet" ;;
            esac
        elif [ "$NEW_PROVIDER" = "opencode" ]; then
            echo "  Model: 1) opencode/claude-sonnet-4-5  2) opencode/claude-opus-4-6  3) opencode/gemini-3-flash  4) anthropic/claude-sonnet-4-5  5) Custom"
            read -rp "  Choose [1-5, default: 1]: " NEW_MODEL_CHOICE
            case "$NEW_MODEL_CHOICE" in
                2) NEW_MODEL="opencode/claude-opus-4-6" ;;
                3) NEW_MODEL="opencode/gemini-3-flash" ;;
                4) NEW_MODEL="anthropic/claude-sonnet-4-5" ;;
                5) read -rp "  Enter model name (e.g. provider/model): " NEW_MODEL ;;
                *) NEW_MODEL="opencode/claude-sonnet-4-5" ;;
            esac
        elif [ "$NEW_PROVIDER" = "kimi" ]; then
            echo "  Model: 1) kimi2.5"
            read -rp "  Choose [1]: " NEW_MODEL_CHOICE
            NEW_MODEL="kimi2.5"
        elif [ "$NEW_PROVIDER" = "minimax" ]; then
            echo "  Model: 1) MiniMax-M2.5"
            read -rp "  Choose [1]: " NEW_MODEL_CHOICE
            NEW_MODEL="MiniMax-M2.5"
        else
            echo "  Model: 1) GPT-5.3 Codex  2) GPT-5.2  3) Custom"
            read -rp "  Choose [1-3, default: 1]: " NEW_MODEL_CHOICE
            case "$NEW_MODEL_CHOICE" in
                2) NEW_MODEL="gpt-5.2" ;;
                3) read -rp "  Enter model name: " NEW_MODEL ;;
                *) NEW_MODEL="gpt-5.3-codex" ;;
            esac
        fi

        NEW_AGENT_DIR="$WORKSPACE_PATH/$NEW_AGENT_ID"

        # Build agent JSON with optional apiKey using jq --arg for all fields
        if [ -n "$NEW_API_KEY" ]; then
            # Store agent data in temp files for later jq merge
            jq -n \
                --arg id "$NEW_AGENT_ID" \
                --arg name "$NEW_AGENT_NAME" \
                --arg provider "$NEW_PROVIDER" \
                --arg model "$NEW_MODEL" \
                --arg workdir "$NEW_AGENT_DIR" \
                --arg apiKey "$NEW_API_KEY" \
                '{($id): {name: $name, provider: $provider, model: $model, working_directory: $workdir, apiKey: $apiKey}}' \
                >> "${TMPDIR:-/tmp}/tinyclaw_agents_$$.jsonl"
        else
            jq -n \
                --arg id "$NEW_AGENT_ID" \
                --arg name "$NEW_AGENT_NAME" \
                --arg provider "$NEW_PROVIDER" \
                --arg model "$NEW_MODEL" \
                --arg workdir "$NEW_AGENT_DIR" \
                '{($id): {name: $name, provider: $provider, model: $model, working_directory: $workdir}}' \
                >> "${TMPDIR:-/tmp}/tinyclaw_agents_$$.jsonl"
        fi

        # Track this agent for directory creation later
        ADDITIONAL_AGENTS+=("$NEW_AGENT_ID")

        echo -e "  ${GREEN}✓ Agent '${NEW_AGENT_ID}' added${NC}"
    done
fi

# Merge additional agents into AGENTS_JSON
if [ -f "${TMPDIR:-/tmp}/tinyclaw_agents_$$.jsonl" ]; then
    # Start with default agent, merge additional agents
    AGENTS_JSON=$(jq -s --argjson default "$AGENTS_JSON" 'reduce .[] as $item ($default; . * $item)' "${TMPDIR:-/tmp}/tinyclaw_agents_$$.jsonl" | jq -c '.')
    rm -f "${TMPDIR:-/tmp}/tinyclaw_agents_$$.jsonl"
fi
# If no additional agents, AGENTS_JSON already contains just the default

# Build enabled channels array JSON
CHANNELS_JSON="["
for i in "${!ENABLED_CHANNELS[@]}"; do
    if [ $i -gt 0 ]; then
        CHANNELS_JSON="${CHANNELS_JSON}, "
    fi
    CHANNELS_JSON="${CHANNELS_JSON}\"${ENABLED_CHANNELS[$i]}\""
done
CHANNELS_JSON="${CHANNELS_JSON}]"

# Build channel configs with tokens
DISCORD_TOKEN="$(_get_token discord)"
TELEGRAM_TOKEN="$(_get_token telegram)"

# Write settings.json with layered structure
# Use jq --arg for all values to safely escape special characters in models/keys
if [ "$PROVIDER" = "anthropic" ]; then
    MODELS_SECTION=$(jq -n --arg m "$MODEL" \
        '"models": { "provider": "anthropic", "anthropic": { "model": $m } }' \
        | tr -d '\n')
elif [ "$PROVIDER" = "opencode" ]; then
    MODELS_SECTION=$(jq -n --arg m "$MODEL" \
        '"models": { "provider": "opencode", "opencode": { "model": $m } }' \
        | tr -d '\n')
elif [ "$PROVIDER" = "kimi" ]; then
    MODELS_SECTION=$(jq -n --arg m "$MODEL" --arg k "$API_KEY" \
        '"models": { "provider": "kimi", "kimi": { "model": $m, "apiKey": $k } }' \
        | tr -d '\n')
elif [ "$PROVIDER" = "minimax" ]; then
    MODELS_SECTION=$(jq -n --arg m "$MODEL" --arg k "$API_KEY" \
        '"models": { "provider": "minimax", "minimax": { "model": $m, "apiKey": $k } }' \
        | tr -d '\n')
else
    MODELS_SECTION=$(jq -n --arg m "$MODEL" \
        '"models": { "provider": "openai", "openai": { "model": $m } }' \
        | tr -d '\n')
fi

cat > "$SETTINGS_FILE" <<EOF
{
  "workspace": {
    "path": "${WORKSPACE_PATH}",
    "name": "${WORKSPACE_NAME}"
  },
  "channels": {
    "enabled": ${CHANNELS_JSON},
    "discord": {
      "bot_token": "${DISCORD_TOKEN}"
    },
    "telegram": {
      "bot_token": "${TELEGRAM_TOKEN}"
    },
    "whatsapp": {}
  },
  "agents": ${AGENTS_JSON},
  ${MODELS_SECTION},
  "monitoring": {
    "heartbeat_interval": ${HEARTBEAT_INTERVAL}
  }
}
EOF

# Normalize JSON with jq (fix any formatting issues)
if command -v jq &> /dev/null; then
    tmp_file="$SETTINGS_FILE.tmp"
    jq '.' "$SETTINGS_FILE" > "$tmp_file" 2>/dev/null && mv "$tmp_file" "$SETTINGS_FILE"
fi

# Create workspace directory
mkdir -p "$WORKSPACE_PATH"
echo -e "${GREEN}✓ Created workspace: $WORKSPACE_PATH${NC}"

# Create ~/.tinyclaw with templates
TINYCLAW_HOME="$HOME/.tinyclaw"
mkdir -p "$TINYCLAW_HOME"
mkdir -p "$TINYCLAW_HOME/logs"
if [ -d "$PROJECT_ROOT/.claude" ]; then
    cp -r "$PROJECT_ROOT/.claude" "$TINYCLAW_HOME/"
fi
if [ -f "$PROJECT_ROOT/heartbeat.md" ]; then
    cp "$PROJECT_ROOT/heartbeat.md" "$TINYCLAW_HOME/"
fi
if [ -f "$PROJECT_ROOT/AGENTS.md" ]; then
    cp "$PROJECT_ROOT/AGENTS.md" "$TINYCLAW_HOME/"
fi
echo -e "${GREEN}✓ Created ~/.tinyclaw with templates${NC}"

# Create default agent directory with config files
mkdir -p "$DEFAULT_AGENT_DIR"
if [ -d "$TINYCLAW_HOME/.claude" ]; then
    cp -r "$TINYCLAW_HOME/.claude" "$DEFAULT_AGENT_DIR/"
fi
if [ -f "$TINYCLAW_HOME/heartbeat.md" ]; then
    cp "$TINYCLAW_HOME/heartbeat.md" "$DEFAULT_AGENT_DIR/"
fi
if [ -f "$TINYCLAW_HOME/AGENTS.md" ]; then
    cp "$TINYCLAW_HOME/AGENTS.md" "$DEFAULT_AGENT_DIR/"
fi
echo -e "${GREEN}✓ Created default agent directory: $DEFAULT_AGENT_DIR${NC}"

# Create ~/.tinyclaw/files directory for file exchange
mkdir -p "$TINYCLAW_HOME/files"
echo -e "${GREEN}✓ Created files directory: $TINYCLAW_HOME/files${NC}"

# Create directories for additional agents
for agent_id in "${ADDITIONAL_AGENTS[@]}"; do
    AGENT_DIR="$WORKSPACE_PATH/$agent_id"
    mkdir -p "$AGENT_DIR"
    if [ -d "$TINYCLAW_HOME/.claude" ]; then
        cp -r "$TINYCLAW_HOME/.claude" "$AGENT_DIR/"
    fi
    if [ -f "$TINYCLAW_HOME/heartbeat.md" ]; then
        cp "$TINYCLAW_HOME/heartbeat.md" "$AGENT_DIR/"
    fi
    if [ -f "$TINYCLAW_HOME/AGENTS.md" ]; then
        cp "$TINYCLAW_HOME/AGENTS.md" "$AGENT_DIR/"
    fi
    echo -e "${GREEN}✓ Created agent directory: $AGENT_DIR${NC}"
done

echo -e "${GREEN}✓ Configuration saved to ~/.tinyclaw/settings.json${NC}"
echo ""
echo "You can manage agents later with:"
echo -e "  ${GREEN}tinyclaw agent list${NC}    - List agents"
echo -e "  ${GREEN}tinyclaw agent add${NC}     - Add more agents"
echo ""
echo "You can now start TinyClaw:"
echo -e "  ${GREEN}tinyclaw start${NC}"
echo ""
