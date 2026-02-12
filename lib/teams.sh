#!/usr/bin/env bash
# Team management functions for TinyClaw

# TEAMS_DIR set after loading settings (uses workspace path)
TEAMS_DIR=""

# List all configured teams
team_list() {
    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found. Run setup first.${NC}"
        exit 1
    fi

    local agents_count
    agents_count=$(jq -r '.teams // {} | length' "$SETTINGS_FILE" 2>/dev/null)

    if [ "$agents_count" = "0" ] || [ -z "$agents_count" ]; then
        echo -e "${YELLOW}No teams configured.${NC}"
        echo ""
        echo "Using default single-team mode (from models section)."
        echo ""
        echo "Add a team with:"
        echo -e "  ${GREEN}$0 team add${NC}"
        return
    fi

    echo -e "${BLUE}Configured Teams${NC}"
    echo "================="
    echo ""

    jq -r '.teams // {} | to_entries[] | "\(.key)|\(.value.name)|\(.value.provider)|\(.value.model)|\(.value.working_directory)"' "$SETTINGS_FILE" 2>/dev/null | \
    while IFS='|' read -r id name provider model workdir; do
        echo -e "  ${GREEN}@${id}${NC} - ${name}"
        echo "    Provider:  ${provider}/${model}"
        echo "    Directory: ${workdir}"
        echo ""
    done

    echo "Usage: Send '@team_id <message>' in any channel to route to a specific team."
}

# Show details for a specific team
team_show() {
    local team_id="$1"

    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found.${NC}"
        exit 1
    fi

    local agent_json
    agent_json=$(jq -r ".teams.\"${team_id}\" // empty" "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$agent_json" ]; then
        echo -e "${RED}Team '${team_id}' not found.${NC}"
        echo ""
        echo "Available teams:"
        jq -r '.teams // {} | keys[]' "$SETTINGS_FILE" 2>/dev/null | while read -r id; do
            echo "  @${id}"
        done
        exit 1
    fi

    echo -e "${BLUE}Team: @${team_id}${NC}"
    echo ""
    jq ".teams.\"${team_id}\"" "$SETTINGS_FILE" 2>/dev/null
}

