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
# To add a new channel, add its ID here and fill in the config arrays below.
ALL_CHANNELS=(telegram discord whatsapp)

declare -A CHANNEL_DISPLAY=(
    [telegram]="Telegram"
    [discord]="Discord"
    [whatsapp]="WhatsApp"
)
declare -A CHANNEL_TOKEN_KEY=(
    [discord]="discord_bot_token"
    [telegram]="telegram_bot_token"
)
declare -A CHANNEL_TOKEN_PROMPT=(
    [discord]="Enter your Discord bot token:"
    [telegram]="Enter your Telegram bot token:"
)
declare -A CHANNEL_TOKEN_HELP=(
    [discord]="(Get one at: https://discord.com/developers/applications)"
    [telegram]="(Create a bot via @BotFather on Telegram to get a token)"
)

# Channel selection - simple checklist
echo "Which messaging channels (Telegram, Discord, WhatsApp) do you want to enable?"
echo ""

ENABLED_CHANNELS=()
for ch in "${ALL_CHANNELS[@]}"; do
    read -rp "  Enable ${CHANNEL_DISPLAY[$ch]}? [y/N]: " choice
    if [[ "$choice" =~ ^[yY] ]]; then
        ENABLED_CHANNELS+=("$ch")
        echo -e "    ${GREEN}✓ ${CHANNEL_DISPLAY[$ch]} enabled${NC}"
    fi
done
echo ""

if [ ${#ENABLED_CHANNELS[@]} -eq 0 ]; then
    echo -e "${RED}No channels selected. At least one channel is required.${NC}"
    exit 1
fi

# Collect tokens for channels that need them
declare -A TOKENS
for ch in "${ENABLED_CHANNELS[@]}"; do
    token_key="${CHANNEL_TOKEN_KEY[$ch]:-}"
    if [ -n "$token_key" ]; then
        echo "${CHANNEL_TOKEN_PROMPT[$ch]}"
        echo -e "${YELLOW}${CHANNEL_TOKEN_HELP[$ch]}${NC}"
        echo ""
        read -rp "Token: " token_value

        if [ -z "$token_value" ]; then
            echo -e "${RED}${CHANNEL_DISPLAY[$ch]} bot token is required${NC}"
            exit 1
        fi
        TOKENS[$ch]="$token_value"
        echo -e "${GREEN}✓ ${CHANNEL_DISPLAY[$ch]} token saved${NC}"
        echo ""
    fi
done

# Provider selection
echo "Which AI provider?"
echo ""
echo "  1) Anthropic (Claude)  (recommended)"
echo "  2) OpenAI (Codex/GPT)"
echo ""
read -rp "Choose [1-2]: " PROVIDER_CHOICE

case "$PROVIDER_CHOICE" in
    1) PROVIDER="anthropic" ;;
    2) PROVIDER="openai" ;;
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac
echo -e "${GREEN}✓ Provider: $PROVIDER${NC}"
echo ""

# Model selection based on provider
if [ "$PROVIDER" = "anthropic" ]; then
    echo "Which Claude model?"
    echo ""
    echo "  1) Sonnet  (fast, recommended)"
    echo "  2) Opus    (smartest)"
    echo ""
    read -rp "Choose [1-2]: " MODEL_CHOICE

    case "$MODEL_CHOICE" in
        1) MODEL="sonnet" ;;
        2) MODEL="opus" ;;
        *)
            echo -e "${RED}Invalid choice${NC}"
            exit 1
            ;;
    esac
    echo -e "${GREEN}✓ Model: $MODEL${NC}"
    echo ""
else
    # OpenAI models
    echo "Which OpenAI model?"
    echo ""
    echo "  1) GPT-5.3 Codex  (recommended)"
    echo "  2) GPT-5.2"
    echo ""
    read -rp "Choose [1-2]: " MODEL_CHOICE

    case "$MODEL_CHOICE" in
        1) MODEL="gpt-5.3-codex" ;;
        2) MODEL="gpt-5.2" ;;
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
WORKSPACE_NAME=$(echo "$WORKSPACE_NAME" | tr ' ' '-' | tr -cd 'a-zA-Z0-9_-')
WORKSPACE_PATH="$HOME/$WORKSPACE_NAME"
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
AGENTS_JSON='"agents": {'
AGENTS_JSON="$AGENTS_JSON \"$DEFAULT_AGENT_NAME\": { \"name\": \"$DEFAULT_AGENT_DISPLAY\", \"provider\": \"$PROVIDER\", \"model\": \"$MODEL\", \"working_directory\": \"$DEFAULT_AGENT_DIR\" }"

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

        echo "  Provider: 1) Anthropic  2) OpenAI"
        read -rp "  Choose [1-2, default: 1]: " NEW_PROVIDER_CHOICE
        case "$NEW_PROVIDER_CHOICE" in
            2) NEW_PROVIDER="openai" ;;
            *) NEW_PROVIDER="anthropic" ;;
        esac

        if [ "$NEW_PROVIDER" = "anthropic" ]; then
            echo "  Model: 1) Sonnet  2) Opus"
            read -rp "  Choose [1-2, default: 1]: " NEW_MODEL_CHOICE
            case "$NEW_MODEL_CHOICE" in
                2) NEW_MODEL="opus" ;;
                *) NEW_MODEL="sonnet" ;;
            esac
        else
            echo "  Model: 1) GPT-5.3 Codex  2) GPT-5.2"
            read -rp "  Choose [1-2, default: 1]: " NEW_MODEL_CHOICE
            case "$NEW_MODEL_CHOICE" in
                2) NEW_MODEL="gpt-5.2" ;;
                *) NEW_MODEL="gpt-5.3-codex" ;;
            esac
        fi

        NEW_AGENT_DIR="$WORKSPACE_PATH/$NEW_AGENT_ID"

        AGENTS_JSON="$AGENTS_JSON, \"$NEW_AGENT_ID\": { \"name\": \"$NEW_AGENT_NAME\", \"provider\": \"$NEW_PROVIDER\", \"model\": \"$NEW_MODEL\", \"working_directory\": \"$NEW_AGENT_DIR\" }"

        # Track this agent for directory creation later
        ADDITIONAL_AGENTS+=("$NEW_AGENT_ID")

        echo -e "  ${GREEN}✓ Agent '${NEW_AGENT_ID}' added${NC}"
    done
fi

AGENTS_JSON="$AGENTS_JSON },"

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
DISCORD_TOKEN="${TOKENS[discord]:-}"
TELEGRAM_TOKEN="${TOKENS[telegram]:-}"

# Write settings.json with layered structure
# Use jq to build valid JSON to avoid escaping issues with agent prompts
if [ "$PROVIDER" = "anthropic" ]; then
    MODELS_SECTION='"models": { "provider": "anthropic", "anthropic": { "model": "'"${MODEL}"'" } }'
else
    MODELS_SECTION='"models": { "provider": "openai", "openai": { "model": "'"${MODEL}"'" } }'
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
  ${AGENTS_JSON}
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
