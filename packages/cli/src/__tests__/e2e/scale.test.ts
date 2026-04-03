/**
 * Scale tests for large manifests — verifies the CLI performs correctly
 * with 50-100+ packages without corruption or performance degradation.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type DoctorResult,
  doctorResultSchema,
  type ListResult,
  type LockfileV2,
  listResultSchema,
  lockfileV2Schema,
  type ManifestV2,
  manifestV2Schema,
  type StatusResult,
  statusResultSchema,
} from '@agentver/shared'
import { describe, expect, it } from 'vitest'
import {
  createLockfilePackage,
  createManifestPackage,
  createSharedGitSource,
} from '../helpers/fixtures'
import { readProjectState, seedProject, withTempDir } from '../helpers/mock-fs'
import { runCliJson, setupInstalledSkill } from './helpers'

// ---------------------------------------------------------------------------
// Helpers — generate large manifests programmatically
// ---------------------------------------------------------------------------

const LARGE_COUNT = 100
const MEDIUM_COUNT = 50

function generateLargeManifest(count: number): ManifestV2 {
  const packages: ManifestV2['packages'] = {}
  for (let i = 0; i < count; i++) {
    const key = `git:github.com/test-org/skill-${String(i)}`
    packages[key] = createManifestPackage({
      source: createSharedGitSource({
        uri: `https://github.com/test-org/skill-${String(i)}`,
        path: `skills/skill-${String(i)}`,
        ref: 'main',
        commit: `abc${String(i).padStart(7, '0')}`,
      }),
      agents: ['claude-code'],
      installedAt: new Date(Date.now() - i * 60_000).toISOString(),
    })
  }
  return { version: 2, packages }
}

function generateLargeLockfile(count: number): LockfileV2 {
  const packages: LockfileV2['packages'] = {}
  for (let i = 0; i < count; i++) {
    const key = `git:github.com/test-org/skill-${String(i)}`
    packages[key] = createLockfilePackage({
      source: createSharedGitSource({
        uri: `https://github.com/test-org/skill-${String(i)}`,
        path: `skills/skill-${String(i)}`,
        ref: 'main',
        commit: `abc${String(i).padStart(7, '0')}`,
      }),
      integrity: `sha256-${String(i).padStart(12, '0')}`,
      agents: ['claude-code'],
    })
  }
  return { version: 2, packages }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E: scale — large manifest', () => {
  it('list --json completes within 5 seconds for 100 packages', async () => {
    await withTempDir(async (dir) => {
      const manifest = generateLargeManifest(LARGE_COUNT)
      const lockfile = generateLargeLockfile(LARGE_COUNT)
      seedProject(dir, { manifest, lockfile })

      const start = performance.now()
      const { data, success, exitCode } = await runCliJson<ListResult>(['list', '--json'], {
        cwd: dir,
      })
      const duration = performance.now() - start

      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.packages).toHaveLength(LARGE_COUNT)
      expect(duration).toBeLessThan(5000)

      // Validate output against the list result schema
      const parsed = listResultSchema.safeParse(data)
      expect(parsed.success).toBe(true)

      // Every package should have been reported
      for (let i = 0; i < LARGE_COUNT; i++) {
        // The list command uses getPackageDisplayName which may strip the key prefix
        const key = `git:github.com/test-org/skill-${String(i)}`
        const pkg = data.packages.find(
          (p) => p.name === key || p.name.includes(`skill-${String(i)}`)
        )
        expect(pkg, `package skill-${String(i)} should appear in list output`).toBeDefined()
      }
    })
  })

  it('status --offline --json completes within 5 seconds for 100 packages', async () => {
    await withTempDir(async (dir) => {
      const manifest = generateLargeManifest(LARGE_COUNT)
      const lockfile = generateLargeLockfile(LARGE_COUNT)
      seedProject(dir, { manifest, lockfile })

      const start = performance.now()
      const { data, success, exitCode } = await runCliJson<StatusResult>(
        ['status', '--offline', '--json'],
        { cwd: dir }
      )
      const duration = performance.now() - start

      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.summary.total).toBe(LARGE_COUNT)
      expect(data.packages).toHaveLength(LARGE_COUNT)
      expect(duration).toBeLessThan(5000)

      // Validate output against the status result schema
      const parsed = statusResultSchema.safeParse(data)
      expect(parsed.success).toBe(true)
    })
  })

  it('doctor --json completes within 5 seconds for 100 packages', async () => {
    await withTempDir(async (dir) => {
      const manifest = generateLargeManifest(LARGE_COUNT)
      const lockfile = generateLargeLockfile(LARGE_COUNT)
      seedProject(dir, { manifest, lockfile })

      const start = performance.now()
      const { data } = await runCliJson<DoctorResult>(['doctor', '--json'], { cwd: dir })
      const duration = performance.now() - start

      expect(duration).toBeLessThan(5000)

      // Validate output against the doctor result schema
      const parsed = doctorResultSchema.safeParse(data)
      expect(parsed.success).toBe(true)

      // Doctor should find checks — manifest/lockfile integrity should pass
      // since we seeded valid data. skill-files-exist will fail because
      // we didn't create the actual directories, which is expected.
      expect(data.checks.length).toBeGreaterThan(0)

      const manifestCheck = data.checks.find((c) => c.name === 'manifest-integrity')
      expect(manifestCheck?.status).toBe('pass')

      const lockfileCheck = data.checks.find((c) => c.name === 'lockfile-integrity')
      expect(lockfileCheck?.status).toBe('pass')

      const syncCheck = data.checks.find((c) => c.name === 'manifest-lockfile-sync')
      expect(syncCheck?.status).toBe('pass')
    })
  })

  it('install does not corrupt a large manifest (50 + 1)', async () => {
    await withTempDir(async (dir) => {
      // Seed 50 packages by writing manifest/lockfile directly
      const manifest = generateLargeManifest(MEDIUM_COUNT)
      const lockfile = generateLargeLockfile(MEDIUM_COUNT)
      seedProject(dir, { manifest, lockfile })

      // Capture the original 50 package keys
      const originalKeys = Object.keys(manifest.packages)
      expect(originalKeys).toHaveLength(MEDIUM_COUNT)

      // Install one more skill via setupInstalledSkill (package #51)
      setupInstalledSkill(dir, {
        name: 'extra-skill',
        files: { 'SKILL.md': '# Extra skill\n\nAn additional skill.\n' },
        agents: ['claude-code'],
      })

      // Read back the manifest and lockfile
      const state = readProjectState(dir)
      expect(state.manifest).not.toBeNull()
      expect(state.lockfile).not.toBeNull()

      const updatedManifest = state.manifest!
      const updatedLockfile = state.lockfile!

      // Should have 51 packages total
      const updatedKeys = Object.keys(updatedManifest.packages)
      expect(updatedKeys).toHaveLength(MEDIUM_COUNT + 1)

      const lockfileKeys = Object.keys(updatedLockfile.packages)
      expect(lockfileKeys).toHaveLength(MEDIUM_COUNT + 1)

      // Validate manifest against schema
      const manifestResult = manifestV2Schema.safeParse(updatedManifest)
      expect(manifestResult.success).toBe(true)

      // Validate lockfile against schema
      const lockfileResult = lockfileV2Schema.safeParse(updatedLockfile)
      expect(lockfileResult.success).toBe(true)

      // The original 50 packages should be unchanged (deep equality,
      // property order may differ after round-trip through writeJsonFileAtomic)
      for (const key of originalKeys) {
        expect(updatedManifest.packages[key]).toBeDefined()
        expect(updatedManifest.packages[key]).toEqual(manifest.packages[key])
      }

      // The new package should be present
      const extraKey = Object.keys(updatedManifest.packages).find((k) => !originalKeys.includes(k))
      expect(extraKey).toBeDefined()
      expect(updatedManifest.packages[extraKey!]!.agents).toContain('claude-code')
    })
  })

  it('remove from a large manifest leaves remaining packages intact', async () => {
    await withTempDir(async (dir) => {
      // Seed a moderate number of fully-installed skills
      const skillCount = 10
      for (let i = 0; i < skillCount; i++) {
        setupInstalledSkill(dir, {
          name: `skill-${String(i)}`,
          files: { 'SKILL.md': `# Skill ${String(i)}\n\nDescription for skill ${String(i)}.\n` },
          agents: ['claude-code'],
        })
      }

      // Verify all are present
      const beforeState = readProjectState(dir)
      expect(Object.keys(beforeState.manifest?.packages ?? {})).toHaveLength(skillCount)
      expect(Object.keys(beforeState.lockfile?.packages ?? {})).toHaveLength(skillCount)

      // Remove one skill from the middle
      const { data, exitCode } = await runCliJson<{ name: string; removed: boolean }>(
        ['remove', 'skill-5', '--yes', '--json'],
        { cwd: dir }
      )

      expect(exitCode).toBe(0)
      expect(data.removed).toBe(true)

      // Read back state
      const afterState = readProjectState(dir)
      const remainingManifestKeys = Object.keys(afterState.manifest?.packages ?? {})
      const remainingLockfileKeys = Object.keys(afterState.lockfile?.packages ?? {})

      expect(remainingManifestKeys).toHaveLength(skillCount - 1)
      expect(remainingLockfileKeys).toHaveLength(skillCount - 1)

      // Validate schema compliance after removal
      const manifestResult = manifestV2Schema.safeParse(afterState.manifest)
      expect(manifestResult.success).toBe(true)
      const lockfileResult = lockfileV2Schema.safeParse(afterState.lockfile)
      expect(lockfileResult.success).toBe(true)

      // The removed skill should be gone
      const removedEntry = remainingManifestKeys.find((k) => k.includes('skill-5'))
      expect(removedEntry).toBeUndefined()

      // All other skills should still be present
      for (let i = 0; i < skillCount; i++) {
        if (i === 5) continue
        const found = remainingManifestKeys.some((k) => k.includes(`skill-${String(i)}`))
        expect(found, `skill-${String(i)} should still be in the manifest`).toBe(true)
      }
    })
  })

  it('manifest serialisation is deterministic (byte-for-byte identical on re-write)', async () => {
    await withTempDir(async (dir) => {
      const manifest = generateLargeManifest(LARGE_COUNT)
      const lockfile = generateLargeLockfile(LARGE_COUNT)
      seedProject(dir, { manifest, lockfile })

      const manifestPath = join(dir, '.agentver', 'manifest.json')
      const lockfilePath = join(dir, '.agentver', 'lockfile.json')

      // Read the original bytes written by seedProject
      const originalManifestBytes = readFileSync(manifestPath, 'utf-8')
      const originalLockfileBytes = readFileSync(lockfilePath, 'utf-8')

      // Parse and re-serialise with the same formatting seedProject uses
      const parsedManifest = JSON.parse(originalManifestBytes) as ManifestV2
      const parsedLockfile = JSON.parse(originalLockfileBytes) as LockfileV2
      const reserialised = JSON.stringify(parsedManifest, null, 2)
      const reserialisedLockfile = JSON.stringify(parsedLockfile, null, 2)

      // seedProject writes with JSON.stringify(x, null, 2) — verify round-trip
      expect(reserialised).toBe(originalManifestBytes)
      expect(reserialisedLockfile).toBe(originalLockfileBytes)

      // Now verify via CLI: run list, then read back — manifest should be untouched
      await runCliJson<ListResult>(['list', '--json'], { cwd: dir })

      const afterListManifest = readFileSync(manifestPath, 'utf-8')
      expect(afterListManifest).toBe(originalManifestBytes)

      const afterListLockfile = readFileSync(lockfilePath, 'utf-8')
      expect(afterListLockfile).toBe(originalLockfileBytes)
    })
  })

  it('list output contains correct scope and source data for all packages', async () => {
    await withTempDir(async (dir) => {
      const manifest = generateLargeManifest(LARGE_COUNT)
      const lockfile = generateLargeLockfile(LARGE_COUNT)
      seedProject(dir, { manifest, lockfile })

      const { data } = await runCliJson<ListResult>(['list', '--json'], { cwd: dir })

      // Every returned package should have scope 'project'
      for (const pkg of data.packages) {
        expect(pkg.scope).toBe('project')
      }

      // All packages should have a git source
      for (const pkg of data.packages) {
        expect(pkg.package.source.type).toBe('git')
      }
    })
  })

  it('status summary counts are consistent with package array length', async () => {
    await withTempDir(async (dir) => {
      const manifest = generateLargeManifest(LARGE_COUNT)
      const lockfile = generateLargeLockfile(LARGE_COUNT)
      seedProject(dir, { manifest, lockfile })

      const { data } = await runCliJson<StatusResult>(['status', '--offline', '--json'], {
        cwd: dir,
      })

      const { summary } = data
      const computedTotal = summary.upToDate + summary.modified + summary.upstream + summary.unknown

      expect(summary.total).toBe(LARGE_COUNT)
      expect(computedTotal).toBe(summary.total)
      expect(data.packages).toHaveLength(summary.total)
    })
  })
})
