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

# OpenViking setup (optional)
OPENVIKING_ENABLED=false
OPENVIKING_AUTO_START=false
OPENVIKING_HOST="127.0.0.1"
OPENVIKING_PORT="8320"
OPENVIKING_BASE_URL="http://127.0.0.1:8320"
OPENVIKING_PROJECT=""
OPENVIKING_API_KEY=""
OPENVIKING_CONFIG_PATH="$HOME/.openviking/ov.conf"
OPENVIKING_PREFETCH_TIMEOUT_MS=5000
OPENVIKING_COMMIT_TIMEOUT_MS=60000
OPENVIKING_COMMIT_ON_SHUTDOWN=true
OPENVIKING_SESSION_IDLE_TIMEOUT_MS=1800000
OPENVIKING_PREFETCH_MAX_CHARS=1200
OPENVIKING_PREFETCH_MAX_TURNS=4
OPENVIKING_PREFETCH_MAX_HITS=8
OPENVIKING_PREFETCH_RESOURCE_SUPPLEMENT_MAX=2
OPENVIKING_PREFETCH_GATE_MODE="rule"
OPENVIKING_PREFETCH_FORCE_PATTERNS_JSON='["based on memory","using memory","from your memory","from long term memory","long-term memory","use long term memory","memory only","remember what i told you","what do you remember","what i told you before","based on our previous chats","previously told","according to memory","根据记忆","按记忆","按长期记忆","基于记忆","结合记忆","只根据记忆","只基于记忆","你还记得","你记得我说过","回忆一下","我之前告诉过","我之前提过","我之前说过","之前聊过","根据我们之前的对话","之前说过","长期记忆"]'
OPENVIKING_PREFETCH_SKIP_PATTERNS_JSON='["latest news","latest update","breaking news","today weather","live score","current price","price now","stock price","crypto price","search web","web search","search online","browse internet","browse web","run command","run this command","execute this command","execute command","terminal command","shell command","npm run","git ","最新新闻","最新动态","今天天气","当前价格","实时价格","在线搜索","网页搜索","上网查","终端命令","shell命令","执行命令","执行这个命令","跑一下命令","查一下最新","查今日"]'
OPENVIKING_PREFETCH_RULE_THRESHOLD=3
OPENVIKING_PREFETCH_LLM_AMBIGUITY_LOW=1
OPENVIKING_PREFETCH_LLM_AMBIGUITY_HIGH=2
OPENVIKING_PREFETCH_LLM_TIMEOUT_MS=7000
OPENVIKING_CLOSED_SESSION_RETENTION_DAYS=0

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  OpenViking Memory (Optional)${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Enable OpenViking native memory (Session + Search + Memory extraction)?"
read -rp "Enable OpenViking? [y/N]: " ENABLE_OPENVIKING
if [[ "$ENABLE_OPENVIKING" =~ ^[yY] ]]; then
    OPENVIKING_ENABLED=true
    OPENVIKING_AUTO_START=true
    echo ""
    echo -e "${GREEN}✓ OpenViking enabled${NC}"
    echo -e "${BLUE}Using default OpenViking server endpoint: ${OPENVIKING_BASE_URL}${NC}"

    echo ""
    echo "Now configure values that will be written into ~/.openviking/ov.conf"
    echo -e "${YELLOW}Note: currently TinyClaw setup only supports OpenAI for OpenViking (tested path).${NC}"
    read -rp "OpenAI API key (required for VLM + embedding): " OV_LLM_API_KEY
    if [ -z "$OV_LLM_API_KEY" ]; then
        echo -e "${RED}API key is required when OpenViking is enabled${NC}"
        exit 1
    fi
    OV_LLM_API_BASE="https://api.openai.com/v1"
    OV_LLM_MODEL="gpt-4o-mini"
    OV_EMBED_MODEL="text-embedding-3-large"
    OV_EMBED_DIM="3072"

    OPENVIKING_CONF_DIR="$(dirname "$OPENVIKING_CONFIG_PATH")"
    mkdir -p "$OPENVIKING_CONF_DIR"

    if ! command -v openviking &> /dev/null; then
        echo -e "${YELLOW}OpenViking CLI not found. Installing with pip...${NC}"
        if ! command -v python3 &> /dev/null; then
            echo -e "${RED}python3 is required to install OpenViking${NC}"
            exit 1
        fi
        if ! python3 -m pip install --user --upgrade openviking; then
            echo -e "${YELLOW}Default pip install failed. Retrying with PEP 668 override...${NC}"
            if ! python3 -m pip install --user --upgrade --break-system-packages openviking; then
                echo -e "${RED}Failed to install openviking package${NC}"
                exit 1
            fi
        fi
    fi

    if ! command -v jq &> /dev/null; then
        echo -e "${RED}jq is required for OpenViking config generation${NC}"
        exit 1
    fi

    jq -n \
      --arg api_key "$OV_LLM_API_KEY" \
      --arg api_base "$OV_LLM_API_BASE" \
      --arg vlm_model "$OV_LLM_MODEL" \
      --arg embed_model "$OV_EMBED_MODEL" \
      --argjson embed_dim "$OV_EMBED_DIM" \
      '{
        storage: {
          agfs: {
            backend: "local"
          },
          vectordb: {
            backend: "local",
            dimension: $embed_dim
          }
        },
        embedding: {
          dense: {
            provider: "openai",
            model: $embed_model,
            dimension: $embed_dim,
            api_key: $api_key,
            api_base: (if $api_base == "" then null else $api_base end)
          }
        },
        vlm: {
          provider: "openai",
          model: $vlm_model,
          api_key: $api_key,
          api_base: (if $api_base == "" then null else $api_base end),
          temperature: 0.0
        }
      }' > "$OPENVIKING_CONFIG_PATH"

    echo -e "${GREEN}✓ OpenViking config written: $OPENVIKING_CONFIG_PATH${NC}"
    echo -e "${GREEN}✓ TinyClaw will auto-start OpenViking server on tinyclaw start${NC}"
    echo ""
