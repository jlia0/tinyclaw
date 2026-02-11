#!/usr/bin/env bash
# TinyClaw Bundle Creator
# Creates a distributable tarball with all dependencies pre-installed

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     TinyClaw Bundle Creator           ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Get version from package.json or use git tag
if [ -f "package.json" ]; then
    VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
else
    VERSION="unknown"
fi

# Check if git tag exists
GIT_TAG=$(git describe --tags --exact-match 2>/dev/null || echo "")
if [ -n "$GIT_TAG" ]; then
    VERSION="$GIT_TAG"
fi

BUNDLE_NAME="tinyclaw-bundle-${VERSION}.tar.gz"
TEMP_DIR=$(mktemp -d)
BUNDLE_DIR="$TEMP_DIR/tinyclaw"

echo -e "${BLUE}Version: ${GREEN}$VERSION${NC}"
echo -e "${BLUE}Output: ${GREEN}$BUNDLE_NAME${NC}"
echo ""

# Step 1: Clean build
echo -e "${BLUE}[1/5] Cleaning workspace...${NC}"
rm -rf dist/
rm -rf node_modules/
rm -rf .tinyclaw/
rm -rf .wwebjs_cache/
echo -e "${GREEN}✓ Cleaned${NC}"
echo ""

# Step 2: Install dependencies for build
echo -e "${BLUE}[2/5] Installing dependencies...${NC}"
echo "This may take a few minutes..."
PUPPETEER_SKIP_DOWNLOAD=true npm install --silent
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

# Step 3: Build TypeScript
echo -e "${BLUE}[3/5] Building TypeScript...${NC}"
npm run build --silent
echo -e "${GREEN}✓ Build complete${NC}"
echo ""

# Step 4: Create bundle directory
echo -e "${BLUE}[4/5] Creating bundle...${NC}"

# Keep runtime bundle lean: remove development-only dependencies after build.
npm prune --omit=dev --silent

mkdir -p "$BUNDLE_DIR"

# Copy necessary files
echo "Copying files..."
cp -r bin/ "$BUNDLE_DIR/"
cp -r src/ "$BUNDLE_DIR/"
cp -r dist/ "$BUNDLE_DIR/"
cp -r node_modules/ "$BUNDLE_DIR/"

cp tinyclaw.sh "$BUNDLE_DIR/"
cp -r scripts "$BUNDLE_DIR/"
cp -r lib "$BUNDLE_DIR/"

cp package.json "$BUNDLE_DIR/"
cp package-lock.json "$BUNDLE_DIR/"
cp tsconfig.json "$BUNDLE_DIR/"
cp README.md "$BUNDLE_DIR/"
cp .gitignore "$BUNDLE_DIR/"

# Copy license if exists
[ -f "LICENSE" ] && cp LICENSE "$BUNDLE_DIR/"

# Make scripts executable
chmod +x "$BUNDLE_DIR/bin/tinyclaw"
chmod +x "$BUNDLE_DIR/tinyclaw.sh"
chmod +x "$BUNDLE_DIR/scripts/install.sh"
chmod +x "$BUNDLE_DIR/scripts/uninstall.sh"
chmod +x "$BUNDLE_DIR/scripts/bundle.sh"
chmod +x "$BUNDLE_DIR/scripts/remote-install.sh"
chmod +x "$BUNDLE_DIR/lib/setup-wizard.sh"
chmod +x "$BUNDLE_DIR/lib/heartbeat-cron.sh"

echo -e "${GREEN}✓ Files copied${NC}"
echo ""

# Step 5: Create tarball
echo -e "${BLUE}[5/5] Creating tarball...${NC}"
cd "$TEMP_DIR"
tar -czf "$SCRIPT_DIR/$BUNDLE_NAME" tinyclaw/

cd "$SCRIPT_DIR"
rm -rf "$TEMP_DIR"

BUNDLE_SIZE=$(du -h "$BUNDLE_NAME" | cut -f1)
echo -e "${GREEN}✓ Bundle created: $BUNDLE_NAME ($BUNDLE_SIZE)${NC}"
echo ""

echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║      Bundle Created Successfully!     ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo "Bundle location: $SCRIPT_DIR/$BUNDLE_NAME"
echo "Bundle size: $BUNDLE_SIZE"
echo ""
echo "Upload to GitHub Release:"
echo "  1. Create a new release: https://github.com/jlia0/tinyclaw/releases/new"
echo "  2. Upload: $BUNDLE_NAME"
echo "  3. Remote install will automatically use it!"
echo ""
echo "Test bundle locally:"
echo "  mkdir test-install"
echo "  tar -xzf $BUNDLE_NAME -C test-install --strip-components=1"
echo "  cd test-install && ./scripts/install.sh"
echo ""
