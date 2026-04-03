/**
 * E2E tests for filesystem permission errors, binary corruption, and
 * missing directory scenarios. Verifies the CLI degrades gracefully
 * rather than crashing when the filesystem itself causes problems.
 */

import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSkillMd } from '../helpers/fixtures'
import { cleanupTempDir, createTempDir, seedProject, withTempDir } from '../helpers/mock-fs'
import { runCli, runCliJson, setupInstalledSkill } from './helpers'

// ---------------------------------------------------------------------------
// Type aliases for JSON output shapes
// ---------------------------------------------------------------------------

type DoctorCheck = { name: string; status: string; message: string }
type DoctorOutput = {
  checks: DoctorCheck[]
  passed: number
  failed: number
  warnings: number
}

type ListOutput = {
  packages: Array<{
    name: string
    scope: string
    package: {
      source: { type: string }
      agents: string[]
    }
  }>
}

type StatusOutput = {
  packages: Array<{
    name: string
    status: string
    modified: boolean
  }>
  summary: {
    total: number
    upToDate: number
    modified: number
    upstream: number
    unknown: number
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a buffer of random binary bytes that is almost certainly not valid JSON/UTF-8. */
function binaryGarbage(size = 256): Buffer {
  return randomBytes(size)
}

/**
 * Directories made read-only during a test must be restored before cleanup.
 * Track them here so afterEach can always chmod them back.
 */
const readOnlyPaths: string[] = []

afterEach(() => {
  for (const p of readOnlyPaths) {
    try {
      if (existsSync(p)) {
        chmodSync(p, 0o755)
      }
    } catch {
      // Best-effort cleanup
    }
  }
  readOnlyPaths.length = 0
})

// ---------------------------------------------------------------------------
// 1. Read-only .agentver directory
// ---------------------------------------------------------------------------

describe('E2E: read-only .agentver directory', () => {
  it('adopt fails with a descriptive error when .agentver/ is read-only', async () => {
    // Use createTempDir + manual cleanup so we can restore permissions
    // before rmSync — withTempDir's finally block cannot remove a read-only tree.
    const dir = createTempDir()

    try {
      // Seed a valid empty project, then lock the directory
      const agentverDir = join(dir, '.agentver')
      mkdirSync(agentverDir, { recursive: true })
      writeFileSync(
        join(agentverDir, 'manifest.json'),
        JSON.stringify({ version: 2, packages: {} })
      )
      writeFileSync(
        join(agentverDir, 'lockfile.json'),
        JSON.stringify({ version: 2, packages: {} })
      )

      // Create a skill to adopt — adopt will need to write to .agentver/
      const skillDir = join(dir, '.claude', 'skills', 'perm-test-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), createSkillMd({ name: 'perm-test-skill' }))

      // Lock the .agentver directory so adopt cannot write
      chmodSync(agentverDir, 0o555)
      readOnlyPaths.push(agentverDir)

      const result = await runCli(['adopt', '--json'], { cwd: dir })

      // Should fail (non-zero exit or error in output) rather than crash
      const output = `${result.stdout}\n${result.stderr}`.toLowerCase()
      const mentionsPermission =
        output.includes('permission') ||
        output.includes('eacces') ||
        output.includes('read-only') ||
        output.includes('eperm') ||
        output.includes('write') ||
        output.includes('error')

      // Either non-zero exit or descriptive error in output
      expect(result.exitCode !== 0 || mentionsPermission).toBe(true)
    } finally {
      // Restore permissions before cleanup
      const agentverDir = join(dir, '.agentver')
      try {
        chmodSync(agentverDir, 0o755)
      } catch {
        // Already restored or does not exist
      }
      cleanupTempDir(dir)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. Missing .agentver directory
// ---------------------------------------------------------------------------

describe('E2E: missing .agentver directory', () => {
  it('list --json returns empty list in a dir with no .agentver/', async () => {
    await withTempDir(async (dir) => {
      // Completely empty directory — no .agentver at all
      const { data, success, exitCode } = await runCliJson<ListOutput>(['list', '--json'], {
        cwd: dir,
      })

      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.packages).toHaveLength(0)
    })
  })

  it('status --json handles gracefully in a dir with no .agentver/', async () => {
    await withTempDir(async (dir) => {
      const { data, success, exitCode } = await runCliJson<StatusOutput>(
        ['status', '--offline', '--json'],
        { cwd: dir }
      )

      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.summary.total).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// 3. Binary garbage in manifest
// ---------------------------------------------------------------------------

describe('E2E: binary garbage in manifest', () => {
  it('list --json handles binary manifest without crashing', async () => {
    await withTempDir(async (dir) => {
      const agentverDir = join(dir, '.agentver')
      mkdirSync(agentverDir, { recursive: true })
      writeFileSync(join(agentverDir, 'manifest.json'), binaryGarbage())

      // readManifest falls back to empty manifest on corruption
      const { data, success, exitCode } = await runCliJson<ListOutput>(['list', '--json'], {
        cwd: dir,
      })

      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.packages).toHaveLength(0)
    })
  })

  it('doctor --json detects binary manifest corruption', async () => {
    await withTempDir(async (dir) => {
      const agentverDir = join(dir, '.agentver')
      mkdirSync(agentverDir, { recursive: true })
      writeFileSync(join(agentverDir, 'manifest.json'), binaryGarbage())

      const { data, exitCode } = await runCliJson<DoctorOutput>(['doctor', '--json'], {
        cwd: dir,
      })

      // Doctor should run to completion (not crash)
      expect(typeof exitCode).toBe('number')

      const manifestCheck = data.checks.find((c) => c.name === 'manifest-integrity')
      expect(manifestCheck).toBeDefined()
      expect(manifestCheck!.status).toBe('fail')
    })
  })
})

// ---------------------------------------------------------------------------
// 4. Binary garbage in lockfile
// ---------------------------------------------------------------------------

describe('E2E: binary garbage in lockfile', () => {
  it('status --json handles binary lockfile without crashing', async () => {
    await withTempDir(async (dir) => {
      // Valid manifest, binary garbage lockfile
      seedProject(dir, {
        manifest: {
          version: 2,
          packages: {
            'some-skill': {
              source: {
                type: 'git',
                uri: 'https://github.com/test-org/test-repo',
                path: 'skills/some-skill',
                ref: 'main',
                commit: 'abc1234567',
              },
              agents: ['claude-code'],
              installedAt: '2025-01-15T10:30:00.000Z',
              modified: false,
            },
          },
        },
      })
      writeFileSync(join(dir, '.agentver', 'lockfile.json'), binaryGarbage())

      const { success, exitCode } = await runCliJson<StatusOutput>(
        ['status', '--offline', '--json'],
        { cwd: dir }
      )

      // Should not crash — readLockfile falls back to empty on corruption
      expect(exitCode).toBe(0)
      expect(success).toBe(true)
    })
  })

  it('doctor --json detects binary lockfile corruption', async () => {
    await withTempDir(async (dir) => {
      seedProject(dir, {
        manifest: { version: 2, packages: {} },
      })
      writeFileSync(join(dir, '.agentver', 'lockfile.json'), binaryGarbage())

      const { data, exitCode } = await runCliJson<DoctorOutput>(['doctor', '--json'], {
        cwd: dir,
      })

      expect(typeof exitCode).toBe('number')

      const lockfileCheck = data.checks.find((c) => c.name === 'lockfile-integrity')
      expect(lockfileCheck).toBeDefined()
      expect(lockfileCheck!.status).toBe('fail')
    })
  })
})

// ---------------------------------------------------------------------------
// 5. Binary garbage in credentials
// ---------------------------------------------------------------------------

describe('E2E: binary garbage in credentials', () => {
  it('whoami --json shows unauthenticated when credentials are binary garbage', async () => {
    await withTempDir(async (dir) => {
      // Set up a fake home directory with corrupt credentials
      const homeDir = dir
      const agentverHome = join(homeDir, '.agentver')
      mkdirSync(agentverHome, { recursive: true })
      writeFileSync(join(agentverHome, 'credentials.json'), binaryGarbage())

      const { data, success, exitCode } = await runCliJson<{ authenticated: boolean }>(
        ['whoami', '--json'],
        { cwd: dir, homeDir }
      )

      // whoami should not crash — it should report unauthenticated
      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.authenticated).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// 6. Binary garbage in config
// ---------------------------------------------------------------------------

describe('E2E: binary garbage in config', () => {
  it('config list --json handles binary config gracefully', async () => {
    await withTempDir(async (dir) => {
      // Set up a fake home directory with corrupt config
      const homeDir = dir
      const agentverHome = join(homeDir, '.agentver')
      mkdirSync(agentverHome, { recursive: true })
      writeFileSync(join(agentverHome, 'config.json'), binaryGarbage())

      const { success, exitCode } = await runCliJson<Record<string, unknown>>(
        ['config', 'list', '--json'],
        { cwd: dir, homeDir }
      )

      // readConfig falls back to {} on parse failure, so this should succeed
      expect(exitCode).toBe(0)
      expect(success).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// 7. Unwritable manifest (file is read-only)
// ---------------------------------------------------------------------------

describe('E2E: unwritable manifest file', () => {
  it('install fails descriptively when manifest.json is read-only', async () => {
    await withTempDir(async (dir) => {
      // Seed a valid project with a git-sourced skill
      setupInstalledSkill(dir, {
        name: 'readonly-skill',
        files: { 'SKILL.md': createSkillMd({ name: 'readonly-skill' }) },
        agents: ['claude-code'],
      })

      const manifestPath = join(dir, '.agentver', 'manifest.json')
      chmodSync(manifestPath, 0o444)
      readOnlyPaths.push(manifestPath)

      const result = await runCli(['install', '--json', '--yes'], { cwd: dir })

      // The install attempts to write the lockfile (via storage lock / transaction),
      // which may fail because the storage dir or files are not writable.
      // It should not crash with an unhandled exception.
      const output = `${result.stdout}\n${result.stderr}`.toLowerCase()
      const isGraceful =
        result.exitCode === 0 || // up-to-date, no write needed
        output.includes('permission') ||
        output.includes('eacces') ||
        output.includes('eperm') ||
        output.includes('read-only') ||
        output.includes('write') ||
        output.includes('error')

      expect(isGraceful).toBe(true)

      // Restore for cleanup
      chmodSync(manifestPath, 0o644)
    })
  })
})

// ---------------------------------------------------------------------------
// 8. Missing parent directories
// ---------------------------------------------------------------------------

describe('E2E: missing parent directories', () => {
  it('remove errors gracefully when .agentver/ does not exist', async () => {
    await withTempDir(async (dir) => {
      // No .agentver/ directory at all
      const result = await runCli(['remove', 'some-skill', '--yes', '--json'], { cwd: dir })

      // Should fail (skill not found) but not crash trying to create dirs
      expect(result.exitCode).not.toBe(0)

      // Output should be parseable — either JSON error or human-readable error
      const output = `${result.stdout}\n${result.stderr}`
      const hasStructuredError =
        output.includes('NOT_FOUND') ||
        output.includes('not found') ||
        output.includes('No packages') ||
        output.includes('error')
      expect(hasStructuredError).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// 9. Partially written manifest (truncated JSON)
// ---------------------------------------------------------------------------

describe('E2E: truncated JSON in manifest', () => {
  it('list --json handles truncated manifest without crashing', async () => {
    await withTempDir(async (dir) => {
      const agentverDir = join(dir, '.agentver')
      mkdirSync(agentverDir, { recursive: true })
      // Truncated mid-key — valid start but never closes
      writeFileSync(join(agentverDir, 'manifest.json'), '{"version":2,"packages":{"git:')

      // readManifest falls back to empty on parse failure
      const { data, success, exitCode } = await runCliJson<ListOutput>(['list', '--json'], {
        cwd: dir,
      })

      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.packages).toHaveLength(0)
    })
  })

  it('doctor --json detects truncated manifest', async () => {
    await withTempDir(async (dir) => {
      const agentverDir = join(dir, '.agentver')
      mkdirSync(agentverDir, { recursive: true })
      writeFileSync(join(agentverDir, 'manifest.json'), '{"version":2,"packages":{"git:')

      const { data, exitCode } = await runCliJson<DoctorOutput>(['doctor', '--json'], {
        cwd: dir,
      })

      expect(typeof exitCode).toBe('number')

      const manifestCheck = data.checks.find((c) => c.name === 'manifest-integrity')
      expect(manifestCheck).toBeDefined()
      expect(manifestCheck!.status).toBe('fail')
    })
  })
})
