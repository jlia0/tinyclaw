#!/usr/bin/env bash
# Agent management functions for TinyClaw

# AGENTS_DIR set after loading settings (uses workspace path)
AGENTS_DIR=""

# Ensure all agent workspaces have .agents/skills symlinked
ensure_agent_skills_links() {
    local skills_src="$SCRIPT_DIR/.agents/skills"
    if [ ! -d "$skills_src" ]; then
        skills_src="$TINYCLAW_HOME/.agents/skills"
    fi
    [ -d "$skills_src" ] || return 0

    local agents_dir="$WORKSPACE_PATH"
    [ -d "$agents_dir" ] || return 0

    local agent_ids
    agent_ids=$(jq -r '(.agents // {}) | keys[]' "$SETTINGS_FILE" 2>/dev/null) || return 0

    for agent_id in $agent_ids; do
        local agent_dir="$agents_dir/$agent_id"
        [ -d "$agent_dir" ] || continue

        if [ ! -e "$agent_dir/.agents/skills" ]; then
            mkdir -p "$agent_dir/.agents"
            ln -s "$skills_src" "$agent_dir/.agents/skills"
            log "Linked .agents/skills/ for agent @${agent_id}"
        fi
    done
}

# List all configured agents
agent_list() {
    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found. Run setup first.${NC}"
        exit 1
    fi

    local agents_count
    agents_count=$(jq -r '(.agents // {}) | length' "$SETTINGS_FILE" 2>/dev/null)

    if [ "$agents_count" = "0" ] || [ -z "$agents_count" ]; then
        echo -e "${YELLOW}No agents configured.${NC}"
        echo ""
        echo "Using default single-agent mode (from models section)."
        echo ""
        echo "Add an agent with:"
        echo -e "  ${GREEN}$0 agent add${NC}"
        return
    fi

    echo -e "${BLUE}Configured Agents${NC}"
    echo "================="
    echo ""

    jq -r '(.agents // {}) | to_entries[] | "\(.key)|\(.value.name)|\(.value.provider)|\(.value.model)|\(.value.working_directory)"' "$SETTINGS_FILE" 2>/dev/null | \
    while IFS='|' read -r id name provider model workdir; do
        echo -e "  ${GREEN}@${id}${NC} - ${name}"
        echo "    Provider:  ${provider}/${model}"
        echo "    Directory: ${workdir}"
        echo ""
    done

    echo "Usage: Send '@agent_id <message>' in any channel to route to a specific agent."
}

# Show details for a specific agent
agent_show() {
    local agent_id="$1"

    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found.${NC}"
        exit 1
    fi

    local agent_json
    agent_json=$(jq -r "(.agents // {}).\"${agent_id}\" // empty" "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$agent_json" ]; then
        echo -e "${RED}Agent '${agent_id}' not found.${NC}"
        echo ""
        echo "Available agents:"
        jq -r '(.agents // {}) | keys[]' "$SETTINGS_FILE" 2>/dev/null | while read -r id; do
            echo "  @${id}"
        done
        exit 1
    fi

    echo -e "${BLUE}Agent: @${agent_id}${NC}"
    echo ""
    jq "(.agents // {}).\"${agent_id}\"" "$SETTINGS_FILE" 2>/dev/null
}

