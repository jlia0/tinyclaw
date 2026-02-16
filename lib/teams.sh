#!/usr/bin/env bash
# Team management functions for TinyClaw
# Teams are named groups of agents that can collaborate via @teammate mentions

# List all configured teams
team_list() {
    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found. Run setup first.${NC}"
        exit 1
    fi

    local teams_count
    teams_count=$(jq -r '(.teams // {}) | length' "$SETTINGS_FILE" 2>/dev/null)

    if [ "$teams_count" = "0" ] || [ -z "$teams_count" ]; then
        echo -e "${YELLOW}No teams configured.${NC}"
        echo ""
        echo "Add a team with:"
        echo -e "  ${GREEN}$0 team add${NC}"
        return
    fi

    echo -e "${BLUE}Configured Teams${NC}"
    echo "================="
    echo ""

    jq -r '(.teams // {}) | to_entries[] | "\(.key)|\(.value.name)|\(.value.agents | join(","))|\(.value.leader_agent)"' "$SETTINGS_FILE" 2>/dev/null | \
    while IFS='|' read -r id name agents leader; do
        echo -e "  ${GREEN}@${id}${NC} - ${name}"
        echo "    Agents:  ${agents}"
        echo "    Leader:  @${leader}"
        echo ""
    done

    echo "Usage: Send '@team_id <message>' in any channel to route to a team."
}

# Show details for a specific team
team_show() {
    local team_id="$1"

    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found.${NC}"
        exit 1
    fi

    local team_json
    team_json=$(jq -r "(.teams // {}).\"${team_id}\" // empty" "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$team_json" ]; then
        echo -e "${RED}Team '${team_id}' not found.${NC}"
        echo ""
        echo "Available teams:"
        jq -r '(.teams // {}) | keys[]' "$SETTINGS_FILE" 2>/dev/null | while read -r id; do
            echo "  @${id}"
        done
        exit 1
    fi

    echo -e "${BLUE}Team: @${team_id}${NC}"
    echo ""
    jq "(.teams // {}).\"${team_id}\"" "$SETTINGS_FILE" 2>/dev/null
}

