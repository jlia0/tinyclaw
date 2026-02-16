#!/usr/bin/env bash
# schedule.sh — Create, list, and delete scheduled cron jobs that send messages
#               to the tinyclaw incoming queue with task context and target agent.
#
# Usage:
#   schedule.sh create  --cron "EXPR" --agent AGENT_ID --message "MSG" [--channel CH] [--sender S] [--label LABEL]
#   schedule.sh list    [--agent AGENT_ID]
#   schedule.sh delete  --label LABEL
#   schedule.sh delete  --all
#
# Each cron entry is tagged with a comment: # tinyclaw-schedule:<label>
# so we can list/delete them reliably.

set -euo pipefail

# Platform check — crontab is not available on Windows natively
case "$(uname -s)" in
    CYGWIN*|MINGW*|MSYS*|Windows_NT*)
        echo "ERROR: schedule.sh requires crontab, which is not available on Windows." >&2
        echo "Use WSL (Windows Subsystem for Linux) to run this script." >&2
        exit 1
        ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${TINYCLAW_PROJECT_ROOT:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"

# Resolve TINYCLAW_HOME (same logic as the TypeScript config)
if [ -z "$TINYCLAW_HOME" ]; then
    if [ -f "$PROJECT_ROOT/.tinyclaw/settings.json" ]; then
        TINYCLAW_HOME="$PROJECT_ROOT/.tinyclaw"
    else
        TINYCLAW_HOME="$HOME/.tinyclaw"
    fi
fi

QUEUE_INCOMING="$TINYCLAW_HOME/queue/incoming"
mkdir -p "$QUEUE_INCOMING"

TAG_PREFIX="tinyclaw-schedule"

# ────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────

usage() {
    cat <<'USAGE'
schedule.sh — manage tinyclaw scheduled tasks (cron jobs)

Commands:
  create   Create a new schedule
  list     List existing schedules
  delete   Delete a schedule by label (or --all)

Create flags:
  --cron "EXPR"       Cron expression (required, 5-field)
  --agent AGENT_ID    Target agent (required)
  --message "MSG"     Message / task context to send (required)
  --channel CH        Channel name (default: schedule)
  --sender S          Sender name (default: Scheduler)
  --label LABEL       Unique label for this schedule (default: auto-generated)

List flags:
  --agent AGENT_ID    Filter by agent (optional)

Delete flags:
  --label LABEL       Delete the schedule with this label
  --all               Delete ALL tinyclaw schedules

Examples:
  schedule.sh create --cron "0 9 * * *" --agent coder --message "Run daily tests"
  schedule.sh create --cron "*/30 * * * *" --agent analyst --message "Check metrics" --label metrics-check
  schedule.sh list
  schedule.sh list --agent coder
  schedule.sh delete --label metrics-check
  schedule.sh delete --all
USAGE
    exit 1
}

die() { echo "ERROR: $*" >&2; exit 1; }

generate_label() {
    echo "sched-$(date +%s)-$$"
}

# Build the queue-writer command that cron will execute.
# It writes a JSON message to the incoming queue directory.
build_cron_command() {
    local agent="$1" message="$2" channel="$3" sender="$4" label="$5"

    # Escape double quotes in the message for JSON safety
    local escaped_message="${message//\"/\\\"}"

    # The cron command must be a single line for crontab.
    # Uses printf to write a JSON file into QUEUE_INCOMING each time it fires.
    printf '%s' "/bin/bash -c 'QUEUE_INCOMING=\"$QUEUE_INCOMING\"; MSG_ID=\"${label}_\$(date +\\%s)_\$\$\"; printf '\\''{ \"channel\": \"$channel\", \"sender\": \"$sender\", \"senderId\": \"${TAG_PREFIX}:${label}\", \"message\": \"@${agent} ${escaped_message}\", \"timestamp\": %s000, \"messageId\": \"%s\" }'\\'' \"\$(date +%s)\" \"\$MSG_ID\" > \"\$QUEUE_INCOMING/\${MSG_ID}.json\"'"
}

# ────────────────────────────────────────────
# Commands
# ────────────────────────────────────────────

cmd_create() {
    local cron_expr="" agent="" message="" channel="schedule" sender="Scheduler" label=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --cron)    cron_expr="$2"; shift 2 ;;
            --agent)   agent="$2"; shift 2 ;;
            --message) message="$2"; shift 2 ;;
            --channel) channel="$2"; shift 2 ;;
            --sender)  sender="$2"; shift 2 ;;
            --label)   label="$2"; shift 2 ;;
            *) die "Unknown flag: $1" ;;
        esac
    done

    [[ -z "$cron_expr" ]] && die "--cron is required"
    [[ -z "$agent" ]]     && die "--agent is required"
    [[ -z "$message" ]]   && die "--message is required"

    # Validate cron expression has 5 fields
    local field_count
    field_count=$(echo "$cron_expr" | awk '{print NF}')
    [[ "$field_count" -ne 5 ]] && die "Cron expression must have exactly 5 fields, got $field_count: $cron_expr"

    # Auto-generate label if not provided
    [[ -z "$label" ]] && label=$(generate_label)

    # Check for duplicate label
    if crontab -l 2>/dev/null | grep -q "# ${TAG_PREFIX}:${label}$"; then
        die "A schedule with label '$label' already exists. Delete it first or choose a different label."
    fi

    # Build the cron line
    local cron_cmd
    cron_cmd=$(build_cron_command "$agent" "$message" "$channel" "$sender" "$label")
    local cron_line="${cron_expr} ${cron_cmd} # ${TAG_PREFIX}:${label}"

    # Append to crontab
    (crontab -l 2>/dev/null || true; echo "$cron_line") | crontab -

    echo "Schedule created:"
    echo "  Label:   $label"
    echo "  Cron:    $cron_expr"
    echo "  Agent:   @$agent"
    echo "  Message: $message"
    echo "  Channel: $channel"
}

