#!/usr/bin/env bash
# send-message.sh — Thin wrapper around send_message.js
# Usage:
#   send-message.sh list-targets
#   send-message.sh send --channel telegram --sender-id 123 --sender "Name" --message "Hello"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/send_message.js" "$@"