# Add a new team interactively
team_add() {
    if [ ! -f "$SETTINGS_FILE" ]; then
        echo -e "${RED}No settings file found. Run setup first.${NC}"
        exit 1
    fi

    # Load settings to get workspace path
    load_settings

    echo -e "${BLUE}Add New Team${NC}"
    echo ""

    # Team ID
    read -rp "Team ID (lowercase, no spaces, e.g. 'dev'): " TEAM_ID
    TEAM_ID=$(echo "$TEAM_ID" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')
    if [ -z "$TEAM_ID" ]; then
        echo -e "${RED}Invalid team ID${NC}"
        exit 1
    fi

    # Check collision with existing team IDs
    local existing_team
    existing_team=$(jq -r "(.teams // {}).\"${TEAM_ID}\" // empty" "$SETTINGS_FILE" 2>/dev/null)
    if [ -n "$existing_team" ]; then
        echo -e "${RED}Team '${TEAM_ID}' already exists. Use 'team remove ${TEAM_ID}' first.${NC}"
        exit 1
    fi

    # Check collision with existing agent IDs
    local existing_agent
    existing_agent=$(jq -r "(.agents // {}).\"${TEAM_ID}\" // empty" "$SETTINGS_FILE" 2>/dev/null)
    if [ -n "$existing_agent" ]; then
        echo -e "${RED}'${TEAM_ID}' is already used as an agent ID. Team and agent IDs share the same namespace.${NC}"
        exit 1
    fi

    # Team name
    read -rp "Display name (e.g. 'Development Team'): " TEAM_NAME
    if [ -z "$TEAM_NAME" ]; then
        TEAM_NAME="$TEAM_ID"
    fi

    # Show available agents
    echo ""
    echo -e "${BLUE}Available Agents:${NC}"
    local agent_ids=()
    while IFS= read -r aid; do
        agent_ids+=("$aid")
        local aname
        aname=$(jq -r "(.agents // {}).\"${aid}\".name" "$SETTINGS_FILE" 2>/dev/null)
        echo "  @${aid} - ${aname}"
    done < <(jq -r '(.agents // {}) | keys[]' "$SETTINGS_FILE" 2>/dev/null)

    if [ ${#agent_ids[@]} -lt 2 ]; then
        echo ""
        echo -e "${RED}You need at least 2 agents to create a team.${NC}"
        echo "Add agents with: $0 agent add"
        exit 1
    fi

    # Select agents
    echo ""
    read -rp "Select agents (comma-separated IDs, e.g. 'coder,reviewer'): " SELECTED_AGENTS_INPUT
    IFS=',' read -ra SELECTED_AGENTS_RAW <<< "$SELECTED_AGENTS_INPUT"

    # Validate and clean selected agents
    local SELECTED_AGENTS=()
    for sa in "${SELECTED_AGENTS_RAW[@]}"; do
        sa=$(echo "$sa" | tr -d ' ' | tr '[:upper:]' '[:lower:]')
        # Check if valid agent
        local found=false
        for aid in "${agent_ids[@]}"; do
            if [ "$sa" = "$aid" ]; then
                found=true
                break
            fi
        done
        if [ "$found" = true ]; then
            SELECTED_AGENTS+=("$sa")
        else
            echo -e "${YELLOW}Warning: Agent '${sa}' not found, skipping.${NC}"
        fi
    done

    if [ ${#SELECTED_AGENTS[@]} -lt 2 ]; then
        echo -e "${RED}A team requires at least 2 valid agents.${NC}"
        exit 1
    fi

    # Select leader agent
    echo ""
    echo "Selected agents: ${SELECTED_AGENTS[*]}"
    read -rp "Leader agent (receives messages first, e.g. '${SELECTED_AGENTS[0]}'): " LEADER_AGENT
    LEADER_AGENT=$(echo "$LEADER_AGENT" | tr -d ' ' | tr '[:upper:]' '[:lower:]')

    # Default to first selected agent
    if [ -z "$LEADER_AGENT" ]; then
        LEADER_AGENT="${SELECTED_AGENTS[0]}"
    fi

    # Validate leader is in selected agents
    local leader_valid=false
    for sa in "${SELECTED_AGENTS[@]}"; do
        if [ "$sa" = "$LEADER_AGENT" ]; then
            leader_valid=true
            break
        fi
    done

    if [ "$leader_valid" = false ]; then
        echo -e "${RED}Leader '${LEADER_AGENT}' must be one of the selected agents.${NC}"
        exit 1
    fi

    # Build agents JSON array
    local agents_json="["
    local first=true
    for sa in "${SELECTED_AGENTS[@]}"; do
        if [ "$first" = true ]; then
            first=false
        else
            agents_json+=","
        fi
        agents_json+="\"${sa}\""
    done
    agents_json+="]"

    # Write to settings
    local tmp_file="$SETTINGS_FILE.tmp"

    jq --arg id "$TEAM_ID" \
       --arg name "$TEAM_NAME" \
       --argjson agents "$agents_json" \
       --arg leader "$LEADER_AGENT" \
       '.teams //= {} | .teams[$id] = { name: $name, agents: $agents, leader_agent: $leader }' \
       "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"

    # Update AGENTS.md for each member agent
    for sa in "${SELECTED_AGENTS[@]}"; do
        update_agent_team_info "$sa"
    done

    echo ""
    echo -e "${GREEN}Team '${TEAM_ID}' created!${NC}"
    echo -e "  Name:    ${TEAM_NAME}"
    echo -e "  Agents:  ${SELECTED_AGENTS[*]}"
    echo -e "  Leader:  @${LEADER_AGENT}"
    echo ""
    echo -e "${BLUE}Next steps:${NC}"
    echo "  Send a message: '@${TEAM_ID} <message>' in any channel"
    echo "  The leader (@${LEADER_AGENT}) will receive it first."
    echo "  Agents can mention @teammate in responses to collaborate."
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

    # Load settings for workspace path
    load_settings

    local team_json
    team_json=$(jq -r "(.teams // {}).\"${team_id}\" // empty" "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$team_json" ]; then
        echo -e "${RED}Team '${team_id}' not found.${NC}"
        exit 1
    fi

    local team_name
    team_name=$(jq -r "(.teams // {}).\"${team_id}\".name" "$SETTINGS_FILE" 2>/dev/null)

    # Get member agents before removing
    local member_agents=()
    while IFS= read -r aid; do
        member_agents+=("$aid")
    done < <(jq -r "(.teams // {}).\"${team_id}\".agents[]" "$SETTINGS_FILE" 2>/dev/null)

    read -rp "Remove team '${team_id}' (${team_name})? [y/N]: " CONFIRM
    if [[ ! "$CONFIRM" =~ ^[yY] ]]; then
        echo "Cancelled."
        return
    fi

    local tmp_file="$SETTINGS_FILE.tmp"
    jq --arg id "$team_id" 'del(.teams[$id])' "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"

    # Update AGENTS.md for former member agents to remove team section
    for aid in "${member_agents[@]}"; do
        update_agent_team_info "$aid"
    done

    echo -e "${GREEN}Team '${team_id}' removed.${NC}"
}

# Update an agent's AGENTS.md with team collaboration info
# Called after team add/remove to keep agent docs in sync
update_agent_team_info() {
    local agent_id="$1"

    # Get agent's working directory
    local agent_dir
    agent_dir=$(jq -r "(.agents // {}).\"${agent_id}\".working_directory // empty" "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$agent_dir" ] || [ ! -d "$agent_dir" ]; then
        return
    fi

    local agents_md="$agent_dir/AGENTS.md"
    if [ ! -f "$agents_md" ]; then
        return
    fi

    # Remove existing team block if present
    if grep -q '<!-- TINYCLAW_TEAM_START -->' "$agents_md" 2>/dev/null; then
        sed -i.bak '/<!-- TINYCLAW_TEAM_START -->/,/<!-- TINYCLAW_TEAM_END -->/d' "$agents_md"
        rm -f "$agents_md.bak"
    fi

    # Find all teams this agent belongs to
    local team_ids=()
    while IFS= read -r tid; do
        team_ids+=("$tid")
    done < <(jq -r '(.teams // {}) | to_entries[] | select(.value.agents | index("'"$agent_id"'")) | .key' "$SETTINGS_FILE" 2>/dev/null)

    # If agent is not in any team, we're done
    if [ ${#team_ids[@]} -eq 0 ]; then
        return
    fi

    # Build team collaboration section
    local team_block=""
    team_block+="\n<!-- TINYCLAW_TEAM_START -->\n"
    team_block+="## Team Collaboration\n\n"
    team_block+="You are part of the following team(s). You can mention teammates using @teammate_id in your responses to hand off work or ask for help.\n\n"

    for tid in "${team_ids[@]}"; do
        local tname
        tname=$(jq -r "(.teams // {}).\"${tid}\".name" "$SETTINGS_FILE" 2>/dev/null)
        team_block+="### Team: ${tname} (@${tid})\n\n"
        team_block+="Teammates:\n"

        while IFS= read -r mate_id; do
            if [ "$mate_id" != "$agent_id" ]; then
                local mate_name
                mate_name=$(jq -r "(.agents // {}).\"${mate_id}\".name // \"${mate_id}\"" "$SETTINGS_FILE" 2>/dev/null)
                team_block+="- @${mate_id} (${mate_name})\n"
            fi
        done < <(jq -r "(.teams // {}).\"${tid}\".agents[]" "$SETTINGS_FILE" 2>/dev/null)

        team_block+="\nTo hand off to a teammate, include @teammate_id in your response. Example:\n"
        team_block+="\"I've finished my part. @reviewer please review the changes.\"\n\n"
    done

    team_block+="<!-- TINYCLAW_TEAM_END -->"

    # Append team block to AGENTS.md
    echo -e "$team_block" >> "$agents_md"
}
