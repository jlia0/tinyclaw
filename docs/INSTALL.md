# TinyClaw Installation Guide

## Quick Install (Recommended)

The fastest way to install TinyClaw:

```bash
curl -fsSL https://raw.githubusercontent.com/jlia0/tinyclaw/main/scripts/remote-install.sh | bash
```

This one-line command:
- ✅ Checks all dependencies (node, npm, tmux, claude)
- ✅ Downloads pre-built bundle (no npm install needed!)
- ✅ Installs to `~/.tinyclaw`
- ✅ Creates global `tinyclaw` command
- ✅ Falls back to source install if no bundle available

**After installation:**
```bash
tinyclaw start
```

## Prerequisites

Before installing, ensure you have:

- **Node.js** v14+ ([nodejs.org](https://nodejs.org/))
- **npm** (comes with Node.js)
- **tmux** - `sudo apt install tmux` or `brew install tmux`
- **Claude Code CLI** ([claude.com/claude-code](https://claude.com/claude-code))

**Optional:**
- **git** (only needed for source install)

## Installation Options

### Option 1: Quick Install (curl)

Best for most users. Downloads and installs everything automatically:

```bash
curl -fsSL https://raw.githubusercontent.com/jlia0/tinyclaw/main/scripts/remote-install.sh | bash
```

**What it does:**
1. Checks dependencies
2. Downloads latest bundle from GitHub Releases
3. Extracts to install directory
4. Creates `tinyclaw` command in PATH
5. Ready to use!

**Install location:**
- `~/.tinyclaw` (user directory)

### Option 2: Manual Bundle Install

Download the pre-built bundle manually:

```bash
# Download latest release
wget https://github.com/jlia0/tinyclaw/releases/latest/download/tinyclaw-bundle.tar.gz

# Extract
tar -xzf tinyclaw-bundle.tar.gz
cd tinyclaw

# Install CLI
./scripts/install.sh

# Start
tinyclaw start
```

### Option 3: From Source

Clone the repository and build locally:

```bash
# Clone
git clone https://github.com/jlia0/tinyclaw.git
cd tinyclaw

# Install dependencies (may take a few minutes)
npm install

# Install CLI globally
./scripts/install.sh

# Start
tinyclaw start
```

### Option 4: Direct Script (No Global CLI)

Run without installing the global command:

```bash
git clone https://github.com/jlia0/tinyclaw.git
cd tinyclaw

npm install

# Run directly
tinyclaw start
```

## Verify Installation

Check if TinyClaw is installed correctly:

```bash
# Check command availability
which tinyclaw

# Check version
tinyclaw status

# View help
tinyclaw
```

## First Run

On first start, TinyClaw will run a setup wizard:

```bash
tinyclaw start
```

You'll configure:
1. **Channel** - Discord, WhatsApp, or both
2. **Discord bot token** (if using Discord)
3. **Claude model** - Sonnet (fast) or Opus (smart)
4. **Heartbeat interval** - How often Claude checks in

Follow the prompts and you're ready!

## Uninstall

To remove TinyClaw:

```bash
# Remove CLI command only
cd /path/to/tinyclaw
./scripts/uninstall.sh

# Or remove everything (CLI + installation)
rm -rf ~/.tinyclaw
sudo rm /usr/local/bin/tinyclaw  # or ~/.local/bin/tinyclaw
```

## Troubleshooting

### Command not found after install

The CLI symlink was created but not in your PATH:

```bash
# Check where it was installed
ls -la /usr/local/bin/tinyclaw  # system-wide
ls -la ~/.local/bin/tinyclaw     # user

# Add to PATH (if using ~/.local/bin)
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### Permission denied

If `/usr/local/bin` is not writable:

```bash
# Option 1: Use sudo for system install
curl -fsSL https://raw.githubusercontent.com/jlia0/tinyclaw/main/scripts/remote-install.sh | sudo bash

# Option 2: Let it install to ~/.local/bin instead
# (installer will do this automatically)
```

### Dependencies missing

Install missing dependencies:

```bash
# Node.js & npm
# Visit: https://nodejs.org/

# tmux
sudo apt install tmux        # Ubuntu/Debian
brew install tmux            # macOS

# Claude Code
# Visit: https://claude.com/claude-code
```

### Bundle download fails

If the pre-built bundle is unavailable:
- The installer automatically falls back to source install
- Requires `git` to be installed
- Will run `npm install` (may take longer)

## Next Steps

After installation:

```bash
# Start TinyClaw
tinyclaw start

# Check status
tinyclaw status

# View logs
tinyclaw logs

# Get help
tinyclaw
```

For more information, see the [main README](README.md).
