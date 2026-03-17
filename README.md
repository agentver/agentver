# Agentver

Store, version, and distribute AI agent skills across 43+ coding assistants. One skill registry for Claude Code, Cursor, Windsurf, GitHub Copilot, and more.

## Self-hosting (Docker)

```bash
git clone https://github.com/agentver/agentver.git
cd agentver/docker
./setup.sh
```

Your dashboard will be available at `http://localhost:3000` within minutes.

## Cloud

Use the hosted version at [app.agentver.com](https://app.agentver.com) — no setup required.

## CLI

```bash
# Install the CLI
bun add -g @agentver/cli

# Install a skill
agentver install @org/skill-name

# List installed skills
agentver list
```

## Repository structure

```
apps/
  dashboard/          # Web dashboard
  website/            # Marketing site
  desktop/            # Desktop app
packages/
  cli/                # @agentver/cli
  shared/             # Shared schemas and types
  agent-definitions/  # Agent detection for 43+ assistants
  mcp-server/         # MCP server for AI assistants
  github-action/      # CI/CD GitHub Action
  database/           # Prisma schema
  ui/                 # UI components
docker/               # Self-hosting configuration
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## Licence

- CLI packages (`packages/cli`, `packages/shared`, `packages/agent-definitions`, `packages/mcp-server`, `packages/github-action`): [MIT](./packages/cli/LICENSE)
- Platform: [AGPLv3](./LICENSE)
