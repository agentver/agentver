# =============================================================================
# Agentver — Self-Hosted Docker Image
# =============================================================================
# Multi-stage build for self-hosting. Produces a single container running the
# dashboard with automatic database migrations on startup.
#
# Usage:
#   docker compose up -d          (from docker/ directory)
#   docker build -f docker/Dockerfile -t agentver .
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: base — shared Alpine image with Bun
# ---------------------------------------------------------------------------
FROM oven/bun:1.3-alpine AS base

RUN apk add --no-cache libc6-compat python3 make g++

# ---------------------------------------------------------------------------
# Stage 2: deps — install all workspace dependencies
# ---------------------------------------------------------------------------
FROM base AS deps

WORKDIR /app

COPY package.json bun.lock turbo.json ./

COPY apps/dashboard/package.json ./apps/dashboard/package.json
COPY apps/desktop/package.json ./apps/desktop/package.json
COPY apps/website/package.json ./apps/website/package.json
COPY packages/agent-definitions/package.json ./packages/agent-definitions/package.json
COPY packages/cli/package.json ./packages/cli/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/github-action/package.json ./packages/github-action/package.json
COPY packages/mcp-server/package.json ./packages/mcp-server/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/typescript-config/package.json ./packages/typescript-config/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY packages/ui-utils/package.json ./packages/ui-utils/package.json

COPY packages/database/prisma/schema.prisma ./packages/database/prisma/schema.prisma
COPY packages/database/prisma.config.ts ./packages/database/prisma.config.ts

RUN bun install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 3: build — compile everything with Turborepo
# ---------------------------------------------------------------------------
FROM base AS builder

WORKDIR /app

COPY --from=deps /app/ ./
COPY . .

RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" bun run --cwd packages/database db:generate

ENV NODE_ENV=production
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" bun run turbo build --filter=@agentver/dashboard

# ---------------------------------------------------------------------------
# Stage 4: runner — slim production image
# ---------------------------------------------------------------------------
FROM node:24-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"

RUN apt-get update && \
    apt-get install -y --no-install-recommends openssl tini && \
    rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 agentver && \
    useradd --system --uid 1001 --gid agentver agentver

COPY --from=builder --chown=agentver:agentver /app/apps/dashboard/.next/standalone ./
COPY --from=builder --chown=agentver:agentver /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=builder --chown=agentver:agentver /app/apps/dashboard/public ./apps/dashboard/public

COPY --from=builder --chown=agentver:agentver /app/packages/database/generated ./packages/database/generated
COPY --from=builder --chown=agentver:agentver /app/packages/database/package.json ./packages/database/package.json
COPY --from=builder --chown=agentver:agentver /app/packages/database/src ./packages/database/src
COPY --from=builder --chown=agentver:agentver /app/packages/database/prisma ./packages/database/prisma
COPY --from=builder --chown=agentver:agentver /app/packages/database/prisma.config.ts ./packages/database/prisma.config.ts

COPY --from=builder --chown=agentver:agentver /app/docker/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Prisma CLI for running migrations on startup
RUN cd /app && npm install --no-save prisma@7.3.0

USER agentver

EXPOSE 3000

ENTRYPOINT ["tini", "--"]
CMD ["./docker-entrypoint.sh"]