fi

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
elif [ "$PROVIDER" = "opencode" ]; then
    MODELS_SECTION='"models": { "provider": "opencode", "opencode": { "model": "'"${MODEL}"'" } }'
else
    MODELS_SECTION='"models": { "provider": "openai", "openai": { "model": "'"${MODEL}"'" } }'
fi

OPENVIKING_JSON=$(jq -n \
  --argjson enabled "$OPENVIKING_ENABLED" \
  --argjson auto_start "$OPENVIKING_AUTO_START" \
  --arg host "$OPENVIKING_HOST" \
  --argjson port "$OPENVIKING_PORT" \
  --arg base_url "$OPENVIKING_BASE_URL" \
  --arg config_path "$OPENVIKING_CONFIG_PATH" \
  --arg project "$OPENVIKING_PROJECT" \
  --arg api_key "$OPENVIKING_API_KEY" \
  --argjson prefetch_timeout_ms "$OPENVIKING_PREFETCH_TIMEOUT_MS" \
  --argjson commit_timeout_ms "$OPENVIKING_COMMIT_TIMEOUT_MS" \
  --argjson commit_on_shutdown "$OPENVIKING_COMMIT_ON_SHUTDOWN" \
  --argjson session_idle_timeout_ms "$OPENVIKING_SESSION_IDLE_TIMEOUT_MS" \
  --argjson prefetch_max_chars "$OPENVIKING_PREFETCH_MAX_CHARS" \
  --argjson prefetch_max_turns "$OPENVIKING_PREFETCH_MAX_TURNS" \
  --argjson prefetch_max_hits "$OPENVIKING_PREFETCH_MAX_HITS" \
  --argjson prefetch_resource_supplement_max "$OPENVIKING_PREFETCH_RESOURCE_SUPPLEMENT_MAX" \
  --arg prefetch_gate_mode "$OPENVIKING_PREFETCH_GATE_MODE" \
  --argjson prefetch_force_patterns "$OPENVIKING_PREFETCH_FORCE_PATTERNS_JSON" \
  --argjson prefetch_skip_patterns "$OPENVIKING_PREFETCH_SKIP_PATTERNS_JSON" \
  --argjson prefetch_rule_threshold "$OPENVIKING_PREFETCH_RULE_THRESHOLD" \
  --argjson prefetch_llm_ambiguity_low "$OPENVIKING_PREFETCH_LLM_AMBIGUITY_LOW" \
  --argjson prefetch_llm_ambiguity_high "$OPENVIKING_PREFETCH_LLM_AMBIGUITY_HIGH" \
  --argjson prefetch_llm_timeout_ms "$OPENVIKING_PREFETCH_LLM_TIMEOUT_MS" \
  --argjson closed_session_retention_days "$OPENVIKING_CLOSED_SESSION_RETENTION_DAYS" \
  '{
    enabled: $enabled,
    auto_start: $auto_start,
    host: $host,
    port: $port,
    base_url: $base_url,
    config_path: $config_path,
    project: (if $project == "" then null else $project end),
    api_key: (if $api_key == "" then null else $api_key end),
    native_session: $enabled,
    native_search: $enabled,
    prefetch: $enabled,
    autosync: true,
    commit_on_shutdown: $commit_on_shutdown,
    session_idle_timeout_ms: $session_idle_timeout_ms,
    prefetch_timeout_ms: $prefetch_timeout_ms,
    commit_timeout_ms: $commit_timeout_ms,
    prefetch_max_chars: $prefetch_max_chars,
    prefetch_max_turns: $prefetch_max_turns,
    prefetch_max_hits: $prefetch_max_hits,
    prefetch_resource_supplement_max: $prefetch_resource_supplement_max,
    prefetch_gate_mode: $prefetch_gate_mode,
    prefetch_force_patterns: $prefetch_force_patterns,
    prefetch_skip_patterns: $prefetch_skip_patterns,
    prefetch_rule_threshold: $prefetch_rule_threshold,
    prefetch_llm_ambiguity_low: $prefetch_llm_ambiguity_low,
    prefetch_llm_ambiguity_high: $prefetch_llm_ambiguity_high,
    prefetch_llm_timeout_ms: $prefetch_llm_timeout_ms,
    closed_session_retention_days: $closed_session_retention_days
  }')

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
  "openviking": ${OPENVIKING_JSON},
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
