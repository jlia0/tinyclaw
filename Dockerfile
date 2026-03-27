FROM node:20-slim AS builder

# Install build dependencies for better-sqlite3 native module
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package.json ./
COPY packages/core/package.json packages/core/
COPY packages/main/package.json packages/main/
COPY packages/server/package.json packages/server/
COPY packages/teams/package.json packages/teams/
COPY packages/channels/package.json packages/channels/
COPY packages/cli/package.json packages/cli/
COPY packages/visualizer/package.json packages/visualizer/

ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm install

# Copy source and build
COPY tsconfig.json tsconfig.base.json ./
COPY packages/ packages/
COPY .agents/ .agents/
COPY AGENTS.md heartbeat.md SOUL.md ./
RUN npm run build

# Prune dev dependencies
RUN npm prune --omit=dev

# --- Production stage ---
FROM node:20-slim

# Install runtime dependencies:
#   chromium - for WhatsApp (Puppeteer) and agent-browser (Playwright)
#   git - for agent CLIs
RUN apt-get update && apt-get install -y \
    git \
    chromium \
    && rm -rf /var/lib/apt/lists/*

# Point Puppeteer (whatsapp-web.js) at system Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install AI CLIs and browser automation globally
RUN npm install -g @anthropic-ai/claude-code @openai/codex agent-browser 2>/dev/null || true

# Install Playwright browsers (shares OS deps with system Chromium)
RUN npx playwright install chromium 2>/dev/null || true

WORKDIR /app

# Copy built app from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/package.json ./
COPY --from=builder /app/tsconfig.base.json ./
COPY --from=builder /app/.agents ./.agents
COPY --from=builder /app/AGENTS.md /app/heartbeat.md /app/SOUL.md ./

# Persistent data directory
RUN mkdir -p /root/.tinyagi /root/workspace
ENV TINYAGI_HOME=/root/.tinyagi
ENV NODE_ENV=production
ENV TINYAGI_API_PORT=3777

EXPOSE 3777

COPY docker-entrypoint.sh ./
ENTRYPOINT ["./docker-entrypoint.sh"]
