#!/usr/bin/env bash
# TinyClaw CLI Installation Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WRAPPER="$PROJECT_ROOT/bin/tinyclaw"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}TinyClaw CLI Installer${NC}"
echo "======================"
echo ""

# Check if wrapper exists
if [ ! -f "$WRAPPER" ]; then
    echo -e "${RED}Error: Wrapper script not found at $WRAPPER${NC}"
    exit 1
fi

# Determine installation directory
INSTALL_DIR=""

if [ -w "/usr/local/bin" ]; then
    INSTALL_DIR="/usr/local/bin"
    echo -e "Installing to: ${GREEN}/usr/local/bin${NC} (system-wide)"
elif [ -d "$HOME/.local/bin" ]; then
    INSTALL_DIR="$HOME/.local/bin"
    echo -e "Installing to: ${GREEN}~/.local/bin${NC} (user)"
else
    # Create ~/.local/bin if it doesn't exist
    mkdir -p "$HOME/.local/bin"
    INSTALL_DIR="$HOME/.local/bin"
    echo -e "Installing to: ${GREEN}~/.local/bin${NC} (user, created)"
    echo ""
    echo -e "${YELLOW}Note: ~/.local/bin is not in your PATH${NC}"
    echo "Add this to your ~/.bashrc or ~/.zshrc:"
    echo ""
    echo -e "  ${GREEN}export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
    echo ""
fi

# Check if already installed
if [ -L "$INSTALL_DIR/tinyclaw" ]; then
    EXISTING_TARGET="$(readlink "$INSTALL_DIR/tinyclaw")"
    if [ "$EXISTING_TARGET" = "$WRAPPER" ]; then
        echo -e "${YELLOW}TinyClaw is already installed at $INSTALL_DIR/tinyclaw${NC}"
        echo ""
        read -p "Reinstall? (y/N) " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Installation cancelled."
            exit 0
        fi
        rm "$INSTALL_DIR/tinyclaw"
    else
        echo -e "${RED}Warning: $INSTALL_DIR/tinyclaw exists but points to a different location${NC}"
        echo "  Current: $EXISTING_TARGET"
        echo "  New:     $WRAPPER"
        echo ""
        read -p "Replace it? (y/N) " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Installation cancelled."
            exit 0
        fi
        rm "$INSTALL_DIR/tinyclaw"
    fi
elif [ -e "$INSTALL_DIR/tinyclaw" ]; then
    echo -e "${RED}Error: $INSTALL_DIR/tinyclaw exists but is not a symlink${NC}"
    echo "Please remove it manually and try again."
    exit 1
fi

# Create symlink
echo ""
echo "Creating symlink..."
ln -s "$WRAPPER" "$INSTALL_DIR/tinyclaw"

echo -e "${GREEN}✓ TinyClaw CLI installed successfully!${NC}"
echo ""
echo "You can now run 'tinyclaw' from any directory:"
echo ""
echo -e "  ${GREEN}tinyclaw start${NC}     - Start TinyClaw"
echo -e "  ${GREEN}tinyclaw status${NC}    - Check status"
echo -e "  ${GREEN}tinyclaw --help${NC}    - Show all commands"
echo ""

# Verify it works
if command -v tinyclaw &> /dev/null; then
    echo -e "${GREEN}✓ 'tinyclaw' command is available${NC}"
else
    echo -e "${YELLOW}⚠ 'tinyclaw' command not found in PATH${NC}"
    echo ""
    echo "You may need to:"
    echo "  1. Open a new terminal"
    echo "  2. Or run: source ~/.bashrc (or ~/.zshrc)"
    echo "  3. Or add $INSTALL_DIR to your PATH"
fi

echo ""
echo "To uninstall, run:"
echo -e "  ${GREEN}./uninstall.sh${NC}"
echo ""
