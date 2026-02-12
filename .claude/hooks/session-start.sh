#!/bin/bash
# Session start - Load TinyClaw context from AGENTS.md

SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
AGENTS_FILE="$SCRIPT_DIR/AGENTS.md"

if [ -f "$AGENTS_FILE" ]; then
    cat "$AGENTS_FILE"
else
    echo "TinyClaw - AGENTS.md not found at $AGENTS_FILE"
fi

exit 0
