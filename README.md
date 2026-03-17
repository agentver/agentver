<p align="center">
  <img src="apps/website/public/logo.png" alt="Agentver" height="80" />
</p>

<h1 align="center">agentver</h1>

<p align="center">
  <strong>The skill registry for AI coding assistants.</strong><br />
  Store, version, and distribute agent skills across 43+ assistants.
</p>

<p align="center">
  <a href="https://agentver.com">Website</a> &middot;
  <a href="https://app.agentver.com">Platform</a> &middot;
  <a href="https://agentver.com/docs">Docs</a> &middot;
  <a href="https://agentver.com/docs/quickstart">Quick Start</a>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/licence-AGPLv3-blue" alt="Licence" /></a>
  <a href="./packages/cli/LICENSE"><img src="https://img.shields.io/badge/CLI-MIT-green" alt="CLI Licence" /></a>
  <a href="https://www.npmjs.com/package/@agentver/cli"><img src="https://img.shields.io/npm/v/@agentver/cli" alt="npm" /></a>
</p>

---

## What is Agentver?

Agentver is an open-source skill registry that lets you manage reusable skills, prompts, and configurations for AI coding assistants — Claude Code, Cursor, Windsurf, GitHub Copilot, Gemini CLI, and 38 more. Install skills from Git repositories, keep them in sync across your team, and share improvements back to the community.

### Key features

- **Skill management** — install, version, update, and track skills from Git repositories
- **43+ agent support** — one skill, every assistant
- **MCP server catalogue** — browse and connect MCP servers to your coding assistants
- **Credential vault** — securely store and manage API keys and secrets for your agents
- **Bundles** — group skills into curated collections for specific workflows or stacks
- **Community discovery** — search and browse published skills from the community
- **Security scanning** — 28 built-in rules detect credential harvesting, prompt injection, and exfiltration
- **Self-hosting** — run the full platform on your own infrastructure with Docker

## Quick start

### CLI

```bash
# Install
npm install -g @agentver/cli
# or: bun install -g @agentver/cli

# Install a skill from a Git repository
agentver install github.com/owner/repo

# Scan your project for existing agent configs
agentver scan

# Check status of installed skills
agentver status

# List installed skills
agentver list
```

See the [CLI documentation](./packages/cli/README.md) for the full command reference.

### Self-hosting (Docker)

```bash
git clone https://github.com/agentver/agentver.git
cd agentver/docker
./setup.sh
```

Your dashboard will be available at `http://localhost:3000` within minutes. See the [`docker/`](./docker) directory for configuration options.

### Cloud

Use the hosted version at [app.agentver.com](https://app.agentver.com) — no setup required.

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
