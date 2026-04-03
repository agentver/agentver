# Install Latest @agentver/cli Locally for Testing

## Objective

Build the `@agentver/cli` package from source and link it globally so the `agentver` binary resolves to the latest local code in the monorepo.

## Context

| Property | Value |
|---|---|
| **Package** | `@agentver/cli` (v0.3.3) |
| **Location** | `packages/cli/` |
| **Binary** | `agentver` -> `./dist/agentver.js` |
| **Build tool** | `tsup` (entry: `bin/agentver.ts`) |
| **Runtime** | Node >= 20, Bun >= 1.3.0 |
| **Workspace deps bundled** | `@agentver/installer`, `@agentver/storage` (via `noExternal` in tsup config) |

The tsup config at `packages/cli/tsup.config.ts:16` uses `noExternal: [/@agentver\//]`, which means all workspace dependencies are **bundled into the output**. This simplifies local linking since the dist output is self-contained for workspace packages.

## Implementation Plan

- [ ] **Step 1: Install workspace dependencies** — Run `bun install` from the monorepo root (`/home/jaythegeek/code/agentver/agentver`) to ensure all workspace dependencies are resolved and up to date. This is necessary because the CLI depends on `@agentver/installer` and `@agentver/storage` at build time.

- [ ] **Step 2: Build the CLI and its dependencies** — Run `bun run --cwd packages/cli build` (or `turbo build --filter=@agentver/cli` which will also build transitive workspace deps via the `dependsOn: ["^build"]` config in `turbo.json:8`). This compiles `bin/agentver.ts` through tsup into `packages/cli/dist/agentver.js` with all `@agentver/*` workspace packages inlined.

- [ ] **Step 3: Link the CLI globally** — Run `bun link` from `packages/cli/` to register the package globally, then confirm the `agentver` binary is available on PATH. Alternatively, use `bun link --cwd packages/cli` from the monorepo root. This creates a global symlink for the `agentver` bin entry defined in `packages/cli/package.json:6-8`.

- [ ] **Step 4: Verify the installation** — Run `agentver --version` and confirm it outputs `0.3.3` (the current version in `packages/cli/package.json:3`). Optionally run `agentver --help` to verify all commands are registered correctly.

## Verification Criteria

- `bun install` completes without errors
- `packages/cli/dist/agentver.js` exists and starts with `#!/usr/bin/env node`
- `agentver --version` outputs `0.3.3`
- `agentver --help` lists all registered commands (adopt, agents, audit, backup, etc.)

## Exact Commands (Copy-Paste Ready)

```bash
# From monorepo root: /home/jaythegeek/code/agentver/agentver

# 1. Install dependencies
bun install

# 2. Build CLI (turbo handles transitive deps automatically)
bunx turbo build --filter=@agentver/cli

# 3. Link globally
cd packages/cli && bun link && cd ../..

# 4. Verify
agentver --version
agentver --help
```

## Alternative Approaches

1. **Run without linking** — Skip the global link and invoke the CLI directly via `bun run --cwd packages/cli dist/agentver.js` or `node packages/cli/dist/agentver.js`. Trade-off: works immediately but requires the full path each time.
2. **Use `bun run` with workspace script** — Add a script like `"cli": "bun run --cwd packages/cli dist/agentver.js"` to the root `package.json` for convenience without global pollution.
3. **PATH alias** — Add `alias agentver="node /home/jaythegeek/code/agentver/agentver/packages/cli/dist/agentver.js"` to your shell profile for a lightweight alternative to `bun link`.

## Potential Risks and Mitigations

1. **Stale build artifacts** — If `dist/` contains an older build, the linked binary will be outdated.
   Mitigation: tsup config has `clean: true` (`packages/cli/tsup.config.ts:9`), so each build wipes `dist/` first.

2. **Workspace dependency build order** — The CLI bundles `@agentver/installer` and `@agentver/storage`. If these aren't built first, tsup may fail.
   Mitigation: Use `turbo build --filter=@agentver/cli` which respects `dependsOn: ["^build"]` and builds deps first.

3. **Conflicting global installation** — A previously installed npm/bun global `@agentver/cli` could shadow the local link.
   Mitigation: Run `which agentver` after linking to confirm it points to the monorepo's `packages/cli/dist/agentver.js`.
