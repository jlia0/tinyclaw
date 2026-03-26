#!/bin/sh
set -e

TINYAGI_HOME="${TINYAGI_HOME:-/data/.tinyagi}"
WORKSPACE="/data/workspace"
SETTINGS_FILE="$TINYAGI_HOME/settings.json"

# Create non-root user if it doesn't exist
if ! id tinyagi >/dev/null 2>&1; then
    useradd -u 1001 -d /home/tinyagi -m -s /bin/sh tinyagi
fi

# Ensure data directories exist
mkdir -p "$TINYAGI_HOME" "$WORKSPACE"

# Write default settings if missing
if [ ! -f "$SETTINGS_FILE" ]; then
    cat > "$SETTINGS_FILE" <<'SETTINGS'
{
  "workspace": {
    "path": "/data/workspace",
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
      "working_directory": "/data/workspace/tinyagi"
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
fi

# Make tinyagi CLI available
ln -sf /app/packages/cli/bin/tinyagi.mjs /usr/local/bin/tinyagi

# Ensure log directory exists
mkdir -p "$TINYAGI_HOME/logs"

# Own data directory
chown -R tinyagi:tinyagi /data

# Write PID file so `tinyagi status` sees the running process
# $$ is the shell PID; exec below replaces it with node, keeping the same PID
echo $$ > "$TINYAGI_HOME/tinyagi.pid"
chown tinyagi:tinyagi "$TINYAGI_HOME/tinyagi.pid"

# Run as non-root user (exec replaces this process, keeping PID 1)
exec gosu tinyagi node packages/main/dist/index.js
