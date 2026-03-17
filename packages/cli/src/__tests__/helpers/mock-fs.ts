/**
 * Real filesystem helpers for isolated test directories.
 * Uses actual temp directories (not mocked fs) so tests exercise real I/O.
 */

import { randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LockfileV2, ManifestV2 } from '@agentver/shared'
import type { AgentverConfig, Credentials } from './fixtures'

// ---------------------------------------------------------------------------
// Temp directory lifecycle
// ---------------------------------------------------------------------------

/**
 * Creates a unique temp directory, runs the callback, then cleans up —
 * even if the callback throws.
 */
export async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = join(tmpdir(), `agentver-test-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })

  try {
    await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Synchronous variant for tests that don't need async.
 */
export function createTempDir(): string {
  const dir = join(tmpdir(), `agentver-test-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function cleanupTempDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// Project seeding
// ---------------------------------------------------------------------------

export type SeedProjectOptions = {
  manifest?: ManifestV2
  lockfile?: LockfileV2
  /** Map of skillName -> { relativePath: fileContent } */
  skills?: Record<string, Record<string, string>>
}

/**
 * Seeds a project directory with .agentver/ metadata and skill files
 * in the canonical location (.agents/skills/).
 */
export function seedProject(dir: string, opts: SeedProjectOptions = {}): void {
  const agentverDir = join(dir, '.agentver')
  mkdirSync(agentverDir, { recursive: true })

  if (opts.manifest) {
    writeFileSync(join(agentverDir, 'manifest.json'), JSON.stringify(opts.manifest, null, 2))
  }

  if (opts.lockfile) {
    writeFileSync(join(agentverDir, 'lockfile.json'), JSON.stringify(opts.lockfile, null, 2))
  }

  if (opts.skills) {
    for (const [skillName, files] of Object.entries(opts.skills)) {
      const skillDir = join(dir, '.agents', 'skills', skillName)
      mkdirSync(skillDir, { recursive: true })

      for (const [relativePath, content] of Object.entries(files)) {
        const filePath = join(skillDir, relativePath)
        const parentDir = join(filePath, '..')
        mkdirSync(parentDir, { recursive: true })
        writeFileSync(filePath, content)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Project state reading
// ---------------------------------------------------------------------------

export type ProjectState = {
  manifest: ManifestV2 | null
  lockfile: LockfileV2 | null
  skills: string[]
  symlinks: string[]
}

/**
 * Reads back the project state from disk for assertions.
 */
export function readProjectState(dir: string): ProjectState {
  const agentverDir = join(dir, '.agentver')

  let manifest: ManifestV2 | null = null
  const manifestPath = join(agentverDir, 'manifest.json')
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ManifestV2
    } catch {
      manifest = null
    }
  }

  let lockfile: LockfileV2 | null = null
  const lockfilePath = join(agentverDir, 'lockfile.json')
  if (existsSync(lockfilePath)) {
    try {
      lockfile = JSON.parse(readFileSync(lockfilePath, 'utf-8')) as LockfileV2
    } catch {
      lockfile = null
    }
  }

  const skills: string[] = []
  const symlinks: string[] = []

  const skillsDir = join(dir, '.agents', 'skills')
  if (existsSync(skillsDir)) {
    const entries = readdirSync(skillsDir, { withFileTypes: true })
    for (const entry of entries) {
      skills.push(entry.name)
    }
  }

  // Scan the project root for symlinks pointing into .agents/skills
  collectSymlinks(dir, dir, symlinks)

  return { manifest, lockfile, skills, symlinks }
}

/**
 * Recursively collects symlinks under a directory.
 * Skips .agentver and node_modules to keep it fast.
 */
function collectSymlinks(baseDir: string, currentDir: string, result: string[]): void {
  if (!existsSync(currentDir)) return

  const entries = readdirSync(currentDir, { withFileTypes: true })
  for (const entry of entries) {
    const name = entry.name
    if (name === 'node_modules' || name === '.agentver') continue

    const fullPath = join(currentDir, name)

    try {
      const stats = lstatSync(fullPath)
      if (stats.isSymbolicLink()) {
        const target = readlinkSync(fullPath)
        const relativePath = fullPath.slice(baseDir.length + 1)
        result.push(`${relativePath} -> ${target}`)
      } else if (stats.isDirectory()) {
        collectSymlinks(baseDir, fullPath, result)
      }
    } catch {
      // Skip entries we can't stat
    }
  }
}

// ---------------------------------------------------------------------------
// Global config seeding (simulates ~/.agentver/)
// ---------------------------------------------------------------------------

export type SeedGlobalConfigOptions = {
  credentials?: Credentials
  config?: AgentverConfig
}

/**
 * Seeds a fake home directory with .agentver/credentials.json and config.json.
 * Useful when tests mock homedir() to return a temp path.
 */
export function seedGlobalConfig(homeDir: string, opts: SeedGlobalConfigOptions = {}): void {
  const agentverDir = join(homeDir, '.agentver')
  mkdirSync(agentverDir, { recursive: true })

  if (opts.credentials) {
    writeFileSync(
      join(agentverDir, 'credentials.json'),
      JSON.stringify(opts.credentials, null, 2),
      { mode: 0o600 }
    )
  }

  if (opts.config) {
    writeFileSync(join(agentverDir, 'config.json'), JSON.stringify(opts.config, null, 2), {
      mode: 0o600,
    })
  }
}

export type GlobalConfigState = {
  credentials: Credentials | null
  config: AgentverConfig | null
}

/**
 * Reads back the global config state from a fake home directory.
 */
export function readGlobalConfig(homeDir: string): GlobalConfigState {
  const agentverDir = join(homeDir, '.agentver')

  let credentials: Credentials | null = null
  const credPath = join(agentverDir, 'credentials.json')
  if (existsSync(credPath)) {
    try {
      credentials = JSON.parse(readFileSync(credPath, 'utf-8')) as Credentials
    } catch {
      credentials = null
    }
  }

  let config: AgentverConfig | null = null
  const configPath = join(agentverDir, 'config.json')
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8')) as AgentverConfig
    } catch {
      config = null
    }
  }

  return { credentials, config }
}
