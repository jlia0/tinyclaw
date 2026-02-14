#!/usr/bin/env bash
set -euo pipefail

cd /app

mkdir -p "$HOME/.claude" "$HOME/.codex" "$HOME/.config" /app/.tinyclaw

case "${1:-start}" in
  start)
    ./tinyclaw.sh start
    # Keep container in foreground while daemon runs in tmux.
    exec tail -F /app/.tinyclaw/logs/queue.log /app/.tinyclaw/logs/telegram.log /app/.tinyclaw/logs/heartbeat.log
    ;;
  restart)
    exec ./tinyclaw.sh restart
    ;;
  status)
    exec ./tinyclaw.sh status
    ;;
  bash|sh)
    exec "$@"
    ;;
  *)
    exec ./tinyclaw.sh "$@"
    ;;
esac