# Add a new agent interactively
agent_add() {
    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found. Run setup first.${NC}"
        exit 1
    fi

    # Load settings to get workspace path
    load_settings
    AGENTS_DIR="$WORKSPACE_PATH"

    echo -e "${BLUE}Add New Agent${NC}"
    echo ""

    # Agent ID
    read -rp "Agent ID (lowercase, no spaces, e.g. 'coder'): " AGENT_ID
    AGENT_ID=$(echo "$AGENT_ID" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')
    if [ -z "$AGENT_ID" ]; then
        echo -e "${RED}Invalid agent ID${NC}"
        exit 1
    fi

    # Check if exists
    local existing
    existing=$(jq -r "(.agents // {}).\"${AGENT_ID}\" // empty" "$SETTINGS_FILE" 2>/dev/null)
    if [ -n "$existing" ]; then
        echo -e "${RED}Agent '${AGENT_ID}' already exists. Use 'agent remove ${AGENT_ID}' first.${NC}"
        exit 1
    fi

    # Agent name
    read -rp "Display name (e.g. 'Code Assistant'): " AGENT_NAME
    if [ -z "$AGENT_NAME" ]; then
        AGENT_NAME="$AGENT_ID"
    fi

    # Provider
    echo ""
    echo "Provider:"
    echo "  1) Anthropic (Claude)"
    echo "  2) OpenAI (Codex)"
    read -rp "Choose [1-2, default: 1]: " AGENT_PROVIDER_CHOICE
    case "$AGENT_PROVIDER_CHOICE" in
        2) AGENT_PROVIDER="openai" ;;
        *) AGENT_PROVIDER="anthropic" ;;
    esac

    # Model
    echo ""
    if [ "$AGENT_PROVIDER" = "anthropic" ]; then
        echo "Model:"
        echo "  1) Sonnet (fast)"
        echo "  2) Opus (smartest)"
        read -rp "Choose [1-2, default: 1]: " AGENT_MODEL_CHOICE
        case "$AGENT_MODEL_CHOICE" in
            2) AGENT_MODEL="opus" ;;
            *) AGENT_MODEL="sonnet" ;;
        esac
    else
        echo "Model:"
        echo "  1) GPT-5.3 Codex"
        echo "  2) GPT-5.2"
        read -rp "Choose [1-2, default: 1]: " AGENT_MODEL_CHOICE
        case "$AGENT_MODEL_CHOICE" in
            2) AGENT_MODEL="gpt-5.2" ;;
            *) AGENT_MODEL="gpt-5.3-codex" ;;
        esac
    fi

    # Working directory - automatically set to agent directory
    AGENT_WORKDIR="$AGENTS_DIR/$AGENT_ID"

    # Write to settings
    local tmp_file="$SETTINGS_FILE.tmp"

    # Build the agent JSON object
    local agent_json
    agent_json=$(jq -n \
        --arg name "$AGENT_NAME" \
        --arg provider "$AGENT_PROVIDER" \
        --arg model "$AGENT_MODEL" \
        --arg workdir "$AGENT_WORKDIR" \
        '{
            name: $name,
            provider: $provider,
            model: $model,
            working_directory: $workdir
        }')

    # Ensure agents section exists and add the new agent
    jq --arg id "$AGENT_ID" --argjson agent "$agent_json" \
        '.agents //= {} | .agents[$id] = $agent' \
        "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"

    # Create agent directory and copy configuration files
    if [ -z "$TINYCLAW_HOME" ]; then
        if [ -f "$SCRIPT_DIR/.tinyclaw/settings.json" ]; then
            TINYCLAW_HOME="$SCRIPT_DIR/.tinyclaw"
        else
            TINYCLAW_HOME="$HOME/.tinyclaw"
        fi
    fi
    mkdir -p "$AGENTS_DIR/$AGENT_ID"

    # Copy .claude directory
    if [ -d "$SCRIPT_DIR/.claude" ]; then
        cp -r "$SCRIPT_DIR/.claude" "$AGENTS_DIR/$AGENT_ID/"
        echo "  → Copied .claude/ to agent directory"
    else
        mkdir -p "$AGENTS_DIR/$AGENT_ID/.claude"
    fi

    # Copy heartbeat.md
    if [ -f "$SCRIPT_DIR/heartbeat.md" ]; then
        cp "$SCRIPT_DIR/heartbeat.md" "$AGENTS_DIR/$AGENT_ID/"
        echo "  → Copied heartbeat.md to agent directory"
    fi

    # Copy AGENTS.md
    if [ -f "$SCRIPT_DIR/AGENTS.md" ]; then
        cp "$SCRIPT_DIR/AGENTS.md" "$AGENTS_DIR/$AGENT_ID/"
        echo "  → Copied AGENTS.md to agent directory"
    fi

    # Copy AGENTS.md content into .claude/CLAUDE.md as well
    if [ -f "$SCRIPT_DIR/AGENTS.md" ]; then
        cp "$SCRIPT_DIR/AGENTS.md" "$AGENTS_DIR/$AGENT_ID/.claude/CLAUDE.md"
        echo "  → Copied CLAUDE.md to .claude/ directory"
    fi

    # Resolve skills source directory
    local skills_src="$SCRIPT_DIR/.agents/skills"
    if [ ! -d "$skills_src" ]; then
        skills_src="$TINYCLAW_HOME/.agents/skills"
    fi

    if [ -d "$skills_src" ]; then
        # Symlink skills directory into .claude/skills
        if [ ! -e "$AGENTS_DIR/$AGENT_ID/.claude/skills" ]; then
            ln -s "$skills_src" "$AGENTS_DIR/$AGENT_ID/.claude/skills"
            echo "  → Linked skills to .claude/skills/"
        fi

        # Symlink .agents/skills directory
        if [ ! -e "$AGENTS_DIR/$AGENT_ID/.agents/skills" ]; then
            mkdir -p "$AGENTS_DIR/$AGENT_ID/.agents"
            ln -s "$skills_src" "$AGENTS_DIR/$AGENT_ID/.agents/skills"
            echo "  → Linked skills to .agents/skills/"
        fi
    fi

    # Create .tinyclaw directory and copy SOUL.md
    mkdir -p "$AGENTS_DIR/$AGENT_ID/.tinyclaw"
    if [ -f "$SCRIPT_DIR/SOUL.md" ]; then
        cp "$SCRIPT_DIR/SOUL.md" "$AGENTS_DIR/$AGENT_ID/.tinyclaw/SOUL.md"
        echo "  → Copied SOUL.md to .tinyclaw/"
    fi

    echo ""
    echo -e "${GREEN}✓ Agent '${AGENT_ID}' created!${NC}"
    echo -e "  Directory: $AGENTS_DIR/$AGENT_ID"
    echo ""
    echo -e "${BLUE}Next steps:${NC}"
    echo "  1. Customize agent behavior by editing:"
    echo -e "     ${GREEN}$AGENTS_DIR/$AGENT_ID/AGENTS.md${NC}"
    echo "  2. Send a message: '@${AGENT_ID} <message>' in any channel"
    echo ""
    echo "Note: Changes take effect on next message. Restart is not required."
}

