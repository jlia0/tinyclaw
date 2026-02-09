#!/bin/bash
# Show WhatsApp QR code from tmux pane

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMUX_SESSION="tinyclaw"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "                    WhatsApp QR Code"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Capture WhatsApp pane with full scrollback
tmux capture-pane -t "$TMUX_SESSION:0.0" -p -S -500

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "If QR code is incomplete or not showing:"
echo "  1. Attach: tmux attach -t tinyclaw"
echo "  2. Press Ctrl+B then PgUp to scroll up"
echo ""
