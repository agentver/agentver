#!/usr/bin/env bash
# =============================================================================
# Agentver — Docker Entrypoint
# =============================================================================
# Runs database migrations then starts the Next.js server.
# =============================================================================
set -e

echo "Running database migrations..."
cd /app && npx prisma migrate deploy --schema packages/database/prisma/schema.prisma

echo "Starting Agentver..."
exec node apps/dashboard/server.js