# Remove an agent
agent_remove() {
    local agent_id="$1"

    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found.${NC}"
        exit 1
    fi

    local agent_json
    agent_json=$(jq -r "(.agents // {}).\"${agent_id}\" // empty" "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$agent_json" ]; then
        echo -e "${RED}Agent '${agent_id}' not found.${NC}"
        exit 1
    fi

    local agent_name
    agent_name=$(jq -r "(.agents // {}).\"${agent_id}\".name" "$SETTINGS_FILE" 2>/dev/null)

    read -rp "Remove agent '${agent_id}' (${agent_name})? [y/N]: " CONFIRM
    if [[ ! "$CONFIRM" =~ ^[yY] ]]; then
        echo "Cancelled."
        return
    fi

    local tmp_file="$SETTINGS_FILE.tmp"
    jq --arg id "$agent_id" 'del(.agents[$id])' "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"

    # Clean up agent state directory
    if [ -d "$AGENTS_DIR/$agent_id" ]; then
        rm -rf "$AGENTS_DIR/$agent_id"
    fi

    echo -e "${GREEN}✓ Agent '${agent_id}' removed.${NC}"
}

# Set provider and/or model for a specific agent
agent_provider() {
    local agent_id="$1"
    local provider_arg="$2"
    local model_arg=""

    # Parse optional --model flag
    if [ "$3" = "--model" ] && [ -n "$4" ]; then
        model_arg="$4"
    fi

    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found.${NC}"
        exit 1
    fi

    local agent_json
    agent_json=$(jq -r "(.agents // {}).\"${agent_id}\" // empty" "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$agent_json" ]; then
        echo -e "${RED}Agent '${agent_id}' not found.${NC}"
        echo ""
        echo "Available agents:"
        jq -r '(.agents // {}) | keys[]' "$SETTINGS_FILE" 2>/dev/null | while read -r id; do
            echo "  @${id}"
        done
        exit 1
    fi

    if [ -z "$provider_arg" ]; then
        # Show current provider/model for this agent
        local cur_provider cur_model agent_name
        cur_provider=$(jq -r "(.agents // {}).\"${agent_id}\".provider // \"anthropic\"" "$SETTINGS_FILE" 2>/dev/null)
        cur_model=$(jq -r "(.agents // {}).\"${agent_id}\".model // empty" "$SETTINGS_FILE" 2>/dev/null)
        agent_name=$(jq -r "(.agents // {}).\"${agent_id}\".name // \"${agent_id}\"" "$SETTINGS_FILE" 2>/dev/null)
        echo -e "${BLUE}Agent: @${agent_id} (${agent_name})${NC}"
        echo -e "${BLUE}Provider: ${GREEN}${cur_provider}${NC}"
        if [ -n "$cur_model" ]; then
            echo -e "${BLUE}Model:    ${GREEN}${cur_model}${NC}"
        fi
        return
    fi

    local tmp_file="$SETTINGS_FILE.tmp"

    case "$provider_arg" in
        anthropic)
            if [ -n "$model_arg" ]; then
                jq --arg id "$agent_id" --arg model "$model_arg" \
                    '.agents[$id].provider = "anthropic" | .agents[$id].model = $model' \
                    "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
                echo -e "${GREEN}✓ Agent '${agent_id}' switched to Anthropic with model: ${model_arg}${NC}"
            else
                jq --arg id "$agent_id" \
                    '.agents[$id].provider = "anthropic"' \
                    "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
                echo -e "${GREEN}✓ Agent '${agent_id}' switched to Anthropic${NC}"
                echo ""
                echo "Use 'tinyclaw agent provider ${agent_id} anthropic --model {sonnet|opus}' to also set the model."
            fi
            ;;
        openai)
            if [ -n "$model_arg" ]; then
                jq --arg id "$agent_id" --arg model "$model_arg" \
                    '.agents[$id].provider = "openai" | .agents[$id].model = $model' \
                    "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
                echo -e "${GREEN}✓ Agent '${agent_id}' switched to OpenAI with model: ${model_arg}${NC}"
            else
                jq --arg id "$agent_id" \
                    '.agents[$id].provider = "openai"' \
                    "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"
                echo -e "${GREEN}✓ Agent '${agent_id}' switched to OpenAI${NC}"
                echo ""
                echo "Use 'tinyclaw agent provider ${agent_id} openai --model {gpt-5.3-codex|gpt-5.2}' to also set the model."
            fi
            ;;
        *)
            echo "Usage: tinyclaw agent provider <agent_id> {anthropic|openai} [--model MODEL_NAME]"
            echo ""
            echo "Examples:"
            echo "  tinyclaw agent provider coder                                    # Show current provider/model"
            echo "  tinyclaw agent provider coder anthropic                           # Switch to Anthropic"
            echo "  tinyclaw agent provider coder openai                              # Switch to OpenAI"
            echo "  tinyclaw agent provider coder anthropic --model opus              # Switch to Anthropic Opus"
            echo "  tinyclaw agent provider coder openai --model gpt-5.3-codex        # Switch to OpenAI GPT-5.3 Codex"
            exit 1
            ;;
    esac

    echo ""
    echo "Note: Changes take effect on next message. Restart is not required."
}

