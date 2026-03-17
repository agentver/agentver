# @agentver/mcp-server

MCP server for Agentver — discover, install, and manage agent skills from AI coding assistants via the [Model Context Protocol](https://modelcontextprotocol.io/).

## Install

```bash
# npm
npm install -g @agentver/mcp-server

# bun
bun install -g @agentver/mcp-server

# pnpm
pnpm add -g @agentver/mcp-server

# or run directly without installing
npx @agentver/mcp-server
bunx @agentver/mcp-server
```

## Usage

Start the MCP server:

```bash
agentver-mcp
```

### Claude Desktop configuration

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "agentver": {
      "command": "agentver-mcp"
    }
  }
}
```

### Claude Code configuration

```bash
claude mcp add agentver agentver-mcp
```

## What it provides

The MCP server exposes Agentver's skill registry to any MCP-compatible AI assistant, enabling:

- **Skill discovery** — search and browse available skills
- **Skill installation** — install skills directly from your assistant
- **Status checks** — view installed skills and pending updates
- **Security scanning** — audit skills for known vulnerability patterns

## Requirements

- Node.js >= 20

## Related

- [@agentver/cli](https://www.npmjs.com/package/@agentver/cli) — command-line interface
- [Agentver](https://github.com/agentver/agentver) — full platform repository
- [agentver.com](https://agentver.com) — project website

## Licence

MIT
