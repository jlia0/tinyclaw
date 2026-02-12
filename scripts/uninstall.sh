#!/usr/bin/env bash
# TinyClaw CLI Uninstallation Script

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}TinyClaw CLI Uninstaller${NC}"
echo "========================"
echo ""

# Check possible installation locations
FOUND=false

for INSTALL_DIR in "/usr/local/bin" "$HOME/.local/bin"; do
    if [ -L "$INSTALL_DIR/tinyclaw" ]; then
        FOUND=true
        TARGET="$(readlink "$INSTALL_DIR/tinyclaw")"

        echo -e "Found TinyClaw at: ${YELLOW}$INSTALL_DIR/tinyclaw${NC}"
        echo -e "Points to: ${YELLOW}$TARGET${NC}"
        echo ""

        read -p "Remove this installation? (y/N) " -n 1 -r
        echo ""

        if [[ $REPLY =~ ^[Yy]$ ]]; then
            rm "$INSTALL_DIR/tinyclaw"
            echo -e "${GREEN}✓ Removed $INSTALL_DIR/tinyclaw${NC}"
        else
            echo "Skipped."
        fi
        echo ""
    fi
done

if [ "$FOUND" = false ]; then
    echo -e "${YELLOW}No TinyClaw installation found${NC}"
    echo ""
    echo "Checked locations:"
    echo "  - /usr/local/bin/tinyclaw"
    echo "  - ~/.local/bin/tinyclaw"
fi

echo -e "${GREEN}Uninstallation complete${NC}"
echo ""
echo "Note: This only removes the CLI symlink."
echo "The TinyClaw installation directory is preserved."
echo ""
