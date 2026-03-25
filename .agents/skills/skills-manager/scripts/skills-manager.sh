#!/usr/bin/env bash
# skills-manager.sh — Search and install skills from the registry to agent workspaces
#
# Usage:
#   skills-manager.sh search <query> [agent_id]    Search the skills registry
#   skills-manager.sh install <ref> <agent_id>     Install a skill to an agent workspace
#   skills-manager.sh list [agent_id]              List installed skills for an agent (or all)

set -euo pipefail

API_PORT="${TINYAGI_API_PORT:-3777}"
API_BASE="http://localhost:${API_PORT}"
SETTINGS_FILE="$HOME/.tinyagi/settings.json"

check_api() {
    if ! curl -sf "${API_BASE}/api/queue/status" > /dev/null 2>&1; then
        echo "ERROR: TinyAGI API not reachable at ${API_BASE}" >&2
        echo "Is TinyAGI running? Try: tinyagi start" >&2
        exit 1
    fi
}

get_agent_ids() {
    if [ -f "$SETTINGS_FILE" ] && command -v jq &>/dev/null; then
        jq -r '.agents // {} | keys[]' "$SETTINGS_FILE" 2>/dev/null
    else
        check_api
        curl -sf "${API_BASE}/api/agents" | jq -r 'keys[]'
    fi
}

validate_agent() {
    local agent_id="$1"
    check_api
    local status
    status=$(curl -sf -o /dev/null -w "%{http_code}" "${API_BASE}/api/agents" 2>/dev/null || echo "000")
    if [ "$status" = "000" ]; then
        echo "ERROR: Cannot reach API" >&2; exit 1
    fi
    local exists
    exists=$(curl -sf "${API_BASE}/api/agents" | jq -r --arg id "$agent_id" 'has($id)')
    if [ "$exists" != "true" ]; then
        echo "ERROR: Agent '$agent_id' not found" >&2
        echo "Available agents:" >&2
        get_agent_ids >&2
        exit 1
    fi
}

# --- Search ---
cmd_search() {
    local query="${1:?Usage: skills-manager.sh search <query> [agent_id]}"
    local agent_id="${2:-}"

    check_api

    # If no agent specified, pick first agent
    if [ -z "$agent_id" ]; then
        agent_id=$(get_agent_ids | head -1)
        if [ -z "$agent_id" ]; then
            echo "ERROR: No agents configured" >&2; exit 1
        fi
    fi

    validate_agent "$agent_id"

    echo "Searching skills registry for: $query (via agent: $agent_id)"
    echo "---"

    local response
    response=$(curl -sf -G "${API_BASE}/api/agents/${agent_id}/skills/registry" --data-urlencode "query=$query" 2>/dev/null)

    if [ -z "$response" ]; then
        echo "No results or API error"
        exit 1
    fi

    # Check for error
    local err
    err=$(echo "$response" | jq -r '.error // empty' 2>/dev/null)
    if [ -n "$err" ]; then
        echo "ERROR: $err" >&2; exit 1
    fi

    # Display results
    local count
    count=$(echo "$response" | jq -r '.results | length' 2>/dev/null || echo "0")

    if [ "$count" = "0" ]; then
        echo "No skills found matching '$query'"
        exit 0
    fi

    echo "Found $count skill(s):"
    echo ""
    echo "$response" | jq -r '.results[] | "  \(.name // .ref)\n    ref: \(.ref // "n/a")\n    \(.description // "No description")\n"'
}

# --- Install ---
cmd_install() {
    local ref="${1:?Usage: skills-manager.sh install <skill_ref> <agent_id>}"
    local agent_id="${2:?Usage: skills-manager.sh install <skill_ref> <agent_id>}"

    check_api
    validate_agent "$agent_id"

    echo "Installing skill '$ref' to agent '$agent_id'..."

    local response
    response=$(curl -sf -X POST "${API_BASE}/api/agents/${agent_id}/skills/install" \
        -H 'Content-Type: application/json' \
        -d "{\"ref\":\"$ref\"}" 2>/dev/null)

    if [ -z "$response" ]; then
        echo "ERROR: No response from API" >&2; exit 1
    fi

    local err
    err=$(echo "$response" | jq -r '.error // empty' 2>/dev/null)
    if [ -n "$err" ]; then
        echo "ERROR: $err" >&2; exit 1
    fi

    echo "OK — skill installed"
    echo "$response" | jq -r '.output // empty' 2>/dev/null
}

# --- List ---
cmd_list() {
    local agent_id="${1:-}"

    check_api

    if [ -n "$agent_id" ]; then
        validate_agent "$agent_id"
        echo "Skills installed for agent '$agent_id':"
        echo "---"
        curl -sf "${API_BASE}/api/agents/${agent_id}/skills" | jq -r '.[] | "  \(.id)  —  \(.name // .id)"'
    else
        echo "Skills by agent:"
        echo "==="
        for aid in $(get_agent_ids); do
            echo ""
            echo "Agent: $aid"
            echo "---"
            local skills
            skills=$(curl -sf "${API_BASE}/api/agents/${aid}/skills" 2>/dev/null || echo "[]")
            local count
            count=$(echo "$skills" | jq 'length' 2>/dev/null || echo "0")
            if [ "$count" = "0" ]; then
                echo "  (none)"
            else
                echo "$skills" | jq -r '.[] | "  \(.id)  —  \(.name // .id)"'
            fi
        done
    fi
}

# --- Main ---
cmd="${1:-help}"
shift || true

case "$cmd" in
    search)  cmd_search "$@" ;;
    install) cmd_install "$@" ;;
    list)    cmd_list "$@" ;;
    help|*)
        cat <<'USAGE'
skills-manager.sh — Search and install skills from the registry

Commands:
  search <query> [agent_id]      Search the skills registry
  install <skill_ref> <agent_id> Install a registry skill to an agent
  list [agent_id]                List installed skills (one agent or all)

Examples:
  skills-manager.sh search "seo"
  skills-manager.sh search "browser" coder
  skills-manager.sh install "@anthropic/seo" coder
  skills-manager.sh list coder
  skills-manager.sh list
USAGE
        ;;
esac
