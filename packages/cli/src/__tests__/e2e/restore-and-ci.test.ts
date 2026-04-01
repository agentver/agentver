/**
 * E2E tests for restore-from-manifest (install with no args) and the ci command.
 *
 * These tests run the actual CLI binary against temp directories with real
 * filesystem state. No mocking — exercises the full restore codepath end-to-end.
 */

import type { LocalSource, ManifestV2Package } from '@agentver/shared'
import { describe, expect, it } from 'vitest'
import { createSharedGitSource, createSkillMd } from '../helpers/fixtures'
import { seedProject, withTempDir } from '../helpers/mock-fs'
import { parseCiJson, type RestoreResult, runCli, runCliJson, setupInstalledSkill } from './helpers'

// ---------------------------------------------------------------------------
// E2E: restore from manifest
// ---------------------------------------------------------------------------

describe('E2E: restore from manifest', () => {
  it('install with no args classifies local entries as non-restorable', async () => {
    await withTempDir(async (dir) => {
      const localSource: LocalSource = { type: 'local', path: '/some/path' }

      seedProject(dir, {
        manifest: {
          version: 2,
          packages: {
            'local-skill': {
              source: localSource,
              agents: ['claude-code'],
              installedAt: new Date().toISOString(),
              modified: false,
            } satisfies ManifestV2Package,
          },
        },
        lockfile: {
          version: 2,
          packages: {
            'local-skill': {
              source: localSource,
              integrity: 'sha256-abc123',
              agents: ['claude-code'],
            },
          },
        },
      })

      const { data, success } = await runCliJson<RestoreResult>(['install', '--json', '--yes'], {
        cwd: dir,
      })

      expect(success).toBe(true)
      expect(data.success).toBe(true)
      expect(data.type).toBe('RESTORE_COMPLETE')

      const skippedPackages = data.packages.filter((p) => p.status === 'skipped')
      expect(skippedPackages.length).toBeGreaterThanOrEqual(1)

      const localEntry = skippedPackages.find((p) => p.packageKey === 'local-skill')
      expect(localEntry).toBeDefined()
      expect(localEntry!.reason).toContain('Local')
    })
  })

  it('install with no args reports already-installed entries as up-to-date', async () => {
    await withTempDir(async (dir) => {
      setupInstalledSkill(dir, {
        name: 'test-skill',
        files: { 'SKILL.md': createSkillMd() },
        agents: ['claude-code'],
      })

      const { data, success, exitCode } = await runCliJson<RestoreResult>(
        ['install', '--json', '--yes'],
        { cwd: dir }
      )

      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.success).toBe(true)

      const upToDatePackages = data.packages.filter((p) => p.status === 'up-to-date')
      expect(upToDatePackages.length).toBeGreaterThanOrEqual(1)

      const testEntry = upToDatePackages.find((p) => p.displayName === 'test-skill')
      expect(testEntry).toBeDefined()
    })
  })

  it('install --offline skips git entries', async () => {
    await withTempDir(async (dir) => {
      const gitSource = createSharedGitSource()

      seedProject(dir, {
        manifest: {
          version: 2,
          packages: {
            'git-skill': {
              source: gitSource,
              agents: ['claude-code'],
              installedAt: new Date().toISOString(),
              modified: false,
            } satisfies ManifestV2Package,
          },
        },
        lockfile: {
          version: 2,
          packages: {
            'git-skill': {
              source: gitSource,
              integrity: 'sha256-def456',
              agents: ['claude-code'],
            },
          },
        },
      })

      const { data, success } = await runCliJson<RestoreResult>(
        ['install', '--offline', '--json', '--yes'],
        { cwd: dir }
      )

      expect(success).toBe(true)
      expect(data.success).toBe(true)

      const skippedPackages = data.packages.filter((p) => p.status === 'skipped')
      expect(skippedPackages.length).toBeGreaterThanOrEqual(1)

      const gitEntry = skippedPackages.find((p) => p.packageKey === 'git-skill')
      expect(gitEntry).toBeDefined()
      expect(gitEntry!.reason).toContain('offline')
    })
  })

  it('install with empty manifest succeeds with nothing to do', async () => {
    await withTempDir(async (dir) => {
      seedProject(dir, {
        manifest: { version: 2, packages: {} },
        lockfile: { version: 2, packages: {} },
      })

      const { data, success, exitCode } = await runCliJson<RestoreResult>(
        ['install', '--json', '--yes'],
        { cwd: dir }
      )

      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.success).toBe(true)
      expect(data.installedCount).toBe(0)
      expect(data.upToDateCount).toBe(0)
      expect(data.skippedCount).toBe(0)
      expect(data.failedCount).toBe(0)
      expect(data.packages).toHaveLength(0)
    })
  })
})

