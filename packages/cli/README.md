# @agentver/cli

Agent skill registry — store, version, and distribute AI agent skills across 43+ coding assistants.

Agentver is a CLI for managing reusable skills, prompts, and configurations across AI coding agents like Claude Code, Cursor, Windsurf, Copilot, and more. Install skills from Git repositories or community marketplaces, keep them in sync, and share improvements back.

**Platform:** [app.agentver.com](https://app.agentver.com) | **Source:** [github.com/agentver/agentver](https://github.com/agentver/agentver)

## Install

```bash
# npm
npm install -g @agentver/cli

# bun
bun install -g @agentver/cli

# pnpm
pnpm add -g @agentver/cli

# or run directly without installing
npx @agentver/cli
bunx @agentver/cli
pnpm dlx @agentver/cli
```

## Quick start

```bash
# Install a skill from a Git repository
agentver install github.com/owner/repo

# Install from a subdirectory
agentver install github.com/owner/repo/path/to/skill

# Search for skills
agentver search "code review"

# Scan your project for existing agent configs
agentver scan

# Adopt existing configs into agentver management
agentver adopt

# Check the status of installed skills
agentver status

# Connect to the Agentver platform
agentver login
```

## Commands

### Core

| Command | Description |
| --- | --- |
| `install <source>` | Install a skill from a Git repository, well-known domain, or registry |
| `remove <name>` | Remove an installed package (alias: `uninstall`) |
| `update` | Update installed skills to their latest upstream version |
| `list` | Show installed packages |
| `status` | Show status of installed skills (upstream changes, local modifications) |
| `sync` | Push local installation state to platform |

### Discovery

| Command | Description |
| --- | --- |
| `search <query>` | Search for skills across registries (platform, skills.sh, well-known) |
| `info <package>` | Show detailed information about a package |
| `scan` | Scan directory for agent configs and skills |
| `adopt` | Adopt existing skills and configs into agentver management |

### Authoring

| Command | Description |
| --- | --- |
| `init` | Scaffold a new package (skill, agent config, plugin, script, or prompt) |
| `save` | Commit local skill changes to the platform |
| `publish` | Publish a skill to the registry |
| `suggest <title>` | Create a suggestion from local modifications |
| `suggestions` | List suggestions for a skill |
| `draft` | Manage skill drafts (branches) |
| `version` | Manage skill versions (tags) |
| `diff <name>` | Show diff between local and upstream version of a skill |
| `log <name>` | Show commit history for a skill |

### Security

| Command | Description |
| --- | --- |
| `audit` | Run a security scan on installed skills or an arbitrary directory |
| `verify <name>` | Verify a skill — checks publisher, integrity, and security |

### Account

| Command | Description |
| --- | --- |
| `login` | Authenticate with the Agentver platform |
| `logout` | Log out from the Agentver platform |
| `whoami` | Show authentication state |

### Configuration

| Command | Description |
| --- | --- |
| `config` | Get, set, list, or reset CLI configuration |
| `pin <name>` | Pin a package to prevent automatic updates |
| `unpin <name>` | Unpin a package to allow updates |
| `doctor` | Diagnose environment issues (checks dependencies, connectivity, config) |
| `upgrade` | Self-update the CLI to the latest version |
| `completion` | Generate shell completions (bash, zsh, fish) |

Use `agentver <command> --help` for detailed usage of any command.

## Global options

```
--json    Output results as structured JSON
--help    Show help
--version Show version
```

## Supported agents

Agentver automatically detects which AI coding agents are present in your project and places skills in the correct location:

- Claude Code (`.claude/`)
- Cursor (`.cursor/rules/`)
- Windsurf (`.windsurfrules/`)
- GitHub Copilot (`.github/copilot/`)
- OpenAI Codex (`.codex/`)
- Aider (`.aider/`)
- Cline (`.cline/rules/`)
- Roo Code (`.roo/rules/`)
- Zencoder, Tabnine, Sourcegraph Cody, and [40+ more](https://github.com/agentver/agentver/blob/main/packages/agent-definitions/src/agents/definitions.ts)

## Security

Every skill is scanned on install using 28 built-in security rules that check for:

- Credential harvesting and secret exfiltration
- Command injection and shell escape patterns
- Instruction override and prompt injection
- Unsafe network access and data exfiltration
- File system abuse and path traversal

Run `agentver audit` at any time to re-scan your installed skills.

## How it works

1. **Install** — fetches skill files from a Git repository (via API, archive, or sparse checkout)
2. **Place** — detects your agents and writes files to the correct config directories
3. **Track** — records the source, version, and integrity hash in a manifest and lockfile
4. **Sync** — keeps skills up to date with upstream and tracks local modifications

The manifest (`agentver.json`) and lockfile (`agentver-lock.json`) are designed to be committed to your repository so your team stays in sync.

## Well-known domains

Repositories can advertise their skills via a `/.well-known/skills/index.json` endpoint, enabling `agentver install example.com` to resolve skills automatically.

## Licence

MIT — see [LICENSE](./LICENSE)
