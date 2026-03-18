<p align="center">
  <img src="apps/website/public/logo.png" alt="Agentver" height="80" />
</p>

<h1 align="center">agentver</h1>

<p align="center">
  <strong>Team-grade skill management for AI coding assistants.</strong><br />
  Version, audit, and deploy skills to 43+ assistants — with access control, security scanning, and a review workflow built in.
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

Agentver is an open-source platform for managing agent skills across teams. Write a skill once and deploy it to every assistant your team uses — Claude Code, Cursor, Windsurf, GitHub Copilot, Gemini CLI, and 38 more — with consistent versioning, access control, and security scanning built in.

It is designed for teams: from engineers who want reproducible agent configurations, to technical leads who need to control what skills are deployed and by whom, to non-technical contributors who can create and share skills through the web dashboard without touching a config file.

### Key features

- **Team management** — role-based access control (owner, admin, member, viewer) with org and sub-team structure, invitation workflows, and a full audit log
- **43+ agent support** — one skill, every assistant; auto-detects installed agents and places files in the right location
- **Git-native versioning** — semantic versions, commit SHAs, lockfiles, and manifest files committed to your repo so teams stay in sync
- **Security scanning** — 75 built-in detection rules across 9 threat categories; runs locally with no external API calls; blocks installs on HIGH or CRITICAL findings
- **Credential vault** — AES-256-GCM encrypted secrets with team/org sharing, rotation policies, expiry, and access logs
- **Bundles** — group skills, MCP servers, scripts, and config into installable workflow collections
- **MCP server catalogue** — browse and connect MCP servers to your coding assistants, bundled with skills for one-command setup
- **Change proposals** — PR-style review workflow for proposing and approving improvements to shared skills
- **Community discovery** — search and browse published skills from the community
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

# Audit installed skills for security issues
agentver audit

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

## Security scanning

Every skill install is scanned automatically before any file is written to disk. The built-in scanner runs entirely locally — no external API calls, no data leaving your machine.

**75 detection rules across 9 categories:**

| Category | Examples |
| --- | --- |
| Dangerous commands | `rm -rf`, `sudo`, `eval()`, `child_process`, `spawn()`, `execSync()` |
| Data exfiltration | `curl -X POST`, `fetch` with body, `ngrok`, `netcat`, `process.env` access, DNS exfil |
| Credential exposure | AWS keys, GitHub PATs, GCP service accounts, Slack tokens, hardcoded secrets |
| Credential files | `.aws/credentials`, `.ssh/id_rsa`, `.kube/config`, `.npmrc` auth tokens |
| Remote code execution | `import()` over HTTP, `require()` over HTTP, `eval(fetch(...))` |
| Obfuscated code | Base64 blobs, hex escape chains, `String.fromCharCode`, `atob()`/`btoa()` |
| Unicode obfuscation | Zero-width characters, right-to-left override, Unicode tag block (U+E0000), variation selectors — invisible codepoints that render as blank in editors |
| Prompt injection | Instruction override patterns, persona replacement, jailbreak strings |
| Suspicious URLs | Pastebin, Discord webhooks, URL shorteners |

**Verdicts:** `PASS` (proceed) · `WARN` (confirm before install) · `BLOCK` (halted — fix before retrying)

The scanner uses deterministic rule-based pattern matching, not AI analysis — it cannot be manipulated by a skill that embeds a prompt injection string to trick an AI reviewer.

You can configure trusted source patterns to skip scanning for your own verified repositories, and adjust the block severity threshold in `.agentver/config.yaml`.

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

## FAQ

**Is this just npm for prompts?**

No. npm is a package registry for code. Agentver is a team management platform for agent skills. The differences that matter for teams: role-based access control so you can control who publishes and installs skills; git-native versioning with lockfiles so your whole team installs the same version; a security scanner that blocks malicious skills before they touch disk; an encrypted credential vault for API keys used by MCP servers; and a change proposal workflow so skills can be reviewed before they're deployed. A prompt file in a git repo solves a different problem.

**Does this overlap with GitHub Actions?**

No. GitHub Actions is a CI/CD pipeline runner — it executes scripts when you push code. Agentver manages *what your AI assistants know and can do*, which is a separate concern. The two work well together: use the [Agentver GitHub Action](./packages/github-action) to keep skills in sync as part of your CI pipeline.

**How do you keep up when agents like Claude, Cursor, and Windsurf update their formats?**

Each agent's configuration paths and file formats are defined in a data layer ([`packages/agent-definitions`](./packages/agent-definitions)). When an agent changes its config format or adds a new path, we update one entry — the skill content itself doesn't change. Skills declare which agents they target; the platform handles translation and placement. Adding support for a brand new agent is a data change, not an architectural one.

**How is this different from LangChain Hub or Smithery?**

LangChain Hub is a prompt store for LangChain-specific chains. Smithery is an MCP server marketplace. Neither manages cross-agent skill distribution, team permissions, security scanning, credential storage, or version lockfiles. Agentver is closest to a private package registry combined with a team configuration manager — the goal is consistency and control across an entire engineering team, not just individual developer tooling.

**Is the security scanner actually reliable?**

The scanner has 75 deterministic rules covering dangerous commands, data exfiltration, credential exposure, code obfuscation, Unicode-based evasion techniques, prompt injection, and remote code execution. It is not AI-based — it uses rule-based pattern matching, which means it cannot be fooled by a prompt injection payload designed to manipulate an AI reviewer. No static scanner is exhaustive, and we say that plainly: it is a defence-in-depth layer, not a replacement for code review. The rules, verdicts, and configuration are all open source — you can read exactly what it checks.

**Can I self-host?**

Yes. The full platform runs on Docker Compose. See the [`docker/`](./docker) directory. The CLI packages are MIT-licensed and work completely standalone without any platform connection.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## Licence

- **Platform** (apps, database, UI): [AGPLv3](./LICENSE)
- **CLI packages** (`cli`, `shared`, `agent-definitions`, `mcp-server`, `github-action`): [MIT](./packages/cli/LICENSE)
