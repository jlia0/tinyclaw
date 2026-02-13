#!/usr/bin/env bash
# Pairing allowlist management for TinyClaw

pairing_file_path() {
    if [ -f "$SCRIPT_DIR/.tinyclaw/settings.json" ]; then
        echo "$SCRIPT_DIR/.tinyclaw/pairing.json"
    else
        echo "$HOME/.tinyclaw/pairing.json"
    fi
}

ensure_pairing_file() {
    local pairing_file
    pairing_file="$(pairing_file_path)"
    local pairing_dir
    pairing_dir="$(dirname "$pairing_file")"

    mkdir -p "$pairing_dir"
    if [ ! -f "$pairing_file" ]; then
        echo '{"pending":[],"approved":[]}' > "$pairing_file"
    fi
}

pairing_print_pending() {
    local pairing_file
    pairing_file="$(pairing_file_path)"

    local pending_count
    pending_count=$(jq -r '(.pending // []) | length' "$pairing_file" 2>/dev/null)
    if [ -z "$pending_count" ] || [ "$pending_count" = "0" ]; then
        echo "No pending pairing requests."
        return
    fi

    echo "Pending (${pending_count}):"
    jq -r '(.pending // [])[] | "- \(.code) | \(.channel) | \(.sender) (\(.senderId)) | requested \(.createdAt | todateiso8601)"' "$pairing_file" 2>/dev/null
}

pairing_print_approved() {
    local pairing_file
    pairing_file="$(pairing_file_path)"

    local approved_count
    approved_count=$(jq -r '(.approved // []) | length' "$pairing_file" 2>/dev/null)
    if [ -z "$approved_count" ] || [ "$approved_count" = "0" ]; then
        echo "No approved senders."
        return
    fi

    echo "Approved (${approved_count}):"
    jq -r '(.approved // [])[] | "- \(.channel) | \(.sender) (\(.senderId)) | approved \(.approvedAt | todateiso8601)\(if .approvedCode then \" | via \(.approvedCode)\" else \"\" end)"' "$pairing_file" 2>/dev/null
}

pairing_approve_code() {
    local code="$1"
    if [ -z "$code" ]; then
        echo "Usage: $0 pairing approve <code>"
        exit 1
    fi

    local normalized_code
    normalized_code=$(echo "$code" | tr '[:lower:]' '[:upper:]')

    local pairing_file
    pairing_file="$(pairing_file_path)"

    local exists
    exists=$(jq -r --arg code "$normalized_code" 'any((.pending // [])[]; (.code | ascii_upcase) == $code)' "$pairing_file" 2>/dev/null)
    if [ "$exists" != "true" ]; then
        echo "Pairing code not found: ${normalized_code}"
        exit 1
    fi

    local tmp_file
    tmp_file="${pairing_file}.tmp"

    jq --arg code "$normalized_code" --argjson now "$(date +%s)000" '
        .pending = (.pending // []) |
        .approved = (.approved // []) |
        ([.pending[] | select((.code | ascii_upcase) == $code)][0]) as $entry |
        .pending = [ .pending[] | select((.code | ascii_upcase) != $code) ] |
        .approved = [ .approved[] | select(.channel != $entry.channel or .senderId != $entry.senderId) ] + [{
            channel: $entry.channel,
            senderId: $entry.senderId,
            sender: $entry.sender,
            approvedAt: $now,
            approvedCode: $code
        }]
    ' "$pairing_file" > "$tmp_file" && mv "$tmp_file" "$pairing_file"

    local sender channel sender_id
    sender=$(jq -r --arg code "$normalized_code" '(.approved // [])[] | select(.approvedCode == $code) | .sender' "$pairing_file")
    channel=$(jq -r --arg code "$normalized_code" '(.approved // [])[] | select(.approvedCode == $code) | .channel' "$pairing_file")
    sender_id=$(jq -r --arg code "$normalized_code" '(.approved // [])[] | select(.approvedCode == $code) | .senderId' "$pairing_file")

    echo "Approved ${sender} (${channel}:${sender_id})"
}

pairing_unpair_sender() {
    local channel="$1"
    local sender_id="$2"

    if [ -z "$channel" ] || [ -z "$sender_id" ]; then
        echo "Usage: $0 pairing unpair <channel> <sender_id>"
        exit 1
    fi

    local pairing_file
    pairing_file="$(pairing_file_path)"

    local exists
    exists=$(jq -r --arg channel "$channel" --arg senderId "$sender_id" \
        'any((.approved // [])[]; .channel == $channel and .senderId == $senderId)' \
        "$pairing_file" 2>/dev/null)

    if [ "$exists" != "true" ]; then
        echo "Approved sender not found: ${channel}:${sender_id}"
        exit 1
    fi

    local tmp_file
    tmp_file="${pairing_file}.tmp"

    jq --arg channel "$channel" --arg senderId "$sender_id" '
        .approved = [(.approved // [])[] | select(.channel != $channel or .senderId != $senderId)]
    ' "$pairing_file" > "$tmp_file" && mv "$tmp_file" "$pairing_file"

    echo "Unpaired ${channel}:${sender_id}"
}

pairing_command() {
    if ! command -v jq &> /dev/null; then
        echo -e "${RED}Error: jq is required for pairing commands${NC}"
        echo "Install with: brew install jq (macOS) or apt-get install jq (Linux)"
        exit 1
    fi

    ensure_pairing_file

    case "$1" in
        pending)
            pairing_print_pending
            ;;
        approved)
            pairing_print_approved
            ;;
        list)
            pairing_print_pending
            echo ""
            pairing_print_approved
            ;;
        approve)
            pairing_approve_code "$2"
            ;;
        unpair)
            pairing_unpair_sender "$2" "$3"
            ;;
        *)
            echo "Usage: $0 pairing {pending|approved|list|approve <code>|unpair <channel> <sender_id>}"
            exit 1
            ;;
    esac
}
