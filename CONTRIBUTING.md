# Contributing to Agentver

Thank you for your interest in contributing to Agentver!

## Repository structure

```
apps/
  dashboard/          # Next.js platform dashboard (AGPLv3)
  website/            # Marketing site (AGPLv3)
  desktop/            # Tauri desktop app (AGPLv3)
packages/
  cli/                # @agentver/cli (MIT)
  shared/             # @agentver/shared (MIT)
  agent-definitions/  # @agentver/agent-definitions (MIT)
  mcp-server/         # @agentver/mcp-server (MIT)
  github-action/      # @agentver/github-action (MIT)
  database/           # Prisma schema (AGPLv3)
  ui/                 # UI components (AGPLv3)
  ui-utils/           # Tailwind utilities (AGPLv3)
  typescript-config/  # Shared TS config
docker/               # Self-hosting configuration
```

## Local development setup

```bash
# Prerequisites: Bun 1.3+, Node 24+, Docker (for PostgreSQL)

git clone https://github.com/agentver/agentver.git
cd agentver

bun install

# Start PostgreSQL
docker compose up -d

# Set up environment
cp .env.example .env
# Edit .env with your values

# Generate Prisma client and run migrations
bun run db:generate
bun run db:migrate:dev

# Start the dashboard
bun run dev
```

## Licence model

| Directory | Licence |
|-----------|---------|
| `packages/cli/`, `packages/shared/`, `packages/agent-definitions/`, `packages/mcp-server/`, `packages/github-action/` | MIT |
| `apps/`, `packages/database/`, `packages/ui/`, `packages/ui-utils/` | AGPLv3 |

### CLI package contributions (MIT)

Contributions to MIT-licensed packages require a DCO (Developer Certificate of Origin) sign-off:

```bash
git commit -s -m "your commit message"
```

### Platform contributions (AGPLv3)

Contributions to the platform require a CLA (Contributor Licence Agreement). The CLA bot will guide you through this process on your first pull request.

## Code standards

- **British English** everywhere (code, comments, naming, docs)
- **TypeScript strict** — zero `any` types
- **Biome** for linting and formatting (`bun run check`)
- **Vitest** for tests (`bun run test`)
- Files: `kebab-case`. Components/Types: `PascalCase`. Functions: `camelCase`
- No console.logs — use the logger from `@agentver/shared`
- No commented-out code
- No new dependencies without discussion in the PR

## Pull request process

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Run `bun run check` and `bun run test`
5. Submit a PR with a clear description
6. Address review feedback
