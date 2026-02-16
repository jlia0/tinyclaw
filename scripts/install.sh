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
fi

# Check if already installed
if [ -L "$INSTALL_DIR/tinyclaw" ]; then
    EXISTING_TARGET="$(readlink "$INSTALL_DIR/tinyclaw")"
    if [ "$EXISTING_TARGET" = "$WRAPPER" ]; then
        echo -e "${YELLOW}TinyClaw is already installed at $INSTALL_DIR/tinyclaw${NC}"
        echo ""
        if [ -t 0 ]; then
            read -p "Reinstall? (y/N) " -n 1 -r
            echo ""
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                echo "Installation cancelled."
                exit 0
            fi
        fi
        rm "$INSTALL_DIR/tinyclaw"
    else
        echo -e "${RED}Warning: $INSTALL_DIR/tinyclaw exists but points to a different location${NC}"
        echo "  Current: $EXISTING_TARGET"
        echo "  New:     $WRAPPER"
        echo ""
        if [ -t 0 ]; then
            read -p "Replace it? (y/N) " -n 1 -r
            echo ""
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                echo "Installation cancelled."
                exit 0
            fi
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

# Verify it works — if not in PATH, add it to the shell profile
if command -v tinyclaw &> /dev/null; then
    echo -e "${GREEN}✓ 'tinyclaw' command is available${NC}"
elif [ "$INSTALL_DIR" = "$HOME/.local/bin" ]; then
    # Determine the user's shell profile
    SHELL_NAME="$(basename "$SHELL")"
    SHELL_PROFILE=""
    case "$SHELL_NAME" in
        zsh)  SHELL_PROFILE="$HOME/.zshrc" ;;
        bash)
            if [ -f "$HOME/.bash_profile" ]; then
                SHELL_PROFILE="$HOME/.bash_profile"
            else
                SHELL_PROFILE="$HOME/.bashrc"
            fi
            ;;
        *)    SHELL_PROFILE="$HOME/.profile" ;;
    esac

    PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'

    # Only add if not already present
    if [ -n "$SHELL_PROFILE" ] && ! grep -qF '.local/bin' "$SHELL_PROFILE" 2>/dev/null; then
        echo "" >> "$SHELL_PROFILE"
        echo "# Added by TinyClaw installer" >> "$SHELL_PROFILE"
        echo "$PATH_LINE" >> "$SHELL_PROFILE"
        echo -e "${GREEN}✓ Added ~/.local/bin to PATH in ${SHELL_PROFILE/#$HOME/\~}${NC}"
    fi

    # Also export for the current session
    export PATH="$HOME/.local/bin:$PATH"

    echo -e "${YELLOW}⚠ Restart your terminal or run:  source ${SHELL_PROFILE/#$HOME/\~}${NC}"
else
    echo -e "${YELLOW}⚠ 'tinyclaw' command not found in PATH${NC}"
    echo "  Add $INSTALL_DIR to your PATH."
fi

echo ""
echo "To uninstall, run:"
echo -e "  ${GREEN}./uninstall.sh${NC}"
echo ""
