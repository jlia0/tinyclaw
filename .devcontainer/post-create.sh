#!/usr/bin/env bash
# Post-create lifecycle script for the TinyClaw devcontainer.
# Runs once after the container is built to bootstrap the dev environment.

set -euo pipefail

echo "📦 Installing Node dependencies..."
npm install

echo "🔨 Building TypeScript..."
npm run build

echo "📂 Creating local .tinyclaw skeleton for development..."
mkdir -p .tinyclaw/queue/{incoming,processing,outgoing}
mkdir -p .tinyclaw/logs
mkdir -p .tinyclaw/channels
mkdir -p .tinyclaw/files
mkdir -p .tinyclaw/chats
mkdir -p .tinyclaw/events

echo ""
echo "✅ Dev environment ready!"
echo ""
echo "Quick start:"
echo "  ./tinyclaw.sh          # Show usage / help"
echo "  ./tinyclaw.sh setup    # Run interactive setup wizard"
echo "  npm run build          # Recompile TypeScript"