// ---------------------------------------------------------------------------
// E2E: ci command
// ---------------------------------------------------------------------------

describe('E2E: ci command', () => {
  it('ci exits 0 when all entries are up-to-date', async () => {
    await withTempDir(async (dir) => {
      setupInstalledSkill(dir, {
        name: 'test-skill',
        files: { 'SKILL.md': createSkillMd() },
        agents: ['claude-code'],
      })

      const result = await runCli(['ci', '--json'], { cwd: dir })
      const { data, success } = parseCiJson(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.success).toBe(true)
      expect(data.restore.success).toBe(true)

      const upToDatePackages = data.restore.packages.filter((p) => p.status === 'up-to-date')
      expect(upToDatePackages.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('ci exits 0 with empty manifest', async () => {
    await withTempDir(async (dir) => {
      seedProject(dir, {
        manifest: { version: 2, packages: {} },
        lockfile: { version: 2, packages: {} },
      })

      const result = await runCli(['ci', '--json'], { cwd: dir })
      const { data, success } = parseCiJson(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.success).toBe(true)
      expect(data.restore.installedCount).toBe(0)
    })
  })

  it('ci classifies local entries as non-restorable without failing', async () => {
    await withTempDir(async (dir) => {
      const localSource: LocalSource = { type: 'local', path: '/original/path' }

      seedProject(dir, {
        manifest: {
          version: 2,
          packages: {
            'local-skill': {
              source: localSource,
              agents: ['claude-code'],
              installedAt: new Date().toISOString(),
              modified: false,
            } satisfies ManifestV2Package,
          },
        },
        lockfile: {
          version: 2,
          packages: {
            'local-skill': {
              source: localSource,
              integrity: 'sha256-abc123',
              agents: ['claude-code'],
            },
          },
        },
      })

      const result = await runCli(['ci', '--json'], { cwd: dir })
      const { data, success } = parseCiJson(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.success).toBe(true)

      const skippedPackages = data.restore.packages.filter((p) => p.status === 'skipped')
      expect(skippedPackages.length).toBeGreaterThanOrEqual(1)

      const localEntry = skippedPackages.find((p) => p.packageKey === 'local-skill')
      expect(localEntry).toBeDefined()
      expect(localEntry!.reason).toContain('Local')
    })
  })

  it('ci provides structured JSON output', async () => {
    await withTempDir(async (dir) => {
      setupInstalledSkill(dir, {
        name: 'structured-skill',
        files: { 'SKILL.md': createSkillMd({ name: 'structured-skill' }) },
        agents: ['claude-code'],
      })

      const result = await runCli(['ci', '--json'], { cwd: dir })
      const { data, success } = parseCiJson(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(success).toBe(true)

      // Top-level CiResult shape
      expect(data).toHaveProperty('restore')
      expect(data).toHaveProperty('success')
      expect(typeof data.success).toBe('boolean')

      // RestoreResult shape
      const restore = data.restore
      expect(restore.type).toBe('RESTORE_COMPLETE')
      expect(typeof restore.installedCount).toBe('number')
      expect(typeof restore.upToDateCount).toBe('number')
      expect(typeof restore.skippedCount).toBe('number')
      expect(typeof restore.failedCount).toBe('number')
      expect(typeof restore.success).toBe('boolean')
      expect(Array.isArray(restore.packages)).toBe(true)

      // Each package entry has the expected fields
      for (const pkg of restore.packages) {
        expect(pkg).toHaveProperty('packageKey')
        expect(pkg).toHaveProperty('displayName')
        expect(pkg).toHaveProperty('status')
        expect(['installed', 'up-to-date', 'skipped', 'failed', 'integrity-mismatch']).toContain(
          pkg.status
        )
      }

      // Summary counts are consistent with packages array
      const statusCounts = {
        installed: restore.packages.filter((p) => p.status === 'installed').length,
        'up-to-date': restore.packages.filter((p) => p.status === 'up-to-date').length,
        skipped: restore.packages.filter((p) => p.status === 'skipped').length,
        failed: restore.packages.filter((p) => p.status === 'failed').length,
      }
      expect(restore.installedCount).toBe(statusCounts.installed)
      expect(restore.upToDateCount).toBe(statusCounts['up-to-date'])
      expect(restore.skippedCount).toBe(statusCounts.skipped)
      expect(restore.failedCount).toBe(statusCounts.failed)
    })
  })
})
