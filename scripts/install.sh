#!/usr/bin/env bash
# TinyAGI CLI Installation Script
# Installs TinyAGI to ~/.tinyagi and creates global symlinks.
#
# Supports: curl -fsSL <url>/install.sh | bash
# When piped, downloads the release tarball, extracts it, and installs.

set -e

INSTALL_HOME="$HOME/.tinyagi"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# If piped (no BASH_SOURCE path), download and extract first
if [ -z "${BASH_SOURCE[0]}" ] || [ "${BASH_SOURCE[0]}" = "bash" ]; then
    INSTALL_TMPDIR="$(mktemp -d)"
    TARBALL_URL="https://github.com/TinyAGI/tinyagi/releases/latest/download/tinyagi-bundle.tar.gz"
    echo "Downloading TinyAGI..."
    curl -fsSL "$TARBALL_URL" | tar -xz -C "$INSTALL_TMPDIR"
    exec bash "$INSTALL_TMPDIR/tinyagi/scripts/install.sh"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo -e "${BLUE}TinyAGI CLI Installer${NC}"
echo "====================="
echo ""

# Copy project files to ~/.tinyagi (permanent location)
if [ "$PROJECT_ROOT" != "$INSTALL_HOME" ]; then
    echo -e "Installing to: ${GREEN}~/.tinyagi${NC}"
    mkdir -p "$INSTALL_HOME"
    # Copy everything from the extracted/source bundle
    cp -a "$PROJECT_ROOT/." "$INSTALL_HOME/"
    PROJECT_ROOT="$INSTALL_HOME"
    echo -e "  ${GREEN}✓${NC} Files installed to ~/.tinyagi"
else
    echo -e "Updating in: ${GREEN}~/.tinyagi${NC}"
fi

WRAPPER="$PROJECT_ROOT/bin/tinyagi"

# Check if wrapper exists
if [ ! -f "$WRAPPER" ]; then
    echo -e "${RED}Error: Wrapper script not found at $WRAPPER${NC}"
    exit 1
fi

chmod +x "$WRAPPER"
chmod +x "$PROJECT_ROOT/bin/tinyclaw" 2>/dev/null || true
chmod +x "$PROJECT_ROOT/lib/tinyagi.sh" 2>/dev/null || true

# Determine symlink directory
INSTALL_DIR=""

if [ -w "/usr/local/bin" ]; then
    INSTALL_DIR="/usr/local/bin"
    echo -e "Symlinks in: ${GREEN}/usr/local/bin${NC} (system-wide)"
elif [ -d "$HOME/.local/bin" ]; then
    INSTALL_DIR="$HOME/.local/bin"
    echo -e "Symlinks in: ${GREEN}~/.local/bin${NC} (user)"
else
    mkdir -p "$HOME/.local/bin"
    INSTALL_DIR="$HOME/.local/bin"
    echo -e "Symlinks in: ${GREEN}~/.local/bin${NC} (user, created)"
fi

# Install a symlink (removes existing if present)
install_symlink() {
    local name="$1"
    local target="$2"

    if [ -L "$INSTALL_DIR/$name" ]; then
        rm "$INSTALL_DIR/$name"
    elif [ -e "$INSTALL_DIR/$name" ]; then
        echo -e "${RED}Error: $INSTALL_DIR/$name exists but is not a symlink${NC}"
        echo "Please remove it manually and try again."
        return 1
    fi

    ln -s "$target" "$INSTALL_DIR/$name"
    echo -e "  ${GREEN}✓${NC} $name → $target"
}

echo ""
echo "Creating symlinks..."
install_symlink "tinyagi" "$WRAPPER"
install_symlink "tinyclaw" "$WRAPPER"  # backward compat

echo ""
echo -e "${GREEN}✓ TinyAGI CLI installed successfully!${NC}"
echo ""
echo "You can now run 'tinyagi' from any directory:"
echo ""
echo -e "  ${GREEN}tinyagi start${NC}     - Start TinyAGI"
echo -e "  ${GREEN}tinyagi status${NC}    - Check status"
echo -e "  ${GREEN}tinyagi --help${NC}    - Show all commands"
echo ""

# Verify it works — if not in PATH, add it to the shell profile
if command -v tinyagi &> /dev/null; then
    echo -e "${GREEN}✓ 'tinyagi' command is available${NC}"
elif [ "$INSTALL_DIR" = "$HOME/.local/bin" ]; then
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

    if [ -n "$SHELL_PROFILE" ] && ! grep -qF '.local/bin' "$SHELL_PROFILE" 2>/dev/null; then
        echo "" >> "$SHELL_PROFILE"
        echo "# Added by TinyAGI installer" >> "$SHELL_PROFILE"
        echo "$PATH_LINE" >> "$SHELL_PROFILE"
        echo -e "${GREEN}✓ Added ~/.local/bin to PATH in ${SHELL_PROFILE/#$HOME/\~}${NC}"
    fi

    export PATH="$HOME/.local/bin:$PATH"
    echo -e "${YELLOW}⚠ Restart your terminal or run:  source ${SHELL_PROFILE/#$HOME/\~}${NC}"
else
    echo -e "${YELLOW}⚠ 'tinyagi' command not found in PATH${NC}"
    echo "  Add $INSTALL_DIR to your PATH."
fi

echo ""
echo "To uninstall: rm -rf ~/.tinyagi && rm $INSTALL_DIR/tinyagi $INSTALL_DIR/tinyclaw"
echo ""