# Reset a specific agent's conversation
agent_reset() {
    local agent_id="$1"

    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found.${NC}"
        exit 1
    fi

    # Load settings if not already loaded
    if [ -z "$AGENTS_DIR" ] || [ "$AGENTS_DIR" = "" ]; then
        load_settings
        AGENTS_DIR="$WORKSPACE_PATH"
    fi

    local agent_json
    agent_json=$(jq -r "(.agents // {}).\"${agent_id}\" // empty" "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$agent_json" ]; then
        echo -e "${RED}Agent '${agent_id}' not found.${NC}"
        echo ""
        echo "Available agents:"
        jq -r '(.agents // {}) | keys[]' "$SETTINGS_FILE" 2>/dev/null | while read -r id; do
            echo "  @${id}"
        done
        return 1
    fi

    mkdir -p "$AGENTS_DIR/$agent_id"
    touch "$AGENTS_DIR/$agent_id/reset_flag"

    local agent_name
    agent_name=$(jq -r "(.agents // {}).\"${agent_id}\".name" "$SETTINGS_FILE" 2>/dev/null)

    echo -e "${GREEN}✓ Reset flag set for agent '${agent_id}' (${agent_name})${NC}"
    echo "  The next message to @${agent_id} will start a fresh conversation."
}

# Reset multiple agents' conversations
agent_reset_multiple() {
    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found.${NC}"
        exit 1
    fi

    load_settings
    AGENTS_DIR="$WORKSPACE_PATH"

    local has_error=0
    local reset_count=0

    for agent_id in "$@"; do
        agent_reset "$agent_id"
        if [ $? -eq 0 ]; then
            reset_count=$((reset_count + 1))
        else
            has_error=1
        fi
    done

    echo ""
    if [ "$reset_count" -gt 0 ]; then
        echo -e "${GREEN}Reset ${reset_count} agent(s).${NC}"
    fi

    if [ "$has_error" -eq 1 ]; then
        exit 1
    fi
}
