# TinyClaw Development Container
# Based on the official devcontainer TypeScript-Node image (Debian bookworm, Bash 5+)

FROM mcr.microsoft.com/devcontainers/typescript-node:22

# Install runtime tools required by tinyclaw shell scripts
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        tmux \
        jq \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
