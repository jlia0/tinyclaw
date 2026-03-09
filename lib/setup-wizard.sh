#!/usr/bin/env bash
# TinyClaw Setup Wizard

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRIPT_DIR="$PROJECT_ROOT"
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

source "$PROJECT_ROOT/lib/common.sh"
if ! load_channel_registry; then
    echo -e "${RED}Failed to load channel registry${NC}"
    exit 1
fi

if [ ${#ALL_CHANNELS[@]} -eq 0 ]; then
    echo -e "${RED}No channels available in registry${NC}"
    exit 1
fi

channel_list=$(IFS=', '; echo "${ALL_CHANNELS[*]}")
echo "Which messaging channels (${channel_list}) do you want to enable?"
echo ""

ENABLED_CHANNELS=()
for ch in "${ALL_CHANNELS[@]}"; do
    display="$(channel_display "$ch")"
    [ -z "$display" ] && display="$ch"
    read -rp "  Enable ${display}? [y/N]: " choice
    if [[ "$choice" =~ ^[yY] ]]; then
        ENABLED_CHANNELS+=("$ch")
        echo -e "    ${GREEN}✓ ${display} enabled${NC}"
    fi
done
echo ""

if [ ${#ENABLED_CHANNELS[@]} -eq 0 ]; then
    echo -e "${RED}No channels selected. At least one channel is required.${NC}"
    exit 1
fi

_TOKEN_CHANNEL_KEYS=()
_TOKEN_CHANNEL_VALS=()

for ch in "${ENABLED_CHANNELS[@]}"; do
    token_key="$(channel_token_key "$ch")"
    if [ -n "$token_key" ]; then
        prompt="$(channel_token_prompt "$ch")"
        help="$(channel_token_help "$ch")"
        display="$(channel_display "$ch")"
        [ -z "$display" ] && display="$ch"
        [ -z "$prompt" ] && prompt="Enter token:"
        echo "$prompt"
        if [ -n "$help" ]; then
            echo -e "${YELLOW}${help}${NC}"
        fi
        echo ""
        read -rp "Token: " token_value

        if [ -z "$token_value" ]; then
            echo -e "${RED}${display} bot token is required${NC}"
            exit 1
        fi
        _TOKEN_CHANNEL_KEYS+=("$ch")
        _TOKEN_CHANNEL_VALS+=("$token_value")
        echo -e "${GREEN}✓ ${display} token saved${NC}"
        echo ""
    fi
done

_get_token() {
    local ch="$1" i
    for i in "${!_TOKEN_CHANNEL_KEYS[@]}"; do
        if [ "${_TOKEN_CHANNEL_KEYS[$i]}" = "$ch" ]; then
            echo "${_TOKEN_CHANNEL_VALS[$i]}"
            return
        fi
    done
}

echo "Which AI provider?"
echo ""
echo "  1) Anthropic (Claude)  (recommended)"
echo "  2) OpenAI (Codex/GPT)"
echo "  3) OpenCode"
echo ""
read -rp "Choose [1-3]: " PROVIDER_CHOICE

case "$PROVIDER_CHOICE" in
    1) PROVIDER="anthropic" ;;
    2) PROVIDER="openai" ;;
    3) PROVIDER="opencode" ;;
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac
echo -e "${GREEN}✓ Provider: $PROVIDER${NC}"
echo ""

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
else
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

echo "Workspace name (where agent directories will be stored)?"
echo -e "${YELLOW}(Creates ~/your-workspace-name/)${NC}"
echo ""
read -rp "Workspace name [default: tinyclaw-workspace]: " WORKSPACE_INPUT
WORKSPACE_NAME=${WORKSPACE_INPUT:-tinyclaw-workspace}
WORKSPACE_NAME=$(echo "$WORKSPACE_NAME" | tr ' ' '-' | tr -cd 'a-zA-Z0-9_/~.-')
if [[ "$WORKSPACE_NAME" == /* || "$WORKSPACE_NAME" == ~* ]]; then
  WORKSPACE_PATH="${WORKSPACE_NAME/#\~/$HOME}"
else
  WORKSPACE_PATH="$HOME/$WORKSPACE_NAME"
fi
echo -e "${GREEN}✓ Workspace: $WORKSPACE_PATH${NC}"
echo ""

echo "Name your default agent?"
echo -e "${YELLOW}(The main AI assistant you'll interact with)${NC}"
echo ""
read -rp "Default agent name [default: assistant]: " DEFAULT_AGENT_INPUT
DEFAULT_AGENT_NAME=${DEFAULT_AGENT_INPUT:-assistant}
DEFAULT_AGENT_NAME=$(echo "$DEFAULT_AGENT_NAME" | tr ' ' '-' | tr -cd 'a-zA-Z0-9_-' | tr '[:upper:]' '[:lower:]')
echo -e "${GREEN}✓ Default agent: $DEFAULT_AGENT_NAME${NC}"
echo ""

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Additional Agents (Optional)${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "You can set up multiple agents with different roles, models, and working directories."
echo "Users route messages with '@agent_id message' in chat."
echo ""
read -rp "Set up additional agents? [y/N]: " SETUP_AGENTS

AGENTS_JSON=""
DEFAULT_AGENT_DIR="$WORKSPACE_PATH/$DEFAULT_AGENT_NAME"
DEFAULT_AGENT_DISPLAY="$(tr '[:lower:]' '[:upper:]' <<< "${DEFAULT_AGENT_NAME:0:1}")${DEFAULT_AGENT_NAME:1}"
AGENTS_JSON='"agents": {'
AGENTS_JSON="$AGENTS_JSON \"$DEFAULT_AGENT_NAME\": { \"name\": \"$DEFAULT_AGENT_DISPLAY\", \"provider\": \"$PROVIDER\", \"model\": \"$MODEL\", \"working_directory\": \"$DEFAULT_AGENT_DIR\" }"

ADDITIONAL_AGENTS=()

if [[ "$SETUP_AGENTS" =~ ^[yY] ]]; then
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

        echo "  Provider: 1) Anthropic  2) OpenAI  3) OpenCode"
        read -rp "  Choose [1-3, default: 1]: " NEW_PROVIDER_CHOICE
        case "$NEW_PROVIDER_CHOICE" in
            2) NEW_PROVIDER="openai" ;;
            3) NEW_PROVIDER="opencode" ;;
            *) NEW_PROVIDER="anthropic" ;;
        esac

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
        AGENTS_JSON="$AGENTS_JSON, \"$NEW_AGENT_ID\": { \"name\": \"$NEW_AGENT_NAME\", \"provider\": \"$NEW_PROVIDER\", \"model\": \"$NEW_MODEL\", \"working_directory\": \"$NEW_AGENT_DIR\" }"
        ADDITIONAL_AGENTS+=("$NEW_AGENT_ID")

        echo -e "  ${GREEN}✓ Agent '${NEW_AGENT_ID}' added${NC}"
    done
fi

AGENTS_JSON="$AGENTS_JSON },"

CHANNELS_JSON="["
for i in "${!ENABLED_CHANNELS[@]}"; do
    if [ $i -gt 0 ]; then
        CHANNELS_JSON="${CHANNELS_JSON}, "
    fi
    CHANNELS_JSON="${CHANNELS_JSON}\"${ENABLED_CHANNELS[$i]}\""
done
CHANNELS_JSON="${CHANNELS_JSON}]"

if [ "$PROVIDER" = "anthropic" ]; then
    MODELS_SECTION='"models": { "provider": "anthropic", "anthropic": { "model": "'"${MODEL}"'" } }'
elif [ "$PROVIDER" = "opencode" ]; then
    MODELS_SECTION='"models": { "provider": "opencode", "opencode": { "model": "'"${MODEL}"'" } }'
else
    MODELS_SECTION='"models": { "provider": "openai", "openai": { "model": "'"${MODEL}"'" } }'
fi

CHANNEL_CONFIG_JSON=""
for ch in "${ALL_CHANNELS[@]}"; do
    token_key="$(channel_token_key "$ch")"
    if [ -n "$token_key" ]; then
        token_value="$(_get_token "$ch")"
        CHANNEL_CONFIG_JSON="$CHANNEL_CONFIG_JSON\"${ch}\": { \"${token_key}\": \"${token_value}\" },"
    else
        CHANNEL_CONFIG_JSON="$CHANNEL_CONFIG_JSON\"${ch}\": {},"
    fi
done
CHANNEL_CONFIG_JSON="${CHANNEL_CONFIG_JSON%,}"

cat > "$SETTINGS_FILE" <<EOF
{
  "workspace": {
    "path": "${WORKSPACE_PATH}",
    "name": "${WORKSPACE_NAME}"
  },
  "channels": {
    "enabled": ${CHANNELS_JSON},
    ${CHANNEL_CONFIG_JSON}
  },
  ${AGENTS_JSON}
  ${MODELS_SECTION},
  "monitoring": {
    "heartbeat_interval": ${HEARTBEAT_INTERVAL}
  }
}
EOF

if command -v jq &> /dev/null; then
    tmp_file="$SETTINGS_FILE.tmp"
    jq '.' "$SETTINGS_FILE" > "$tmp_file" 2>/dev/null && mv "$tmp_file" "$SETTINGS_FILE"
fi

mkdir -p "$WORKSPACE_PATH"
echo -e "${GREEN}✓ Created workspace: $WORKSPACE_PATH${NC}"

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

mkdir -p "$TINYCLAW_HOME/files"
echo -e "${GREEN}✓ Created files directory: $TINYCLAW_HOME/files${NC}"

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
