#!/usr/bin/env bash
# Update management for TinyClaw

# GitHub repository info
GITHUB_REPO="jlia0/tinyclaw"
UPDATE_CHECK_CACHE="$HOME/.tinyclaw/.update_check"
UPDATE_CHECK_TTL=3600  # Check once per hour

# Get current version
get_current_version() {
    if [ -f "$SCRIPT_DIR/package.json" ]; then
        # Try to extract version from package.json
        if command -v jq &> /dev/null; then
            jq -r '.version' "$SCRIPT_DIR/package.json" 2>/dev/null || echo "unknown"
        else
            grep '"version"' "$SCRIPT_DIR/package.json" | head -1 | sed 's/.*"version": "\(.*\)".*/\1/' || echo "unknown"
        fi
    else
        echo "unknown"
    fi
}

# Get latest version from GitHub
get_latest_version() {
    if ! command -v curl &> /dev/null; then
        return 1
    fi

    # Query GitHub API for latest release
    local response
    response=$(curl -sS -m 5 "https://api.github.com/repos/$GITHUB_REPO/releases/latest" 2>/dev/null)

    if [ $? -ne 0 ] || [ -z "$response" ]; then
        return 1
    fi

    # Extract version tag
    if command -v jq &> /dev/null; then
        echo "$response" | jq -r '.tag_name' 2>/dev/null | sed 's/^v//'
    else
        echo "$response" | grep -o '"tag_name": *"[^"]*"' | sed 's/"tag_name": *"v\{0,1\}\([^"]*\)"/\1/'
    fi
}

# Compare versions (returns 0 if v1 < v2)
version_lt() {
    local v1="$1"
    local v2="$2"

    # Simple numeric comparison (assumes semantic versioning)
    [ "$v1" != "$v2" ] && [ "$(printf '%s\n' "$v1" "$v2" | sort -V | head -n1)" = "$v1" ]
}

# Check if update is available (with caching)
check_for_updates() {
    local force="${1:-false}"

    # Skip if disabled
    if [ "${TINYCLAW_SKIP_UPDATE_CHECK:-}" = "1" ]; then
        return 1
    fi

    # Check cache unless forced
    if [ "$force" != "true" ] && [ -f "$UPDATE_CHECK_CACHE" ]; then
        local cache_age=$(( $(date +%s) - $(stat -f %m "$UPDATE_CHECK_CACHE" 2>/dev/null || stat -c %Y "$UPDATE_CHECK_CACHE" 2>/dev/null || echo 0) ))
        if [ "$cache_age" -lt "$UPDATE_CHECK_TTL" ]; then
            # Use cached result
            if [ -s "$UPDATE_CHECK_CACHE" ]; then
                cat "$UPDATE_CHECK_CACHE"
                return 0
            else
                return 1
            fi
        fi
    fi

    local current_version=$(get_current_version)
    local latest_version=$(get_latest_version)

    if [ -z "$latest_version" ] || [ "$latest_version" = "null" ]; then
        # Failed to fetch, clear cache
        rm -f "$UPDATE_CHECK_CACHE"
        return 1
    fi

    # Cache the result
    mkdir -p "$(dirname "$UPDATE_CHECK_CACHE")"

    if version_lt "$current_version" "$latest_version"; then
        # Update available
        echo "$current_version|$latest_version" > "$UPDATE_CHECK_CACHE"
        echo "$current_version|$latest_version"
        return 0
    else
        # No update available
        : > "$UPDATE_CHECK_CACHE"  # Empty cache file
        return 1
    fi
}

