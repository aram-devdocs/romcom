# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.14.2 --activate

# Copy package files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY tsconfig.base.json ./
COPY packages/shared/ ./packages/shared/
COPY apps/server/ ./apps/server/

# Build shared package first, then server
RUN pnpm --filter @n64-stream/shared build
RUN pnpm --filter @n64-stream/server build

# Production stage
FROM node:20-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    mupen64plus-core \
    mupen64plus-video-rice \
    mupen64plus-audio-sdl \
    mupen64plus-input-sdl \
    mupen64plus-rsp-hle \
    ffmpeg \
    xvfb \
    x11vnc \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.14.2 --activate

# Copy package files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built files
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/server/dist ./apps/server/dist

# Create directories
RUN mkdir -p /roms /savestates

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV MUPEN_PLUGIN_PATH=/usr/lib/mupen64plus

# Expose port
EXPOSE 3000

# Start server
WORKDIR /app/apps/server
CMD ["node", "dist/index.js"]
