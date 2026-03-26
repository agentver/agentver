# Agentver Install — GitHub Action

Install [Agentver](https://agentver.com) skills for AI coding assistants in your CI/CD pipeline.

Reads your `.agentver/manifest.json` and installs all listed skills into the appropriate agent directories, ensuring consistent agent configurations across your team.

## Quick Start

```yaml
- uses: agentver/agentver/packages/github-action@main
  with:
    api-key: ${{ secrets.AGENTVER_API_KEY }}
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `api-key` | Yes | — | Agentver API key for authentication |
| `registry-url` | No | `https://app.agentver.com/api/v1` | Agentver registry URL |
| `manifest-path` | No | `.agentver/manifest.json` | Path to manifest file |
| `lockfile-path` | No | `.agentver/lockfile.json` | Path to lockfile |
| `agents` | No | Auto-detect | Comma-separated list of target agents |
| `working-directory` | No | `.` | Working directory for installation |
| `verify-integrity` | No | `true` | Verify SHA256 integrity of packages |

## Outputs

| Output | Description |
|--------|-------------|
| `installed-count` | Number of skills installed |
| `installed-skills` | JSON array of installed skill names |
| `agents-configured` | Comma-separated list of configured agents |

## Supported Agents

The action auto-detects agents based on configuration files in your repository:

- **Claude Code** / **Claude Cowork** — `.claude/` directory or `CLAUDE.md`
- **Cursor** — `.cursor/` directory or `.cursorrules`
- **GitHub Copilot** — `.github/copilot-instructions.md`
- **OpenAI Codex** — `.agents/` directory or `AGENTS.md`
- **Windsurf** — `.windsurf/` directory or `.windsurfrules`
- **Gemini CLI** — `.gemini/` directory or `GEMINI.md`
- **Roo Code** — `.roo/` directory
- **Goose** — `.goose/` directory
- **JetBrains Junie** — `.junie/` directory
- **Aider** — `.aider/` directory or `.aider.conf.yml`
- **OpenCode** — `.opencode/` directory

## Examples

### Basic usage

```yaml
name: Install Agent Skills
on: [push]
jobs:
  install:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: agentver/agentver/packages/github-action@main
        with:
          api-key: ${{ secrets.AGENTVER_API_KEY }}
```

### Target specific agents

```yaml
- uses: agentver/agentver/packages/github-action@main
  with:
    api-key: ${{ secrets.AGENTVER_API_KEY }}
    agents: 'claude-code,cursor,copilot'
```

### Use outputs in subsequent steps

```yaml
- uses: agentver/agentver/packages/github-action@main
  id: agentver
  with:
    api-key: ${{ secrets.AGENTVER_API_KEY }}

- run: echo "Installed ${{ steps.agentver.outputs.installed-count }} skills"
```

### Disable integrity verification

```yaml
- uses: agentver/agentver/packages/github-action@main
  with:
    api-key: ${{ secrets.AGENTVER_API_KEY }}
    verify-integrity: 'false'
```

## Job Summary

The action generates a GitHub Actions job summary with a markdown table showing each installed skill, its version, target agents, file count, and status.

## Error Handling

- **Missing manifest**: The action warns and exits cleanly (no failure) if `.agentver/manifest.json` does not exist.
- **Authentication errors**: Clear failure message prompting you to check your `AGENTVER_API_KEY`.
- **Network errors**: Descriptive error with the failing URL.
- **Integrity failures**: Reports the expected vs actual hash.
- **Partial failures**: If some packages fail but others succeed, the action warns but does not fail. If all packages fail, the action fails.