# Show update notification
show_update_notification() {
    local current_version="$1"
    local latest_version="$2"

    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}⚡ Update Available!${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "  Current: ${RED}v${current_version}${NC}"
    echo -e "  Latest:  ${GREEN}v${latest_version}${NC}"
    echo ""
    echo -e "  Update:  ${GREEN}tinyclaw update${NC}"
    echo -e "  Changes: ${BLUE}https://github.com/$GITHUB_REPO/releases/v${latest_version}${NC}"
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# Perform update
do_update() {
    echo -e "${BLUE}TinyClaw Update${NC}"
    echo "==============="
    echo ""

    # Check if running
    if session_exists; then
        echo -e "${YELLOW}Warning: TinyClaw is currently running${NC}"
        echo ""
        read -rp "Stop and update? [y/N]: " CONFIRM
        if [[ ! "$CONFIRM" =~ ^[yY] ]]; then
            echo "Update cancelled."
            return 1
        fi
        echo ""
        stop_daemon
        echo ""
    fi

    # Get versions
    local current_version=$(get_current_version)
    echo -e "Current version: ${YELLOW}v${current_version}${NC}"

    echo "Checking for updates..."
    local latest_version=$(get_latest_version)

    if [ -z "$latest_version" ] || [ "$latest_version" = "null" ]; then
        echo -e "${RED}Error: Could not fetch latest version${NC}"
        echo "Check your internet connection or visit:"
        echo "  https://github.com/$GITHUB_REPO/releases"
        return 1
    fi

    echo -e "Latest version:  ${GREEN}v${latest_version}${NC}"
    echo ""

    if ! version_lt "$current_version" "$latest_version"; then
        echo -e "${GREEN}✓ Already up to date!${NC}"
        return 0
    fi

    # Show changelog URL
    echo -e "${BLUE}Release notes:${NC}"
    echo "  https://github.com/$GITHUB_REPO/releases/v${latest_version}"
    echo ""

    read -rp "Update to v${latest_version}? [y/N]: " CONFIRM
    if [[ ! "$CONFIRM" =~ ^[yY] ]]; then
        echo "Update cancelled."
        return 1
    fi

    echo ""
    echo "Updating..."
    echo ""

    # Download bundle
    local bundle_url="https://github.com/$GITHUB_REPO/releases/download/v${latest_version}/tinyclaw-bundle.tar.gz"
    local temp_dir=$(mktemp -d)
    local bundle_file="$temp_dir/tinyclaw-bundle.tar.gz"

    echo -e "${BLUE}[1/4] Downloading...${NC}"
    if ! curl -fSL -o "$bundle_file" "$bundle_url" 2>&1 | grep -v "^  "; then
        echo -e "${RED}Error: Download failed${NC}"
        rm -rf "$temp_dir"
        return 1
    fi
    echo -e "${GREEN}✓ Downloaded${NC}"
    echo ""

    # Backup current installation
    echo -e "${BLUE}[2/4] Backing up current installation...${NC}"
    local backup_dir="$HOME/.tinyclaw/backups/v${current_version}-$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$backup_dir"

    # Backup key files (not .tinyclaw data)
    cp -r "$SCRIPT_DIR/bin" "$backup_dir/" 2>/dev/null || true
    cp -r "$SCRIPT_DIR/src" "$backup_dir/" 2>/dev/null || true
    cp -r "$SCRIPT_DIR/dist" "$backup_dir/" 2>/dev/null || true
    cp -r "$SCRIPT_DIR/lib" "$backup_dir/" 2>/dev/null || true
    cp "$SCRIPT_DIR/tinyclaw.sh" "$backup_dir/" 2>/dev/null || true
    cp "$SCRIPT_DIR/package.json" "$backup_dir/" 2>/dev/null || true

    echo -e "${GREEN}✓ Backed up to: $backup_dir${NC}"
    echo ""

    # Extract new version
    echo -e "${BLUE}[3/4] Installing new version...${NC}"
    cd "$temp_dir"
    tar -xzf "$bundle_file"

    # Copy all bundle files into install dir.
    # User data (settings.json, queue/, logs/, etc.) is not in the bundle
    # so it won't be overwritten.
    cp -a tinyclaw/. "$SCRIPT_DIR/"

    # Make scripts executable
    find "$SCRIPT_DIR/bin" "$SCRIPT_DIR/lib" "$SCRIPT_DIR/scripts" \
        -type f \( -name "*.sh" -o -name "tinyclaw" \) -exec chmod +x {} +
    chmod +x "$SCRIPT_DIR/tinyclaw.sh"

    rm -rf "$temp_dir"

    echo -e "${GREEN}✓ Installed${NC}"
    echo ""

    # Clear update cache
    rm -f "$UPDATE_CHECK_CACHE"

    echo -e "${BLUE}[4/4] Update complete!${NC}"
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║   Updated to v${latest_version}!${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
    echo ""
    echo "Backup location: $backup_dir"
    echo ""
    echo "Start TinyClaw:"
    echo -e "  ${GREEN}tinyclaw start${NC}"
    echo ""
}
