#!/usr/bin/env bash
# TinyClaw Remote Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/jlia0/tinyclaw/main/scripts/remote-install.sh | bash

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
GITHUB_REPO="jlia0/tinyclaw"
DEFAULT_BRANCH="main"
INSTALL_DIR=""

echo ""
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     TinyClaw Remote Installer         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo -e "${YELLOW}Warning: Running as root${NC}"
    echo ""
fi

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check dependencies
echo -e "${BLUE}[1/6] Checking dependencies...${NC}"
MISSING_DEPS=()

if ! command_exists node; then
    MISSING_DEPS+=("node")
fi

if ! command_exists npm; then
    MISSING_DEPS+=("npm")
fi

if ! command_exists tmux; then
    MISSING_DEPS+=("tmux")
fi

if ! command_exists claude; then
    MISSING_DEPS+=("claude (Claude Code CLI)")
fi

if [ ${#MISSING_DEPS[@]} -ne 0 ]; then
    echo -e "${RED}✗ Missing dependencies:${NC}"
    for dep in "${MISSING_DEPS[@]}"; do
        echo "  - $dep"
    done
    echo ""
    echo "Install instructions:"
    echo "  - Node.js/npm: https://nodejs.org/"
    echo "  - tmux: sudo apt install tmux (or brew install tmux)"
    echo "  - Claude Code: https://claude.com/claude-code"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓ All dependencies found${NC}"
echo ""

# Determine installation directory
echo -e "${BLUE}[2/6] Choosing installation directory...${NC}"

INSTALL_DIR="$HOME/.tinyclaw"
INSTALL_TYPE="user"
echo -e "Installing to: ${GREEN}$INSTALL_DIR${NC}"
echo ""

# Check if already installed
if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}TinyClaw is already installed at $INSTALL_DIR${NC}"
    echo ""
    read -p "Remove and reinstall? (y/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Installation cancelled."
        exit 0
    fi
    rm -rf "$INSTALL_DIR"
fi

# Detect if we can use pre-built bundle
echo -e "${BLUE}[3/6] Selecting installation method...${NC}"

# Try to get latest release
LATEST_RELEASE=$(curl -fsSL "https://api.github.com/repos/$GITHUB_REPO/releases/latest" 2>/dev/null | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/' || echo "")

if [ -n "$LATEST_RELEASE" ]; then
    BUNDLE_URL="https://github.com/$GITHUB_REPO/releases/download/$LATEST_RELEASE/tinyclaw-bundle.tar.gz"

    # Check if bundle exists
    if curl -fsSL -I "$BUNDLE_URL" >/dev/null 2>&1; then
        echo -e "${GREEN}✓ Pre-built bundle available ($LATEST_RELEASE)${NC}"
        USE_BUNDLE=true
    else
        echo -e "${YELLOW}⚠ No pre-built bundle found, will build from source${NC}"
        USE_BUNDLE=false
    fi
else
    echo -e "${YELLOW}⚠ No releases found, will build from source${NC}"
    USE_BUNDLE=false
fi
echo ""

# Download or clone
echo -e "${BLUE}[4/6] Downloading TinyClaw...${NC}"

if [ "$USE_BUNDLE" = true ]; then
    # Download and extract bundle
    mkdir -p "$INSTALL_DIR"

    echo "Downloading bundle..."
    if curl -fsSL "$BUNDLE_URL" | tar -xz -C "$INSTALL_DIR" --strip-components=1; then
        echo -e "${GREEN}✓ Bundle extracted${NC}"
    else
        echo -e "${RED}✗ Failed to download bundle, falling back to source install${NC}"
        USE_BUNDLE=false
    fi
else
    # Clone from GitHub
    if ! command_exists git; then
        echo -e "${RED}✗ git is required for source installation${NC}"
        echo "Install git or wait for a pre-built release."
        exit 1
    fi

    echo "Cloning repository..."
    git clone --depth 1 "https://github.com/$GITHUB_REPO.git" "$INSTALL_DIR"
    echo -e "${GREEN}✓ Repository cloned${NC}"
fi
echo ""

# Install dependencies (if needed)
if [ "$USE_BUNDLE" = false ]; then
    echo -e "${BLUE}[5/6] Installing dependencies...${NC}"
    cd "$INSTALL_DIR"

    echo "Running npm install (this may take a few minutes)..."
    PUPPETEER_SKIP_DOWNLOAD=true npm install --silent

    echo "Building TypeScript..."
    npm run build --silent

    echo "Pruning development dependencies..."
    npm prune --omit=dev --silent

    echo -e "${GREEN}✓ Dependencies installed${NC}"
    echo ""
else
    echo -e "${BLUE}[5/6] Skipping dependency installation (pre-built bundle)${NC}"
    echo ""
fi

# Run installer
echo -e "${BLUE}[6/6] Installing CLI command...${NC}"
cd "$INSTALL_DIR"

# Make scripts executable
chmod +x bin/tinyclaw
chmod +x tinyclaw.sh
chmod +x scripts/install.sh
chmod +x scripts/uninstall.sh
chmod +x lib/setup-wizard.sh
chmod +x lib/heartbeat-cron.sh

# Run the install script
"$INSTALL_DIR/scripts/install.sh"

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   TinyClaw Installed Successfully!    ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "Installation directory: ${BLUE}$INSTALL_DIR${NC}"
echo ""
echo "Next steps:"
echo ""
echo -e "  ${GREEN}1.${NC} Start TinyClaw:"
echo -e "     ${BLUE}tinyclaw start${NC}"
echo ""
echo -e "  ${GREEN}2.${NC} Check status:"
echo -e "     ${BLUE}tinyclaw status${NC}"
echo ""
echo -e "  ${GREEN}3.${NC} View all commands:"
echo -e "     ${BLUE}tinyclaw --help${NC}"
echo ""
echo "Documentation: https://github.com/$GITHUB_REPO"
echo ""
