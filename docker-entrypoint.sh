#!/bin/sh
set -e

TINYAGI_HOME="${TINYAGI_HOME:-/root/.tinyagi}"
WORKSPACE="/root/workspace"
SETTINGS_FILE="$TINYAGI_HOME/settings.json"

# Ensure data directories exist
mkdir -p "$TINYAGI_HOME" "$WORKSPACE"

# Write default settings if missing
if [ ! -f "$SETTINGS_FILE" ]; then
    cat > "$SETTINGS_FILE" <<'SETTINGS'
{
  "workspace": {
    "path": "/root/workspace",
    "name": "tinyagi-workspace"
  },
  "channels": {
    "enabled": []
  },
  "agents": {
    "tinyagi": {
      "name": "TinyAGI Agent",
      "provider": "anthropic",
      "model": "opus",
      "working_directory": "/root/workspace/tinyagi"
    }
  },
  "models": {
    "provider": "anthropic"
  },
  "monitoring": {
    "heartbeat_interval": 3600
  }
}
SETTINGS
fi

# Bootstrap default agent working directory
AGENT_DIR="$WORKSPACE/tinyagi"
if [ ! -d "$AGENT_DIR" ]; then
    mkdir -p "$AGENT_DIR/.tinyagi" "$AGENT_DIR/memory"

    # Copy templates from app
    [ -d /app/.agents ] && cp -r /app/.agents "$AGENT_DIR/.agents"
    [ -f /app/heartbeat.md ] && cp /app/heartbeat.md "$AGENT_DIR/"
    [ -f /app/SOUL.md ] && cp /app/SOUL.md "$AGENT_DIR/.tinyagi/"
    touch "$AGENT_DIR/AGENTS.md"
    # Signal first invocation should not try to resume a non-existent session
    touch "$AGENT_DIR/reset_flag"
fi

# Make tinyagi CLI available
ln -sf /app/packages/cli/bin/tinyagi.mjs /usr/local/bin/tinyagi

# Ensure log directory exists
mkdir -p "$TINYAGI_HOME/logs"

# Run with restart support.
# Exit code 75 = restart requested; any other code = stop container.
# The node process writes its own PID file on startup.
while true; do
    node /app/packages/main/dist/index.js
    code=$?
    [ "$code" -ne 75 ] && exit $code
    echo "[tinyagi] Restarting..."
    sleep 1
done
