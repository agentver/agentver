/**
 * E2E test helpers for running the CLI binary and seeding project state.
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GitSource, LockfileV2Package, ManifestV2Package } from '@agentver/shared'
import { createAgentSymlinks, getCanonicalSkillPath } from '../../storage/canonical'
import { computeSha256FromFiles } from '../../storage/integrity'
import { readLockfile, writeLockfile } from '../../storage/lockfile'
import { readManifest, writeManifest } from '../../storage/manifest'

/**
 * Walk up from the current file to find the CLI package root
 * (the directory containing both package.json and tsup.config.ts).
 */
export function findCliRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'tsup.config.ts'))) {
      return dir
    }
    dir = dirname(dir)
  }
  throw new Error('Could not find CLI package root')
}

export const CLI_ROOT = findCliRoot()
export const CLI_BIN_PATH = resolve(CLI_ROOT, 'dist/agentver.js')

// ---------------------------------------------------------------------------
// CLI runner
// ---------------------------------------------------------------------------

type RunCliResult = {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Executes the built CLI binary with the given arguments.
 * Sets HOME to a temp directory to isolate global state.
 */
export function runCli(
  args: string[],
  options: { cwd: string; homeDir?: string; env?: Record<string, string> }
): Promise<RunCliResult> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [CLI_BIN_PATH, ...args],
      {
        cwd: options.cwd,
        timeout: 30_000,
        env: {
          ...process.env,
          HOME: options.homeDir ?? options.cwd,
          NO_COLOR: '1',
          ...options.env,
        },
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode: error?.code != null ? (typeof error.code === 'number' ? error.code : 1) : 0,
        })
      }
    )

    // If the child gets killed, that's fine — execFile callback still fires
    child.on('error', () => {
      // Handled via callback
    })
  })
}

/**
 * Runs the CLI and parses the JSON output from stdout.
 * Assumes the command was invoked with --json.
 */
export async function runCliJson<T = unknown>(
  args: string[],
  options: { cwd: string; homeDir?: string; env?: Record<string, string> }
): Promise<{ data: T; success: boolean; exitCode: number; stderr: string; raw: string }> {
  const result = await runCli(args, options)

  // The CLI outputs JSON as a single line to stdout
  const lines = result.stdout.trim().split('\n')
  const jsonLine = lines.find((line) => line.startsWith('{'))

  if (!jsonLine) {
    throw new Error(
      `No JSON output found in stdout.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    )
  }

  const parsed = JSON.parse(jsonLine) as {
    success: boolean
    data: T
    error?: { code: string; message: string }
  }

  return {
    data: parsed.data,
    success: parsed.success,
    exitCode: result.exitCode,
    stderr: result.stderr,
    raw: result.stdout,
  }
}

// ---------------------------------------------------------------------------
// Installed skill seeder
// ---------------------------------------------------------------------------

type SetupSkillOptions = {
  name: string
  files: Record<string, string>
  agents: string[]
  scope?: 'project' | 'global'
  source?: GitSource
}

const DEFAULT_SOURCE: GitSource = {
  type: 'git',
  uri: 'github.com/test-org/test-repo',
  path: '',
  ref: 'main',
  commit: 'abc1234567890abcdef1234567890abcdef123456',
}

/**
 * Seeds a project directory with a fully installed skill — canonical files,
 * agent symlinks, manifest, and lockfile. Produces the exact same disk state
 * as a real install.
 */
export function setupInstalledSkill(dir: string, options: SetupSkillOptions): void {
  const scope = options.scope ?? 'project'
  const source = options.source ?? DEFAULT_SOURCE

  // 1. Write files to canonical path
  const canonicalPath = getCanonicalSkillPath(dir, options.name, scope)
  mkdirSync(canonicalPath, { recursive: true })

  for (const [relativePath, content] of Object.entries(options.files)) {
    const filePath = join(canonicalPath, relativePath)
    const parentDir = join(filePath, '..')
    mkdirSync(parentDir, { recursive: true })
    writeFileSync(filePath, content)
  }

  // 2. Create agent symlinks
  createAgentSymlinks(dir, options.name, options.agents, scope)

  // 3. Compute integrity
  const fileEntries = Object.entries(options.files).map(([path, content]) => ({ path, content }))
  const integrity = computeSha256FromFiles(fileEntries)

  // 4. Write manifest
  const manifest = readManifest(dir, scope)
  const manifestPkg: ManifestV2Package = {
    source,
    agents: options.agents,
    installedAt: new Date().toISOString(),
    modified: false,
  }
  manifest.packages[options.name] = manifestPkg
  writeManifest(dir, manifest, scope)

  // 5. Write lockfile
  const lockfile = readLockfile(dir, scope)
  const lockfilePkg: LockfileV2Package = {
    source,
    integrity,
    agents: options.agents,
  }
  lockfile.packages[options.name] = lockfilePkg
  writeLockfile(dir, lockfile, scope)
}