# Add a new team interactively
team_add() {
    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found. Run setup first.${NC}"
        exit 1
    fi

    # Load settings to get workspace path
    load_settings
    TEAMS_DIR="$WORKSPACE_PATH"

    echo -e "${BLUE}Add New Team${NC}"
    echo ""

    # Team ID
    read -rp "Team ID (lowercase, no spaces, e.g. 'coder'): " TEAM_ID
    TEAM_ID=$(echo "$TEAM_ID" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')
    if [ -z "$TEAM_ID" ]; then
        echo -e "${RED}Invalid team ID${NC}"
        exit 1
    fi

    # Check if exists
    local existing
    existing=$(jq -r ".teams.\"${TEAM_ID}\" // empty" "$SETTINGS_FILE" 2>/dev/null)
    if [ -n "$existing" ]; then
        echo -e "${RED}Team '${TEAM_ID}' already exists. Use 'team remove ${TEAM_ID}' first.${NC}"
        exit 1
    fi

    # Team name
    read -rp "Display name (e.g. 'Code Assistant'): " TEAM_NAME
    if [ -z "$TEAM_NAME" ]; then
        TEAM_NAME="$TEAM_ID"
    fi

    # Provider
    echo ""
    echo "Provider:"
    echo "  1) Anthropic (Claude)"
    echo "  2) OpenAI (Codex)"
    read -rp "Choose [1-2, default: 1]: " TEAM_PROVIDER_CHOICE
    case "$TEAM_PROVIDER_CHOICE" in
        2) TEAM_PROVIDER="openai" ;;
        *) TEAM_PROVIDER="anthropic" ;;
    esac

    # Model
    echo ""
    if [ "$TEAM_PROVIDER" = "anthropic" ]; then
        echo "Model:"
        echo "  1) Sonnet (fast)"
        echo "  2) Opus (smartest)"
        read -rp "Choose [1-2, default: 1]: " TEAM_MODEL_CHOICE
        case "$TEAM_MODEL_CHOICE" in
            2) TEAM_MODEL="opus" ;;
            *) TEAM_MODEL="sonnet" ;;
        esac
    else
        echo "Model:"
        echo "  1) GPT-5.3 Codex"
        echo "  2) GPT-5.2"
        read -rp "Choose [1-2, default: 1]: " TEAM_MODEL_CHOICE
        case "$TEAM_MODEL_CHOICE" in
            2) TEAM_MODEL="gpt-5.2" ;;
            *) TEAM_MODEL="gpt-5.3-codex" ;;
        esac
    fi

    # Working directory - automatically set to team directory
    TEAM_WORKDIR="$TEAMS_DIR/$TEAM_ID"

    # Write to settings
    local tmp_file="$SETTINGS_FILE.tmp"

    # Build the team JSON object
    local agent_json
    agent_json=$(jq -n \
        --arg name "$TEAM_NAME" \
        --arg provider "$TEAM_PROVIDER" \
        --arg model "$TEAM_MODEL" \
        --arg workdir "$TEAM_WORKDIR" \
        '{
            name: $name,
            provider: $provider,
            model: $model,
            working_directory: $workdir
        }')

    # Ensure teams section exists and add the new team
    jq --arg id "$TEAM_ID" --argjson team "$agent_json" \
        '.teams //= {} | .teams[$id] = $team' \
        "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"

    # Create team directory and copy configuration files
    TINYCLAW_HOME="$HOME/.tinyclaw"
    mkdir -p "$TEAMS_DIR/$TEAM_ID"

    # Copy .claude directory
    if [ -d "$SCRIPT_DIR/.claude" ]; then
        cp -r "$SCRIPT_DIR/.claude" "$TEAMS_DIR/$TEAM_ID/"
        echo "  → Copied .claude/ to team directory"
    fi

    # Copy heartbeat.md
    if [ -f "$SCRIPT_DIR/heartbeat.md" ]; then
        cp "$SCRIPT_DIR/heartbeat.md" "$TEAMS_DIR/$TEAM_ID/"
        echo "  → Copied heartbeat.md to team directory"
    fi

    # Copy AGENTS.md
    if [ -f "$SCRIPT_DIR/AGENTS.md" ]; then
        cp "$SCRIPT_DIR/AGENTS.md" "$TEAMS_DIR/$TEAM_ID/"
        echo "  → Copied AGENTS.md to team directory"
    fi

    echo ""
    echo -e "${GREEN}✓ Team '${TEAM_ID}' created!${NC}"
    echo -e "  Directory: $TEAMS_DIR/$TEAM_ID"
    echo ""
    echo -e "${BLUE}Next steps:${NC}"
    echo "  1. Customize team behavior by editing:"
    echo -e "     ${GREEN}$TEAMS_DIR/$TEAM_ID/AGENTS.md${NC}"
    echo "  2. Send a message: '@${TEAM_ID} <message>' in any channel"
    echo ""
    echo "Note: Changes take effect on next message. Restart is not required."
}

# Remove a team
team_remove() {
    local team_id="$1"

    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found.${NC}"
        exit 1
    fi

    local agent_json
    agent_json=$(jq -r ".teams.\"${team_id}\" // empty" "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$agent_json" ]; then
        echo -e "${RED}Team '${team_id}' not found.${NC}"
        exit 1
    fi

    local agent_name
    agent_name=$(jq -r ".teams.\"${team_id}\".name" "$SETTINGS_FILE" 2>/dev/null)

    read -rp "Remove team '${team_id}' (${agent_name})? [y/N]: " CONFIRM
    if [[ ! "$CONFIRM" =~ ^[yY] ]]; then
        echo "Cancelled."
        return
    fi

    local tmp_file="$SETTINGS_FILE.tmp"
    jq --arg id "$team_id" 'del(.teams[$id])' "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"

    # Clean up team state directory
    if [ -d "$TEAMS_DIR/$team_id" ]; then
        rm -rf "$TEAMS_DIR/$team_id"
    fi

    echo -e "${GREEN}✓ Team '${team_id}' removed.${NC}"
}

# Reset a specific team's conversation
team_reset() {
    local team_id="$1"

    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found.${NC}"
        exit 1
    fi

    local agent_json
    agent_json=$(jq -r ".teams.\"${team_id}\" // empty" "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$agent_json" ]; then
        echo -e "${RED}Team '${team_id}' not found.${NC}"
        exit 1
    fi

    mkdir -p "$TEAMS_DIR/$team_id"
    touch "$TEAMS_DIR/$team_id/reset_flag"

    local agent_name
    agent_name=$(jq -r ".teams.\"${team_id}\".name" "$SETTINGS_FILE" 2>/dev/null)

    echo -e "${GREEN}✓ Reset flag set for team '${team_id}' (${agent_name})${NC}"
    echo ""
    echo "The next message to @${team_id} will start a fresh conversation."
}
