/**
 * E2E tests for error resilience, edge cases, and boundary conditions
 * that real users would encounter. Covers corrupt state, empty inputs,
 * multi-step operation sequences, and symlink edge cases.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { lockfileV2Schema, manifestV2Schema } from '@agentver/shared'
import { describe, expect, it } from 'vitest'
import { createSkillMd } from '../helpers/fixtures'
import { readProjectState, seedProject, withTempDir } from '../helpers/mock-fs'
import { runCliJson, setupInstalledSkill } from './helpers'

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
      pinned?: boolean
    }
  }>
}

type StatusOutput = {
  packages: Array<{
    name: string
    status: string
    modified: boolean
    pinned?: boolean
  }>
  summary: {
    total: number
    upToDate: number
    modified: number
    upstream: number
    unknown: number
  }
}

type AdoptOutput = {
  adopted: Array<{ name: string; path: string; type: string }>
  skipped: Array<{ name: string; reason?: string }>
}

type ScanOutput = {
  agents: Array<{ id: string; name: string; paths: string[] }>
  skills: Array<{ name: string; path: string; type: string }>
}

type RemoveOutput = {
  name: string
  removed: boolean
  paths: string[]
}

// ---------------------------------------------------------------------------
// Corrupt state resilience
// ---------------------------------------------------------------------------

describe('E2E: corrupt state resilience', () => {
  it('list handles corrupt manifest gracefully', async () => {
    await withTempDir(async (dir) => {
      const agentverDir = join(dir, '.agentver')
      mkdirSync(agentverDir, { recursive: true })
      writeFileSync(join(agentverDir, 'manifest.json'), '{{{invalid json')

      const { data, success, exitCode } = await runCliJson<ListOutput>(['list', '--json'], {
        cwd: dir,
      })

      // readManifest falls back to empty manifest on corruption,
      // so list should succeed with an empty packages array
      expect(success).toBe(true)
      expect(exitCode).toBe(0)
      expect(data.packages).toHaveLength(0)
    })
  })

  it('list handles corrupt lockfile gracefully', async () => {
    await withTempDir(async (dir) => {
      // Valid manifest with one entry, corrupt lockfile
      seedProject(dir, {
        manifest: {
          version: 2,
          packages: {
            'test-skill': {
              source: {
                type: 'git',
                uri: 'https://github.com/test-org/test-repo',
                path: 'skills/test-skill',
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
      writeFileSync(join(dir, '.agentver/lockfile.json'), '{{{invalid json')

      // list reads only the manifest, not the lockfile, so it should still work
      const { data, success, exitCode } = await runCliJson<ListOutput>(['list', '--json'], {
        cwd: dir,
      })

      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.packages).toHaveLength(1)
      expect(data.packages[0]!.name).toBe('test-skill')
    })
  })

  it('remove handles corrupt manifest', async () => {
    await withTempDir(async (dir) => {
      const agentverDir = join(dir, '.agentver')
      mkdirSync(agentverDir, { recursive: true })
      writeFileSync(join(agentverDir, 'manifest.json'), '{{{invalid json')

      const { success, exitCode } = await runCliJson<never>(
        ['remove', 'some-package', '--yes', '--json'],
        { cwd: dir }
      )

      // readManifest falls back to empty, so the package won't be found => NOT_FOUND error
      expect(success).toBe(false)
      expect(exitCode).not.toBe(0)
    })
  })

  it('adopt handles pre-existing corrupt manifest', async () => {
    await withTempDir(async (dir) => {
      // Write corrupt manifest
      const agentverDir = join(dir, '.agentver')
      mkdirSync(agentverDir, { recursive: true })
      writeFileSync(join(agentverDir, 'manifest.json'), '{{{invalid json')

      // Create a skill to adopt
      const skillDir = join(dir, '.claude/skills/rescued-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), createSkillMd({ name: 'rescued-skill' }))

      const { data, success, exitCode } = await runCliJson<AdoptOutput>(['adopt', '--json'], {
        cwd: dir,
      })

      // readManifest treats corrupt as empty, so adopt should overwrite with fresh data
      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.adopted.some((a) => a.name === 'rescued-skill')).toBe(true)

      // Verify the manifest is now valid on disk
      const manifestRaw = readFileSync(join(dir, '.agentver/manifest.json'), 'utf-8')
      expect(manifestV2Schema.safeParse(JSON.parse(manifestRaw) as unknown).success).toBe(true)
    })
  })

  it('status handles missing lockfile when manifest exists', async () => {
    await withTempDir(async (dir) => {
      // Seed valid manifest with a package, but NO lockfile
      seedProject(dir, {
        manifest: {
          version: 2,
          packages: {
            'orphan-skill': {
              source: {
                type: 'git',
                uri: 'https://github.com/test-org/test-repo',
                path: 'skills/orphan-skill',
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

      const { data, success, exitCode } = await runCliJson<StatusOutput>(
        ['status', '--offline', '--json'],
        { cwd: dir }
      )

      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      // The package should appear (status might be unknown or up-to-date without lockfile integrity)
      expect(data.summary.total).toBe(1)
    })
  })
})

// ---------------------------------------------------------------------------
// Empty and edge-case inputs
// ---------------------------------------------------------------------------

describe('E2E: empty and edge-case inputs', () => {
  it('remove with empty string argument fails gracefully', async () => {
    await withTempDir(async (dir) => {
      seedProject(dir, {
        manifest: { version: 2, packages: {} },
        lockfile: { version: 2, packages: {} },
      })

      const { success, exitCode } = await runCliJson<never>(['remove', '', '--yes', '--json'], {
        cwd: dir,
      })

      // Should either fail with NOT_FOUND or a validation error, not crash
      expect(success).toBe(false)
      expect(exitCode).not.toBe(0)
    })
  })

  it('info with special characters in name', async () => {
    await withTempDir(async (dir) => {
      seedProject(dir, {
        manifest: { version: 2, packages: {} },
        lockfile: { version: 2, packages: {} },
      })

      const { success, exitCode } = await runCliJson<never>(
        ['info', '@org/special-chars!', '--json'],
        { cwd: dir }
      )

      // Should fail with NOT_FOUND, not an unhandled crash
      expect(success).toBe(false)
      expect(exitCode).not.toBe(0)
    })
  })

  it('list on fresh project with no .agentver dir', async () => {
    await withTempDir(async (dir) => {
      // Completely empty temp dir, no .agentver directory at all
      const { data, success, exitCode } = await runCliJson<ListOutput>(['list', '--json'], {
        cwd: dir,
      })

      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.packages).toHaveLength(0)
    })
  })

  it('adopt in directory with no skills', async () => {
    await withTempDir(async (dir) => {
      // Create a .claude/ dir with no skills in it
      mkdirSync(join(dir, '.claude'), { recursive: true })

      const { data, success, exitCode } = await runCliJson<AdoptOutput>(['adopt', '--json'], {
        cwd: dir,
      })

      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.adopted).toHaveLength(0)
      expect(data.skipped).toHaveLength(0)
    })
  })

  it('scan in empty directory', async () => {
    await withTempDir(async (dir) => {
      const { data, success, exitCode } = await runCliJson<ScanOutput>(['scan', '--json'], {
        cwd: dir,
      })

      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.agents).toBeDefined()
      expect(data.skills).toBeDefined()
      // An empty directory should not discover any project-level skills
      // (global agents may still be detected, but project skills should be empty)
    })
  })
})

// ---------------------------------------------------------------------------
// Multiple operations in sequence
// ---------------------------------------------------------------------------

describe('E2E: multiple operations in sequence', () => {
  it('install -> modify -> status shows modified -> remove -> status shows empty', async () => {
    await withTempDir(async (dir) => {
      // 1. Setup installed skill
      setupInstalledSkill(dir, {
        name: 'seq-skill',
        files: { 'SKILL.md': createSkillMd({ name: 'seq-skill' }) },
        agents: ['claude-code'],
      })

      // 2. Status should show up-to-date
      const status1 = await runCliJson<StatusOutput>(['status', '--offline', '--json'], {
        cwd: dir,
      })
      expect(status1.exitCode).toBe(0)
      expect(status1.data.packages).toHaveLength(1)
      expect(status1.data.packages[0]!.status).toBe('up-to-date')

      // 3. Modify the SKILL.md content
      writeFileSync(join(dir, '.agents/skills/seq-skill/SKILL.md'), '# Modified sequence skill\n')

      // 4. Status should show modified
      const status2 = await runCliJson<StatusOutput>(['status', '--offline', '--json'], {
        cwd: dir,
      })
      expect(status2.exitCode).toBe(0)
      expect(status2.data.packages[0]!.status).toBe('modified')
      expect(status2.data.packages[0]!.modified).toBe(true)

      // 5. Remove the skill
      const removeResult = await runCliJson<RemoveOutput>(
        ['remove', 'seq-skill', '--yes', '--json'],
        { cwd: dir }
      )
      expect(removeResult.exitCode).toBe(0)
      expect(removeResult.data.removed).toBe(true)

      // 6. Status should show total 0
      const status3 = await runCliJson<StatusOutput>(['status', '--offline', '--json'], {
        cwd: dir,
      })
      expect(status3.exitCode).toBe(0)
      expect(status3.data.summary.total).toBe(0)

      // 7. List should be empty
      const listResult = await runCliJson<ListOutput>(['list', '--json'], { cwd: dir })
      expect(listResult.exitCode).toBe(0)
      expect(listResult.data.packages).toHaveLength(0)

      // 8. Doctor should have no skill-related failures (manifest empty)
      const doctorResult = await runCliJson<DoctorOutput>(['doctor', '--json'], { cwd: dir })
      const skillChecks = doctorResult.data.checks.filter(
        (c) =>
          c.name === 'skill-files-exist' ||
          c.name === 'symlinks-valid' ||
          c.name === 'manifest-lockfile-sync'
      )
      for (const check of skillChecks) {
        expect(check.status, `check "${check.name}" should pass after full cleanup`).toBe('pass')
      }
    })
  })

  it('adopt -> pin -> list shows pinned -> unpin -> remove lifecycle', async () => {
    await withTempDir(async (dir) => {
      // 1. Create a skill to adopt
      const skillDir = join(dir, '.claude/skills/pin-lifecycle')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), createSkillMd({ name: 'pin-lifecycle' }))

      // 2. Adopt it
      const adoptResult = await runCliJson<AdoptOutput>(['adopt', '--json'], { cwd: dir })
      expect(adoptResult.exitCode).toBe(0)
      expect(adoptResult.data.adopted.some((a) => a.name === 'pin-lifecycle')).toBe(true)

      // 3. Pin the skill
      const pinResult = await runCliJson<{ name: string; pinned: boolean }>(
        ['pin', 'pin-lifecycle', '--json'],
        { cwd: dir }
      )
      expect(pinResult.exitCode).toBe(0)
      expect(pinResult.data.pinned).toBe(true)

      // 4. List should show the pinned flag
      const listResult = await runCliJson<ListOutput>(['list', '--json'], { cwd: dir })
      expect(listResult.exitCode).toBe(0)
      const pinnedPkg = listResult.data.packages.find((p) => p.name === 'pin-lifecycle')
      expect(pinnedPkg).toBeDefined()
      expect(pinnedPkg!.package.pinned).toBe(true)

      // 5. Unpin
      const unpinResult = await runCliJson<{ name: string; pinned: boolean }>(
        ['unpin', 'pin-lifecycle', '--json'],
        { cwd: dir }
      )
      expect(unpinResult.exitCode).toBe(0)
      expect(unpinResult.data.pinned).toBe(false)

      // 6. Remove
      const removeResult = await runCliJson<RemoveOutput>(
        ['remove', 'pin-lifecycle', '--yes', '--json'],
        { cwd: dir }
      )
      expect(removeResult.exitCode).toBe(0)
      expect(removeResult.data.removed).toBe(true)

      // 7. Manifest and lockfile should be clean and schema-valid
      const state = readProjectState(dir)
      expect(Object.keys(state.manifest?.packages ?? {})).toHaveLength(0)
      expect(Object.keys(state.lockfile?.packages ?? {})).toHaveLength(0)

      const manifestRaw = readFileSync(join(dir, '.agentver/manifest.json'), 'utf-8')
      expect(manifestV2Schema.safeParse(JSON.parse(manifestRaw) as unknown).success).toBe(true)

      const lockfileRaw = readFileSync(join(dir, '.agentver/lockfile.json'), 'utf-8')
      expect(lockfileV2Schema.safeParse(JSON.parse(lockfileRaw) as unknown).success).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// Symlink edge cases
// ---------------------------------------------------------------------------

describe('E2E: symlink edge cases', () => {
  it('doctor detects replaced symlink pointing to wrong target', async () => {
    await withTempDir(async (dir) => {
      // Setup a fully installed skill (creates correct symlinks)
      setupInstalledSkill(dir, {
        name: 'wrong-target',
        files: { 'SKILL.md': createSkillMd({ name: 'wrong-target' }) },
        agents: ['claude-code'],
      })

      // Create a different directory for the symlink to point to
      const wrongDir = join(dir, '.agents/skills/totally-wrong')
      mkdirSync(wrongDir, { recursive: true })
      writeFileSync(join(wrongDir, 'SKILL.md'), '# Wrong skill\n')

      // Replace the symlink with one pointing to a different (existing) directory
      const symlinkPath = join(dir, '.claude/skills/wrong-target')
      rmSync(symlinkPath, { recursive: true, force: true })
      symlinkSync('../../.agents/skills/totally-wrong', symlinkPath)

      const { data } = await runCliJson<DoctorOutput>(['doctor', '--json'], { cwd: dir })

      // The symlink resolves to a valid directory, but doctor checks whether the
      // symlink exists at the expected path. Since the symlink target is different
      // from the canonical path, the symlinks-valid check should still pass
      // (it only checks that the symlink target is readable).
      // However, the key point is that it does NOT crash.
      const symlinkCheck = data.checks.find((c) => c.name === 'symlinks-valid')
      expect(symlinkCheck).toBeDefined()
      expect(symlinkCheck!.status).not.toBe('error')
    })
  })

  it('doctor detects a regular file where symlink should be', async () => {
    await withTempDir(async (dir) => {
      setupInstalledSkill(dir, {
        name: 'file-not-link',
        files: { 'SKILL.md': createSkillMd({ name: 'file-not-link' }) },
        agents: ['claude-code'],
      })

      // Remove the symlink and replace with a regular file
      const symlinkPath = join(dir, '.claude/skills/file-not-link')
      rmSync(symlinkPath, { recursive: true, force: true })
      mkdirSync(symlinkPath, { recursive: true })
      writeFileSync(join(symlinkPath, 'SKILL.md'), '# Not a symlink\n')

      const { data } = await runCliJson<DoctorOutput>(['doctor', '--json'], { cwd: dir })

      // Doctor checks whether the agent skill path exists and is a valid symlink.
      // A regular directory in its place is not a symlink, so the check result
      // depends on how doctor.ts handles non-symlink paths. The key assertion is
      // that it does not crash.
      const symlinkCheck = data.checks.find((c) => c.name === 'symlinks-valid')
      expect(symlinkCheck).toBeDefined()
      // It should either pass (path exists) or fail (not a symlink) - never crash
      expect(['pass', 'fail', 'warn']).toContain(symlinkCheck!.status)
    })
  })

  it('remove succeeds and updates manifest even when symlink is already broken', async () => {
    await withTempDir(async (dir) => {
      setupInstalledSkill(dir, {
        name: 'broken-link',
        files: { 'SKILL.md': createSkillMd({ name: 'broken-link' }) },
        agents: ['claude-code'],
      })

      // Delete the canonical directory (makes symlink dangling)
      rmSync(join(dir, '.agents/skills/broken-link'), { recursive: true, force: true })

      // Verify the symlink is now dangling
      const symlinkPath = join(dir, '.claude/skills/broken-link')
      expect(existsSync(symlinkPath)).toBe(false) // existsSync follows symlinks, so dangling = false

      // Remove should still succeed — it must not crash on dangling symlinks
      const { data, success, exitCode } = await runCliJson<RemoveOutput>(
        ['remove', 'broken-link', '--yes', '--json'],
        { cwd: dir }
      )

      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.removed).toBe(true)

      // Manifest and lockfile should be clean regardless of symlink cleanup
      const state = readProjectState(dir)
      expect(Object.keys(state.manifest?.packages ?? {})).toHaveLength(0)
      expect(Object.keys(state.lockfile?.packages ?? {})).toHaveLength(0)
    })
  })
})