cmd_list() {
    local filter_agent=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --agent) filter_agent="$2"; shift 2 ;;
            *) die "Unknown flag: $1" ;;
        esac
    done

    local entries
    entries=$(crontab -l 2>/dev/null | grep "# ${TAG_PREFIX}:" || true)

    if [[ -z "$entries" ]]; then
        echo "No tinyclaw schedules found."
        return
    fi

    # Filter by agent if requested
    if [[ -n "$filter_agent" ]]; then
        entries=$(echo "$entries" | grep "@${filter_agent} " || true)
        if [[ -z "$entries" ]]; then
            echo "No schedules found for agent @${filter_agent}."
            return
        fi
    fi

    echo "Tinyclaw schedules:"
    echo "---"

    echo "$entries" | while IFS= read -r line; do
        # Extract label from comment (POSIX-compatible, no grep -P)
        local label
        label=$(echo "$line" | sed "s/.*# ${TAG_PREFIX}://")

        # Extract cron expression (first 5 fields)
        local cron_expr
        cron_expr=$(echo "$line" | awk '{print $1, $2, $3, $4, $5}')

        # Extract agent from @agent pattern in the message (POSIX-compatible)
        local agent
        agent=$(echo "$line" | sed -n 's/.*@\([a-zA-Z0-9_-]*\).*/\1/p' | head -1)

        echo "  Label: $label"
        echo "  Cron:  $cron_expr"
        echo "  Agent: @${agent:-unknown}"
        echo "  ---"
    done
}

cmd_delete() {
    local label="" delete_all=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --label) label="$2"; shift 2 ;;
            --all)   delete_all=true; shift ;;
            *) die "Unknown flag: $1" ;;
        esac
    done

    if $delete_all; then
        local count
        count=$(crontab -l 2>/dev/null | grep -c "# ${TAG_PREFIX}:" || echo "0")

        if [[ "$count" -eq 0 ]]; then
            echo "No tinyclaw schedules to delete."
            return
        fi

        (crontab -l 2>/dev/null | grep -v "# ${TAG_PREFIX}:" || true) | crontab -
        echo "Deleted $count tinyclaw schedule(s)."
        return
    fi

    [[ -z "$label" ]] && die "Provide --label LABEL or --all"

    if ! crontab -l 2>/dev/null | grep -q "# ${TAG_PREFIX}:${label}$"; then
        die "No schedule found with label '$label'."
    fi

    (crontab -l 2>/dev/null | grep -v "# ${TAG_PREFIX}:${label}$" || true) | crontab -
    echo "Deleted schedule: $label"
}

# ────────────────────────────────────────────
# Main
# ────────────────────────────────────────────

[[ $# -lt 1 ]] && usage

COMMAND="$1"; shift

case "$COMMAND" in
    create) cmd_create "$@" ;;
    list)   cmd_list "$@" ;;
    delete) cmd_delete "$@" ;;
    help|-h|--help) usage ;;
    *) die "Unknown command: $COMMAND. Use create, list, or delete." ;;
esac
