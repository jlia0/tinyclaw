#!/usr/bin/env bash
# tasks.sh — Manage TinyAGI kanban tasks via the REST API.
#
# Usage:
#   tasks.sh list     [--mine] [--status STATUS]
#   tasks.sh update   TASK_ID --status STATUS
#   tasks.sh create   --title "TITLE" [--description "DESC"] [--assignee ID] [--assignee-type agent|team]
#   tasks.sh comment  TASK_ID --content "MESSAGE"
#   tasks.sh comments TASK_ID

set -euo pipefail

API_PORT="${TINYAGI_API_PORT:-3777}"
API_BASE="http://localhost:${API_PORT}"
AGENT_ID="${TINYAGI_AGENT_ID:-}"

# ────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────

usage() {
    cat <<'USAGE'
tasks.sh — manage TinyAGI kanban tasks

Commands:
  list      List tasks (optionally filtered)
  update    Update a task's status
  create    Create a new task (always in backlog)
  comment   Add a comment to a task
  comments  List comments on a task

List flags:
  --mine              Only show tasks assigned to you
  --status STATUS     Filter by status (backlog, todo, in_progress, review, done)

Update args:
  TASK_ID             The task ID to update (required, first positional arg)
  --status STATUS     New status (required)

Create flags:
  --title "TITLE"           Task title (required)
  --description "DESC"      Task description (optional)
  --assignee ID             Assignee agent/team ID (optional, defaults to self)
  --assignee-type TYPE      "agent" or "team" (default: agent)

Comment args:
  TASK_ID             The task ID to comment on (required, first positional arg)
  --content "MSG"     Comment content (required)

Comments args:
  TASK_ID             The task ID to list comments for (required, first positional arg)

Examples:
  tasks.sh list --mine
  tasks.sh update task_123_abc --status done
  tasks.sh create --title "Fix auth bug" --description "Login fails on mobile"
  tasks.sh comment task_123_abc --content "Found the root cause in auth.ts"
  tasks.sh comments task_123_abc
USAGE
    exit 1
}

die() { echo "ERROR: $*" >&2; exit 1; }

# ────────────────────────────────────────────
# Commands
# ────────────────────────────────────────────

cmd_list() {
    local filter_mine=false filter_status=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --mine)   filter_mine=true; shift ;;
            --status) filter_status="$2"; shift 2 ;;
            *) die "Unknown flag: $1" ;;
        esac
    done

    local result
    result=$(curl -sf "${API_BASE}/api/tasks") || die "Failed to reach API at ${API_BASE}"

    local jq_filter="."

    if $filter_mine; then
        [[ -z "$AGENT_ID" ]] && die "--mine requires TINYAGI_AGENT_ID to be set"
        jq_filter="${jq_filter} | map(select(.assignee == \"${AGENT_ID}\"))"
    fi

    if [[ -n "$filter_status" ]]; then
        jq_filter="${jq_filter} | map(select(.status == \"${filter_status}\"))"
    fi

    echo "$result" | jq -r "${jq_filter} | .[] | \"[\(.status)] \(.id)  \(.title)  (assignee: \(.assignee | if . == \"\" then \"unassigned\" else . end))\""

    local count
    count=$(echo "$result" | jq -r "${jq_filter} | length")
    echo "---"
    echo "${count} task(s)"
}

cmd_update() {
    [[ $# -lt 1 ]] && die "Task ID is required as first argument"
    local task_id="$1"; shift
    local status=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --status) status="$2"; shift 2 ;;
            *) die "Unknown flag: $1" ;;
        esac
    done

    [[ -z "$status" ]] && die "--status is required"

    case "$status" in
        backlog|todo|in_progress|review|done) ;;
        *) die "Invalid status: $status. Must be one of: backlog, todo, in_progress, review, done" ;;
    esac

    local result
    result=$(curl -sf -X PUT "${API_BASE}/api/tasks/${task_id}" \
        -H 'Content-Type: application/json' \
        -d "{\"status\":\"${status}\"}") || die "Failed to update task ${task_id}"

    echo "Task ${task_id} updated to: ${status}"
}

cmd_create() {
    local title="" description="" assignee="" assignee_type="agent"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --title)         title="$2"; shift 2 ;;
            --description)   description="$2"; shift 2 ;;
            --assignee)      assignee="$2"; shift 2 ;;
            --assignee-type) assignee_type="$2"; shift 2 ;;
            *) die "Unknown flag: $1" ;;
        esac
    done

    [[ -z "$title" ]] && die "--title is required"

    # Default assignee to self
    if [[ -z "$assignee" && -n "$AGENT_ID" ]]; then
        assignee="$AGENT_ID"
        assignee_type="agent"
    fi

    # Build JSON payload
    local payload
    payload=$(jq -n \
        --arg title "$title" \
        --arg description "$description" \
        --arg assignee "$assignee" \
        --arg assigneeType "$assignee_type" \
        --arg status "backlog" \
        '{title: $title, description: $description, assignee: $assignee, assigneeType: $assigneeType, status: $status}')

    local result
    result=$(curl -sf -X POST "${API_BASE}/api/tasks" \
        -H 'Content-Type: application/json' \
        -d "$payload") || die "Failed to create task"

    local task_id
    task_id=$(echo "$result" | jq -r '.task.id')
    echo "Task created: ${task_id} — ${title}"
}

cmd_comment() {
    [[ $# -lt 1 ]] && die "Task ID is required as first argument"
    local task_id="$1"; shift
    local content=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --content) content="$2"; shift 2 ;;
            *) die "Unknown flag: $1" ;;
        esac
    done

    [[ -z "$content" ]] && die "--content is required"

    local author="${AGENT_ID:-User}"
    local author_type="agent"
    [[ -z "$AGENT_ID" ]] && author_type="user"

    local payload
    payload=$(jq -n \
        --arg author "$author" \
        --arg authorType "$author_type" \
        --arg content "$content" \
        '{author: $author, authorType: $authorType, content: $content}')

    local result
    result=$(curl -sf -X POST "${API_BASE}/api/tasks/${task_id}/comments" \
        -H 'Content-Type: application/json' \
        -d "$payload") || die "Failed to add comment to task ${task_id}"

    local comment_id
    comment_id=$(echo "$result" | jq -r '.comment.id')
    echo "Comment added to task ${task_id}: ${comment_id}"
}

cmd_comments() {
    [[ $# -lt 1 ]] && die "Task ID is required as first argument"
    local task_id="$1"; shift

    local result
    result=$(curl -sf "${API_BASE}/api/tasks/${task_id}/comments") || die "Failed to fetch comments for task ${task_id}"

    local count
    count=$(echo "$result" | jq -r 'length')

    if [[ "$count" -eq 0 ]]; then
        echo "No comments on task ${task_id}"
        return
    fi

    echo "$result" | jq -r '.[] | "[\(.authorType)] \(.author) (\(.createdAt | . / 1000 | strftime("%Y-%m-%d %H:%M"))):\n  \(.content)\n"'
    echo "---"
    echo "${count} comment(s)"
}

# ────────────────────────────────────────────
# Main
# ────────────────────────────────────────────

[[ $# -lt 1 ]] && usage

COMMAND="$1"; shift

case "$COMMAND" in
    list)     cmd_list "$@" ;;
    update)   cmd_update "$@" ;;
    create)   cmd_create "$@" ;;
    comment)  cmd_comment "$@" ;;
    comments) cmd_comments "$@" ;;
    help|-h|--help) usage ;;
    *) die "Unknown command: $COMMAND. Use list, update, create, comment, or comments." ;;
esac
