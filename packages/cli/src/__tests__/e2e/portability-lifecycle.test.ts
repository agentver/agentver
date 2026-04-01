/**
 * E2E tests for the full portability lifecycle: Machine A to Machine B.
 *
 * Validates Agentver's core promise — install on Machine A, adopt skills,
 * move to Machine B, restore everything from the manifest.
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalSource, ManifestV2Package, UnknownSource } from '@agentver/shared'
import { lockfileV2Schema, manifestV2Schema } from '@agentver/shared'
import { describe, expect, it } from 'vitest'
import { createPlatformSource, createSharedGitSource, createSkillMd } from '../helpers/fixtures'
import { readProjectState, seedProject, withTempDir } from '../helpers/mock-fs'
import { parseCiJson, type RestoreResult, runCli, runCliJson, setupInstalledSkill } from './helpers'

// ---------------------------------------------------------------------------
// Git helpers (same pattern as adopt-promote-lifecycle.test.ts)
// ---------------------------------------------------------------------------

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@test.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@test.com',
}

function gitExec(cmd: string, dir: string): void {
  execSync(cmd, {
    cwd: dir,
    env: { ...process.env, HOME: dir, ...GIT_ENV },
    stdio: 'pipe',
  })
}

function initEmptyGitRepo(
  dir: string,
  remote = 'https://github.com/test-user/test-repo.git'
): void {
  gitExec('git init', dir)
  gitExec(`git remote add origin ${remote}`, dir)
  gitExec('git commit -m "initial commit" --allow-empty', dir)
}

// ---------------------------------------------------------------------------
// JSON output types
// ---------------------------------------------------------------------------

type AdoptOutput = {
  adopted: Array<{ name: string; path: string; type: string; sourceInfo?: string }>
  skipped: Array<{ name: string; reason: string }>
}

type StatusOutput = {
  packages: Array<{
    name: string
    status: string
    modified: boolean
    upstream: boolean
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

type DoctorCheck = { name: string; status: string; message: string }
type DoctorOutput = {
  checks: DoctorCheck[]
  passed: number
  failed: number
  warnings: number
}

// ---------------------------------------------------------------------------
// E2E: full portability lifecycle — Machine A to Machine B
// ---------------------------------------------------------------------------

describe('E2E: full portability lifecycle — Machine A to Machine B', () => {
  it('adopt on Machine A, transfer manifest, restore reports on Machine B', async () => {
    await withTempDir(async (machineA) => {
      // Machine A: create three skills
      const skillNames = ['skill-alpha', 'skill-beta', 'skill-gamma'] as const

      const alphaDir = join(machineA, '.claude/skills/skill-alpha')
      mkdirSync(alphaDir, { recursive: true })
      writeFileSync(join(alphaDir, 'SKILL.md'), createSkillMd({ name: 'skill-alpha' }))

      const betaDir = join(machineA, '.claude/skills/skill-beta')
      mkdirSync(betaDir, { recursive: true })
      writeFileSync(join(betaDir, 'SKILL.md'), createSkillMd({ name: 'skill-beta' }))
      writeFileSync(join(betaDir, 'helper.txt'), 'Additional reference content.\n')

      const gammaDir = join(machineA, '.claude/skills/skill-gamma')
      mkdirSync(gammaDir, { recursive: true })
      writeFileSync(join(gammaDir, 'SKILL.md'), createSkillMd({ name: 'skill-gamma' }))

      // Adopt all three on Machine A
      const { data: adoptData, exitCode: adoptExit } = await runCliJson<AdoptOutput>(
        ['adopt', '--json'],
        { cwd: machineA }
      )

      expect(adoptExit).toBe(0)
      expect(adoptData.adopted).toHaveLength(3)

      for (const name of skillNames) {
        const entry = adoptData.adopted.find((a) => a.name === name)
        expect(entry).toBeDefined()
      }

      // All should be local source (not in a git repo)
      const stateA = readProjectState(machineA)
      expect(stateA.manifest).not.toBeNull()
      expect(stateA.lockfile).not.toBeNull()

      for (const name of skillNames) {
        const manifestPkg = Object.values(stateA.manifest!.packages).find((p) => p.name === name)
        expect(manifestPkg).toBeDefined()
        expect(manifestPkg!.source.type).toBe('local')
      }

      // Read manifest and lockfile from Machine A
      const manifestJson = readFileSync(join(machineA, '.agentver/manifest.json'), 'utf-8')
      const lockfileJson = readFileSync(join(machineA, '.agentver/lockfile.json'), 'utf-8')

      // Validate schema compliance
      expect(manifestV2Schema.safeParse(JSON.parse(manifestJson) as unknown).success).toBe(true)
      expect(lockfileV2Schema.safeParse(JSON.parse(lockfileJson) as unknown).success).toBe(true)

      // Machine B: fresh directory with only manifest + lockfile
      await withTempDir(async (machineB) => {
        // Create .claude dir so agent detection works
        mkdirSync(join(machineB, '.claude'), { recursive: true })

        // Transfer manifest + lockfile
        const agentverDir = join(machineB, '.agentver')
        mkdirSync(agentverDir, { recursive: true })
        writeFileSync(join(agentverDir, 'manifest.json'), manifestJson)
        writeFileSync(join(agentverDir, 'lockfile.json'), lockfileJson)

        // Restore on Machine B
        const {
          data: restoreData,
          success,
          exitCode,
        } = await runCliJson<RestoreResult>(['install', '--json', '--yes'], { cwd: machineB })

        expect(exitCode).toBe(0)
        expect(success).toBe(true)
        expect(restoreData.type).toBe('RESTORE_COMPLETE')
        expect(restoreData.success).toBe(true)

        // All three should be skipped as local sources can't be restored
        const skippedPackages = restoreData.packages.filter((p) => p.status === 'skipped')
        expect(skippedPackages.length).toBe(3)

        for (const name of skillNames) {
          const entry = skippedPackages.find((p) => p.displayName === name)
          expect(entry).toBeDefined()
          expect(entry!.reason).toContain('Local')
        }
      })
    })
  })

  it('adopt with git source on Machine A, manifest is restorable on Machine B', async () => {
    await withTempDir(async (machineA) => {
      // Init git repo with remote
      writeFileSync(join(machineA, '.gitkeep'), '')
      initEmptyGitRepo(machineA)

      // Create and commit a skill
      const skillDir = join(machineA, '.claude/skills/git-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), createSkillMd({ name: 'git-skill' }))

      gitExec('git add .', machineA)
      gitExec('git commit -m "add git-skill"', machineA)

      // Adopt
      const { data: adoptData, exitCode: adoptExit } = await runCliJson<AdoptOutput>(
        ['adopt', '--json'],
        { cwd: machineA }
      )

      expect(adoptExit).toBe(0)
      expect(adoptData.adopted.some((a) => a.name === 'git-skill')).toBe(true)

      // Verify it was adopted with git source
      const stateA = readProjectState(machineA)
      const manifestPkg = Object.values(stateA.manifest!.packages).find(
        (p) => p.name === 'git-skill'
      )
      expect(manifestPkg).toBeDefined()
      expect(manifestPkg!.source.type).toBe('git')

      // Read manifest and lockfile from Machine A
      const manifestJson = readFileSync(join(machineA, '.agentver/manifest.json'), 'utf-8')
      const lockfileJson = readFileSync(join(machineA, '.agentver/lockfile.json'), 'utf-8')

      // Machine B
      await withTempDir(async (machineB) => {
        mkdirSync(join(machineB, '.claude'), { recursive: true })

        const agentverDir = join(machineB, '.agentver')
        mkdirSync(agentverDir, { recursive: true })
        writeFileSync(join(agentverDir, 'manifest.json'), manifestJson)
        writeFileSync(join(agentverDir, 'lockfile.json'), lockfileJson)

        // Restore offline (fake remote can't be fetched)
        const {
          data: restoreData,
          success,
          exitCode,
        } = await runCliJson<RestoreResult>(['install', '--offline', '--json', '--yes'], {
          cwd: machineB,
        })

        expect(exitCode).toBe(0)
        expect(success).toBe(true)
        expect(restoreData.type).toBe('RESTORE_COMPLETE')

        // Git-sourced skill should be skipped with offline reason (NOT local reason)
        const skippedPackages = restoreData.packages.filter((p) => p.status === 'skipped')
        expect(skippedPackages.length).toBeGreaterThanOrEqual(1)

        const gitEntry = skippedPackages.find((p) => p.displayName === 'git-skill')
        expect(gitEntry).toBeDefined()
        expect(gitEntry!.reason).toContain('offline')
        // Confirm it's NOT classified as a local source skip
        expect(gitEntry!.reason).not.toContain('Local')
      })
    })
  })

  it('status command works after transferring manifest to new machine', async () => {
    await withTempDir(async (machineA) => {
      setupInstalledSkill(machineA, {
        name: 'status-skill',
        files: { 'SKILL.md': createSkillMd({ name: 'status-skill' }) },
        agents: ['claude-code'],
      })

      const manifestJson = readFileSync(join(machineA, '.agentver/manifest.json'), 'utf-8')
      const lockfileJson = readFileSync(join(machineA, '.agentver/lockfile.json'), 'utf-8')

      await withTempDir(async (machineB) => {
        mkdirSync(join(machineB, '.claude'), { recursive: true })

        const agentverDir = join(machineB, '.agentver')
        mkdirSync(agentverDir, { recursive: true })
        writeFileSync(join(agentverDir, 'manifest.json'), manifestJson)
        writeFileSync(join(agentverDir, 'lockfile.json'), lockfileJson)

        // Run status offline (no files on disk, only manifest/lockfile)
        const { data, exitCode, success } = await runCliJson<StatusOutput>(
          ['status', '--offline', '--json'],
          { cwd: machineB }
        )

        expect(exitCode).toBe(0)
        expect(success).toBe(true)
        expect(data.summary.total).toBe(1)

        // The skill should show as up-to-date (local files missing means
        // the integrity comparison has nothing to compare, so it doesn't
        // flag as modified) or as unknown — either way, status runs.
        const pkg = data.packages.find((p) => p.name === 'status-skill')
        expect(pkg).toBeDefined()
      })
    })
  })

  it('doctor detects transferred manifest with missing files', async () => {
    await withTempDir(async (machineA) => {
      setupInstalledSkill(machineA, {
        name: 'doctor-skill',
        files: { 'SKILL.md': createSkillMd({ name: 'doctor-skill' }) },
        agents: ['claude-code'],
      })

      const manifestJson = readFileSync(join(machineA, '.agentver/manifest.json'), 'utf-8')
      const lockfileJson = readFileSync(join(machineA, '.agentver/lockfile.json'), 'utf-8')

      await withTempDir(async (machineB) => {
        mkdirSync(join(machineB, '.claude'), { recursive: true })

        const agentverDir = join(machineB, '.agentver')
        mkdirSync(agentverDir, { recursive: true })
        writeFileSync(join(agentverDir, 'manifest.json'), manifestJson)
        writeFileSync(join(agentverDir, 'lockfile.json'), lockfileJson)

        // Doctor should detect that skill files are missing
        const { data } = await runCliJson<DoctorOutput>(['doctor', '--json'], { cwd: machineB })

        const filesCheck = data.checks.find((c) => c.name === 'skill-files-exist')
        expect(filesCheck).toBeDefined()
        expect(filesCheck!.status).toBe('fail')
        expect(filesCheck!.message).toContain('doctor-skill')

        // Manifest/lockfile integrity should still pass (valid JSON, correct schema)
        const manifestCheck = data.checks.find((c) => c.name === 'manifest-integrity')
        expect(manifestCheck).toBeDefined()
        expect(manifestCheck!.status).toBe('pass')

        const lockfileCheck = data.checks.find((c) => c.name === 'lockfile-integrity')
        expect(lockfileCheck).toBeDefined()
        expect(lockfileCheck!.status).toBe('pass')
      })
    })
  })
})

// ---------------------------------------------------------------------------
// E2E: adopt multi-file skills preserve integrity
// ---------------------------------------------------------------------------

describe('E2E: adopt multi-file skills preserve integrity', () => {
  it('adopt correctly computes integrity for multi-file skill directory', async () => {
    await withTempDir(async (dir) => {
      const skillDir = join(dir, '.claude/skills/multi-file-skill')
      mkdirSync(skillDir, { recursive: true })
      mkdirSync(join(skillDir, 'examples'), { recursive: true })

      writeFileSync(join(skillDir, 'SKILL.md'), createSkillMd({ name: 'multi-file-skill' }))
      writeFileSync(join(skillDir, 'examples/usage.txt'), 'Example usage content.\n')
      writeFileSync(join(skillDir, 'config.txt'), 'Multi file skill configuration.\n')

      // Adopt
      const { data: adoptData, exitCode: adoptExit } = await runCliJson<AdoptOutput>(
        ['adopt', '--json'],
        { cwd: dir }
      )

      expect(adoptExit).toBe(0)
      expect(adoptData.adopted.some((a) => a.name === 'multi-file-skill')).toBe(true)

      // Lockfile should have integrity
      const state = readProjectState(dir)
      expect(state.lockfile).not.toBeNull()

      const lockfilePkg = Object.values(state.lockfile!.packages).find(
        (p) => p.name === 'multi-file-skill'
      )
      expect(lockfilePkg).toBeDefined()
      expect(lockfilePkg!.integrity).toMatch(/^sha256-/)

      // Status should show up-to-date (integrity matches)
      const { data: statusData, exitCode: statusExit } = await runCliJson<StatusOutput>(
        ['status', '--offline', '--json'],
        { cwd: dir }
      )

      expect(statusExit).toBe(0)
      const statusPkg = statusData.packages.find((p) => p.name === 'multi-file-skill')
      expect(statusPkg).toBeDefined()
      expect(statusPkg!.status).toBe('up-to-date')

      // Modify one file
      writeFileSync(join(skillDir, 'examples/usage.md'), '# Updated Usage\n\nModified content.\n')

      // Status should now show modified
      const { data: statusAfter, exitCode: statusAfterExit } = await runCliJson<StatusOutput>(
        ['status', '--offline', '--json'],
        { cwd: dir }
      )

      expect(statusAfterExit).toBe(0)
      const modifiedPkg = statusAfter.packages.find((p) => p.name === 'multi-file-skill')
      expect(modifiedPkg).toBeDefined()
      expect(modifiedPkg!.status).toBe('modified')
    })
  })

  it('adopt preserves original file locations — no files moved or copied', async () => {
    await withTempDir(async (dir) => {
      const skillDir = join(dir, '.claude/skills/my-skill')
      mkdirSync(skillDir, { recursive: true })

      const originalContent = createSkillMd({ name: 'my-skill' })
      const skillPath = join(skillDir, 'SKILL.md')
      writeFileSync(skillPath, originalContent)

      // Record before adopt
      const contentBefore = readFileSync(skillPath, 'utf-8')

      // Adopt
      const { data, exitCode } = await runCliJson<AdoptOutput>(['adopt', '--json'], { cwd: dir })

      expect(exitCode).toBe(0)
      expect(data.adopted.some((a) => a.name === 'my-skill')).toBe(true)

      // Original file should still exist at the same location
      expect(existsSync(skillPath)).toBe(true)
      const contentAfter = readFileSync(skillPath, 'utf-8')
      expect(contentAfter).toBe(contentBefore)

      // Manifest and lockfile should exist
      const state = readProjectState(dir)
      expect(state.manifest).not.toBeNull()
      expect(state.lockfile).not.toBeNull()

      // Verify the manifest source points to the original path
      const manifestPkg = Object.values(state.manifest!.packages).find((p) => p.name === 'my-skill')
      expect(manifestPkg).toBeDefined()
      expect(manifestPkg!.source.type).toBe('local')
    })
  })
})

// ---------------------------------------------------------------------------
// E2E: manifest portability edge cases
// ---------------------------------------------------------------------------

describe('E2E: manifest portability edge cases', () => {
  it('manifest with mixed source types classifies each correctly on restore', async () => {
    await withTempDir(async (dir) => {
      mkdirSync(join(dir, '.claude'), { recursive: true })

      const localSource: LocalSource = { type: 'local', path: '/original/machine/path' }
      const unknownSource: UnknownSource = {
        type: 'unknown',
        reason: 'Imported from legacy format',
      }
      const gitSource = createSharedGitSource({
        uri: 'https://github.com/owner/skills-repo',
        path: 'skills/git-skill',
      })
      const platformSource = createPlatformSource({
        uri: 'agentver://test-org',
        path: 'skills/platform-skill',
      })

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
            'unknown-skill': {
              source: unknownSource,
              agents: ['claude-code'],
              installedAt: new Date().toISOString(),
              modified: false,
            } satisfies ManifestV2Package,
            'git-skill': {
              source: gitSource,
              agents: ['claude-code'],
              installedAt: new Date().toISOString(),
              modified: false,
            } satisfies ManifestV2Package,
            'platform-skill': {
              source: platformSource,
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
              integrity: 'sha256-local111',
              agents: ['claude-code'],
            },
            'unknown-skill': {
              source: unknownSource,
              integrity: 'sha256-unknown222',
              agents: ['claude-code'],
            },
            'git-skill': {
              source: gitSource,
              integrity: 'sha256-git333',
              agents: ['claude-code'],
            },
            'platform-skill': {
              source: platformSource,
              integrity: 'sha256-platform444',
              agents: ['claude-code'],
            },
          },
        },
      })

      const { data, success, exitCode } = await runCliJson<RestoreResult>(
        ['install', '--offline', '--json', '--yes'],
        { cwd: dir }
      )

      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.type).toBe('RESTORE_COMPLETE')
      expect(data.success).toBe(true)

      const skipped = data.packages.filter((p) => p.status === 'skipped')
      expect(skipped.length).toBe(4)

      // Local entry: skipped because local source
      const localEntry = skipped.find((p) => p.packageKey === 'local-skill')
      expect(localEntry).toBeDefined()
      expect(localEntry!.reason).toContain('Local')

      // Unknown entry: skipped because unknown source
      const unknownEntry = skipped.find((p) => p.packageKey === 'unknown-skill')
      expect(unknownEntry).toBeDefined()
      expect(unknownEntry!.reason).toContain('Unknown')

      // Git entry: skipped because offline (it IS restorable, just not right now)
      const gitEntry = skipped.find((p) => p.packageKey === 'git-skill')
      expect(gitEntry).toBeDefined()
      expect(gitEntry!.reason).toContain('offline')

      // Platform entry: skipped because offline (it IS restorable, just not right now)
      const platformEntry = skipped.find((p) => p.packageKey === 'platform-skill')
      expect(platformEntry).toBeDefined()
      expect(platformEntry!.reason).toContain('offline')
    })
  })

  it('ci command validates manifest integrity before restore', async () => {
    await withTempDir(async (dir) => {
      setupInstalledSkill(dir, {
        name: 'ci-test-skill',
        files: { 'SKILL.md': createSkillMd({ name: 'ci-test-skill' }) },
        agents: ['claude-code'],
      })

      // First ci run — should pass
      const result1 = await runCli(['ci', '--json'], { cwd: dir })
      const { data: ciData1, success: ciSuccess1 } = parseCiJson(result1.stdout)

      expect(result1.exitCode).toBe(0)
      expect(ciSuccess1).toBe(true)
      expect(ciData1.success).toBe(true)
      expect(ciData1.restore.success).toBe(true)

      const upToDate = ciData1.restore.packages.filter((p) => p.status === 'up-to-date')
      expect(upToDate.length).toBeGreaterThanOrEqual(1)
      expect(upToDate.some((p) => p.displayName === 'ci-test-skill')).toBe(true)

      // Corrupt the lockfile integrity value
      const lockfilePath = join(dir, '.agentver/lockfile.json')
      const lockfileRaw = readFileSync(lockfilePath, 'utf-8')
      const lockfileData = JSON.parse(lockfileRaw) as Record<string, unknown>
      const packages = lockfileData.packages as Record<
        string,
        { integrity: string; source: unknown; agents: string[] }
      >
      const ciSkillPkg = packages['ci-test-skill']
      expect(ciSkillPkg).toBeDefined()
      ciSkillPkg!.integrity = 'sha256-CORRUPTED000'
      writeFileSync(lockfilePath, JSON.stringify(lockfileData, null, 2))

      // Second ci run — should detect the mismatch
      const result2 = await runCli(['ci', '--json'], { cwd: dir })
      const { data: ciData2 } = parseCiJson(result2.stdout)

      // The skill is no longer up-to-date because its integrity hash no longer matches
      const upToDate2 = ciData2.restore.packages.filter((p) => p.status === 'up-to-date')
      const notUpToDate = !upToDate2.some((p) => p.displayName === 'ci-test-skill')
      expect(notUpToDate).toBe(true)
    })
  })
})
