# Agentver

Open-source skill registry for AI coding assistants. Store, version, and distribute agent skills across 43+ assistants.

<!-- TODO: Add screenshots/demo GIF here -->

## What is Agentver?

Agentver is a skill registry that lets you manage reusable skills, prompts, and configurations for AI coding assistants like Claude Code, Cursor, Windsurf, GitHub Copilot, and more. Install skills from Git repositories, keep them in sync across your team, and share improvements back to the community.

### Key features

- **Skill management** — install, version, update, and track skills from Git repositories
- **MCP server catalogue** — browse and connect MCP servers to your coding assistants
- **Credential vault** — securely store and manage API keys and secrets for your agents
- **Bundles** — group skills into curated collections for specific workflows or stacks
- **Community discovery** — search and browse published skills from the community
- **Self-hosting** — run the full platform on your own infrastructure with Docker
- **Security scanning** — 28 built-in rules detect credential harvesting, prompt injection, and exfiltration

## Self-hosting (Docker)

```bash
git clone https://github.com/agentver/agentver.git
cd agentver/docker
./setup.sh
```

Your dashboard will be available at `http://localhost:3000` within minutes.

See the [`docker/`](./docker) directory for configuration options.

## Cloud

Use the hosted version at [app.agentver.com](https://app.agentver.com) — no setup required.

## CLI quick start

```bash
# Install the CLI
npm install -g @agentver/cli
# or: bun install -g @agentver/cli

# Install a skill from a Git repository
agentver install github.com/owner/repo

# Scan your project for existing agent configs
agentver scan

# Check the status of installed skills
agentver status

# List installed skills
agentver list
```

See the [CLI documentation](./packages/cli/README.md) for the full command reference.

## Repository structure

```
apps/
  dashboard/          # Next.js 16 — web dashboard, skill browser, import gateway
  website/            # Marketing site
  desktop/            # Tauri 2.x desktop app
packages/
  cli/                # @agentver/cli — CLI tool (MIT)
  shared/             # @agentver/shared — schemas, types, validation (MIT)
  agent-definitions/  # @agentver/agent-definitions — 43+ agent configs (MIT)
  mcp-server/         # @agentver/mcp-server — MCP server integration (MIT)
  github-action/      # @agentver/github-action — CI/CD action (MIT)
  database/           # Prisma 7 + PostgreSQL schema
  ui/                 # Radix/shadcn components
  ui-utils/           # Shared UI utilities
  typescript-config/  # Shared TypeScript configs
docker/               # Self-hosting Docker Compose setup
e2e/                  # Playwright end-to-end tests
```

## Tech stack

| Layer | Technology |
| --- | --- |
| Runtime | Bun 1.3+, Node 24.x |
| Language | TypeScript (strict, zero `any`) |
| Framework | Next.js 16 (App Router) |
| API | tRPC 11 |
| Database | PostgreSQL + Prisma 7 |
| Auth | Better Auth |
| Styling | Tailwind CSS 4, Radix/shadcn |
| Validation | Zod 4 |
| Lint/Format | Biome |
| Tests | Vitest, Playwright |
| Build | Turborepo |
| Desktop | Tauri 2.x |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## Licence

- **Platform** (apps, database, UI): [AGPLv3](./LICENSE)
- **CLI packages** (`cli`, `shared`, `agent-definitions`, `mcp-server`, `github-action`): [MIT](./packages/cli/LICENSE)
