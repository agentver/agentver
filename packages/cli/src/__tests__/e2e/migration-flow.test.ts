/**
 * E2E tests for the adopt -> migrate -> list integration flow.
 * Validates the full migration journey: taking pre-existing skill files
 * that a user created manually and bringing them under Agentver management,
 * then migrating to canonical storage with symlinks.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { lockfileV2Schema, manifestV2Schema } from '@agentver/shared'
import { describe, expect, it } from 'vitest'
import { createSkillMd } from '../helpers/fixtures'
import { readProjectState, withTempDir } from '../helpers/mock-fs'
import { runCli, runCliJson } from './helpers'

// ---------------------------------------------------------------------------
// Types for CLI JSON output
// ---------------------------------------------------------------------------

type AdoptOutput = {
  adopted: Array<{ name: string; path: string; type: string; agents: string[] }>
  skipped: Array<{ name: string; reason: string }>
}

type MigrateOutput = {
  migrated: Array<{ name: string; from: string; to: string }>
  skipped: Array<{ name: string; reason: string }>
}

type ListOutput = {
  packages: Array<{
    name: string
    scope: string
    package: {
      source: { type: string; path?: string }
      agents: string[]
    }
  }>
}

type StatusOutput = {
  packages: Array<{ name: string; status: string; modified: boolean }>
  summary: { total: number; upToDate: number; modified: number }
}

// ---------------------------------------------------------------------------
// Full migration flow: adopt -> migrate -> list
// ---------------------------------------------------------------------------

describe('E2E: migration flow', () => {
  it('adopt -> list -> migrate -> list: full journey for a single skill', async () => {
    await withTempDir(async (dir) => {
      // 1. Create "unmanaged" skill files manually
      const skillDir = join(dir, '.claude/skills/my-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        createSkillMd({ name: 'my-skill', description: 'A manually created skill' })
      )

      // 2. Adopt the skill
      const adoptResult = await runCliJson<AdoptOutput>(['adopt', '--json'], { cwd: dir })

      expect(adoptResult.exitCode).toBe(0)
      expect(adoptResult.success).toBe(true)
      expect(adoptResult.data.adopted).toHaveLength(1)
      expect(adoptResult.data.adopted[0]!.name).toBe('my-skill')

      // 3. Verify manifest has the skill with source.type === 'local'
      const stateAfterAdopt = readProjectState(dir)
      expect(stateAfterAdopt.manifest).not.toBeNull()
      expect(stateAfterAdopt.lockfile).not.toBeNull()

      const manifestPkg = Object.values(stateAfterAdopt.manifest!.packages).find(
        (p) => p.name === 'my-skill'
      )
      expect(manifestPkg).toBeDefined()
      expect(manifestPkg!.source.type).toBe('local')

      // 4. Verify lockfile has integrity hash
      const lockfilePkg = Object.values(stateAfterAdopt.lockfile!.packages).find(
        (p) => p.name === 'my-skill'
      )
      expect(lockfilePkg).toBeDefined()
      expect(lockfilePkg!.integrity).toMatch(/^sha256-/)

      // 5. Validate schema compliance after adopt
      const manifestRaw = readFileSync(join(dir, '.agentver/manifest.json'), 'utf-8')
      expect(manifestV2Schema.safeParse(JSON.parse(manifestRaw) as unknown).success).toBe(true)

      const lockfileRaw = readFileSync(join(dir, '.agentver/lockfile.json'), 'utf-8')
      expect(lockfileV2Schema.safeParse(JSON.parse(lockfileRaw) as unknown).success).toBe(true)

      // 6. list --json: verify skill appears with local source
      const listResult = await runCliJson<ListOutput>(['list', '--json'], { cwd: dir })

      expect(listResult.exitCode).toBe(0)
      expect(listResult.data.packages).toHaveLength(1)
      expect(listResult.data.packages[0]!.name).toBe('my-skill')
      expect(listResult.data.packages[0]!.package.source.type).toBe('local')

      // 7. status --json: verify skill shows up
      const statusResult = await runCliJson<StatusOutput>(['status', '--offline', '--json'], {
        cwd: dir,
      })

      expect(statusResult.exitCode).toBe(0)
      expect(statusResult.data.packages).toHaveLength(1)
      expect(statusResult.data.packages[0]!.name).toBe('my-skill')

      // 8. Migrate the skill to canonical storage
      const migrateResult = await runCliJson<MigrateOutput>(['migrate', '--yes', '--json'], {
        cwd: dir,
      })

      expect(migrateResult.exitCode).toBe(0)
      expect(migrateResult.success).toBe(true)
      expect(migrateResult.data.migrated).toHaveLength(1)
      expect(migrateResult.data.migrated[0]!.name).toContain('my-skill')

      // 9. Verify canonical path contains the files
      const canonicalPath = join(dir, '.agents/skills/my-skill')
      expect(existsSync(canonicalPath)).toBe(true)
      expect(existsSync(join(canonicalPath, 'SKILL.md'))).toBe(true)

      // 10. Verify the old path is now a symlink
      const oldPath = join(dir, '.claude/skills/my-skill')
      expect(lstatSync(oldPath).isSymbolicLink()).toBe(true)

      // 11. Verify the symlink is relative (not absolute)
      const symlinkTarget = readlinkSync(oldPath)
      expect(symlinkTarget.startsWith('/')).toBe(false)
      expect(symlinkTarget).toContain('.agents/skills/my-skill')

      // 12. Verify manifest and lockfile are still valid after migration
      const manifestRawAfterMigrate = readFileSync(join(dir, '.agentver/manifest.json'), 'utf-8')
      expect(
        manifestV2Schema.safeParse(JSON.parse(manifestRawAfterMigrate) as unknown).success
      ).toBe(true)

      const lockfileRawAfterMigrate = readFileSync(join(dir, '.agentver/lockfile.json'), 'utf-8')
      expect(
        lockfileV2Schema.safeParse(JSON.parse(lockfileRawAfterMigrate) as unknown).success
      ).toBe(true)

      // 13. list --json: skill still present with same metadata after migration
      const listAfterMigrate = await runCliJson<ListOutput>(['list', '--json'], { cwd: dir })

      expect(listAfterMigrate.exitCode).toBe(0)
      expect(listAfterMigrate.data.packages).toHaveLength(1)
      expect(listAfterMigrate.data.packages[0]!.name).toBe('my-skill')
      expect(listAfterMigrate.data.packages[0]!.package.source.type).toBe('local')
    })
  })

  it('adopt -> migrate multiple skills simultaneously', async () => {
    await withTempDir(async (dir) => {
      // Create two unmanaged skills
      for (const name of ['skill-alpha', 'skill-beta']) {
        const skillDir = join(dir, `.claude/skills/${name}`)
        mkdirSync(skillDir, { recursive: true })
        writeFileSync(join(skillDir, 'SKILL.md'), createSkillMd({ name }))
      }

      // Adopt both
      const adoptResult = await runCliJson<AdoptOutput>(['adopt', '--json'], { cwd: dir })

      expect(adoptResult.exitCode).toBe(0)
      expect(adoptResult.data.adopted).toHaveLength(2)

      const adoptedNames = adoptResult.data.adopted.map((a) => a.name).sort()
      expect(adoptedNames).toEqual(['skill-alpha', 'skill-beta'])

      // Migrate both
      const migrateResult = await runCliJson<MigrateOutput>(['migrate', '--yes', '--json'], {
        cwd: dir,
      })

      expect(migrateResult.exitCode).toBe(0)
      expect(migrateResult.data.migrated).toHaveLength(2)

      // Both skills should be in canonical storage with symlinks
      for (const name of ['skill-alpha', 'skill-beta']) {
        const canonicalPath = join(dir, `.agents/skills/${name}`)
        expect(existsSync(canonicalPath)).toBe(true)
        expect(existsSync(join(canonicalPath, 'SKILL.md'))).toBe(true)

        const oldPath = join(dir, `.claude/skills/${name}`)
        expect(lstatSync(oldPath).isSymbolicLink()).toBe(true)

        const symlinkTarget = readlinkSync(oldPath)
        expect(symlinkTarget.startsWith('/')).toBe(false)
      }

      // List should show both
      const listResult = await runCliJson<ListOutput>(['list', '--json'], { cwd: dir })

      expect(listResult.exitCode).toBe(0)
      expect(listResult.data.packages).toHaveLength(2)

      const listedNames = listResult.data.packages.map((p) => p.name).sort()
      expect(listedNames).toEqual(['skill-alpha', 'skill-beta'])
    })
  })

  it('migrate is idempotent: skips already-canonical skills', async () => {
    await withTempDir(async (dir) => {
      const skillDir = join(dir, '.claude/skills/idem-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), createSkillMd({ name: 'idem-skill' }))

      // Adopt
      await runCliJson<AdoptOutput>(['adopt', '--json'], { cwd: dir })

      // Migrate once
      const firstMigrate = await runCliJson<MigrateOutput>(['migrate', '--yes', '--json'], {
        cwd: dir,
      })

      expect(firstMigrate.exitCode).toBe(0)
      expect(firstMigrate.data.migrated).toHaveLength(1)

      // Migrate again — should skip
      const secondMigrate = await runCliJson<MigrateOutput>(['migrate', '--yes', '--json'], {
        cwd: dir,
      })

      expect(secondMigrate.exitCode).toBe(0)
      expect(secondMigrate.data.migrated).toHaveLength(0)
      expect(secondMigrate.data.skipped).toHaveLength(1)
      expect(secondMigrate.data.skipped[0]!.reason).toContain('canonical')

      // Files should still be intact
      const canonicalPath = join(dir, '.agents/skills/idem-skill')
      expect(existsSync(join(canonicalPath, 'SKILL.md'))).toBe(true)
    })
  })

  it('migrate preserves skill file content', async () => {
    await withTempDir(async (dir) => {
      const originalContent = createSkillMd({
        name: 'content-skill',
        description: 'Content preservation test',
        version: '2.5.0',
      })

      const skillDir = join(dir, '.claude/skills/content-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), originalContent)
      writeFileSync(join(skillDir, 'helpers.txt'), 'Reference content for the skill.\n')

      // Adopt and migrate
      await runCliJson<AdoptOutput>(['adopt', '--json'], { cwd: dir })
      await runCliJson<MigrateOutput>(['migrate', '--yes', '--json'], { cwd: dir })

      // Verify content at canonical path matches original
      const canonicalSkillMd = readFileSync(
        join(dir, '.agents/skills/content-skill/SKILL.md'),
        'utf-8'
      )
      expect(canonicalSkillMd).toBe(originalContent)

      const canonicalHelpers = readFileSync(
        join(dir, '.agents/skills/content-skill/helpers.txt'),
        'utf-8'
      )
      expect(canonicalHelpers).toBe('Reference content for the skill.\n')

      // Verify content is accessible through the symlink
      const symlinkSkillMd = readFileSync(
        join(dir, '.claude/skills/content-skill/SKILL.md'),
        'utf-8'
      )
      expect(symlinkSkillMd).toBe(originalContent)
    })
  })

  it('migrate --dry-run makes no filesystem changes', async () => {
    await withTempDir(async (dir) => {
      const skillDir = join(dir, '.claude/skills/dry-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), createSkillMd({ name: 'dry-skill' }))

      await runCliJson<AdoptOutput>(['adopt', '--json'], { cwd: dir })

      const migrateResult = await runCliJson<MigrateOutput>(['migrate', '--dry-run', '--json'], {
        cwd: dir,
      })

      expect(migrateResult.exitCode).toBe(0)
      expect(migrateResult.data.migrated).toHaveLength(1)

      // Canonical path should NOT exist (dry run)
      expect(existsSync(join(dir, '.agents/skills/dry-skill'))).toBe(false)

      // Original path should still be a real directory, not a symlink
      const oldPath = join(dir, '.claude/skills/dry-skill')
      expect(existsSync(oldPath)).toBe(true)
      expect(lstatSync(oldPath).isDirectory()).toBe(true)
      expect(lstatSync(oldPath).isSymbolicLink()).toBe(false)
    })
  })

  it('adopt -> migrate -> status: skill is up-to-date after migration', async () => {
    await withTempDir(async (dir) => {
      const skillDir = join(dir, '.claude/skills/status-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), createSkillMd({ name: 'status-skill' }))

      // Adopt
      await runCliJson<AdoptOutput>(['adopt', '--json'], { cwd: dir })

      // Migrate
      await runCliJson<MigrateOutput>(['migrate', '--yes', '--json'], { cwd: dir })

      // Status should show up-to-date (not modified)
      const statusResult = await runCliJson<StatusOutput>(['status', '--offline', '--json'], {
        cwd: dir,
      })

      expect(statusResult.exitCode).toBe(0)
      expect(statusResult.data.summary.total).toBe(1)
      expect(statusResult.data.packages[0]!.name).toBe('status-skill')
      expect(statusResult.data.packages[0]!.status).toBe('up-to-date')
    })
  })

  it('adopt -> migrate by name: migrates only the specified skill', async () => {
    await withTempDir(async (dir) => {
      // Create two skills
      for (const name of ['target-skill', 'other-skill']) {
        const skillDir = join(dir, `.claude/skills/${name}`)
        mkdirSync(skillDir, { recursive: true })
        writeFileSync(join(skillDir, 'SKILL.md'), createSkillMd({ name }))
      }

      // Adopt both
      await runCliJson<AdoptOutput>(['adopt', '--json'], { cwd: dir })

      // Read manifest to find the key for target-skill
      const state = readProjectState(dir)
      const targetKey = Object.keys(state.manifest!.packages).find((key) => {
        const pkg = state.manifest!.packages[key]!
        return pkg.name === 'target-skill'
      })
      expect(targetKey).toBeDefined()

      // Migrate only target-skill by its manifest key
      const migrateResult = await runCliJson<MigrateOutput>(
        ['migrate', targetKey!, '--yes', '--json'],
        { cwd: dir }
      )

      expect(migrateResult.exitCode).toBe(0)
      expect(migrateResult.data.migrated).toHaveLength(1)
      expect(migrateResult.data.migrated[0]!.name).toContain('target-skill')

      // target-skill should be canonical
      expect(existsSync(join(dir, '.agents/skills/target-skill/SKILL.md'))).toBe(true)
      expect(lstatSync(join(dir, '.claude/skills/target-skill')).isSymbolicLink()).toBe(true)

      // other-skill should remain as a regular directory (not migrated)
      const otherPath = join(dir, '.claude/skills/other-skill')
      expect(existsSync(otherPath)).toBe(true)
      expect(lstatSync(otherPath).isDirectory()).toBe(true)
      expect(lstatSync(otherPath).isSymbolicLink()).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// Symlink correctness after migration
// ---------------------------------------------------------------------------

describe('E2E: migration symlink correctness', () => {
  it('symlinks are relative, not absolute', async () => {
    await withTempDir(async (dir) => {
      const skillDir = join(dir, '.claude/skills/rel-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), createSkillMd({ name: 'rel-skill' }))

      await runCliJson<AdoptOutput>(['adopt', '--json'], { cwd: dir })
      await runCliJson<MigrateOutput>(['migrate', '--yes', '--json'], { cwd: dir })

      const symlinkPath = join(dir, '.claude/skills/rel-skill')
      const target = readlinkSync(symlinkPath)

      // Must be relative
      expect(target.startsWith('/')).toBe(false)

      // Must point to the canonical location
      expect(target).toContain('.agents/skills/rel-skill')
    })
  })

  it('symlinked skill content is readable through the symlink', async () => {
    await withTempDir(async (dir) => {
      const content = createSkillMd({ name: 'readable-skill' })
      const skillDir = join(dir, '.claude/skills/readable-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), content)

      await runCliJson<AdoptOutput>(['adopt', '--json'], { cwd: dir })
      await runCliJson<MigrateOutput>(['migrate', '--yes', '--json'], { cwd: dir })

      // Reading through the symlink should yield the same content
      const throughSymlink = readFileSync(
        join(dir, '.claude/skills/readable-skill/SKILL.md'),
        'utf-8'
      )
      const fromCanonical = readFileSync(
        join(dir, '.agents/skills/readable-skill/SKILL.md'),
        'utf-8'
      )

      expect(throughSymlink).toBe(fromCanonical)
      expect(throughSymlink).toBe(content)
    })
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('E2E: migration edge cases', () => {
  it('migrate with no managed skills is a no-op', async () => {
    await withTempDir(async (dir) => {
      // Create the skill file but do NOT adopt
      const skillDir = join(dir, '.claude/skills/orphan-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), createSkillMd({ name: 'orphan-skill' }))

      const result = await runCli(['migrate', '--yes', '--json'], { cwd: dir })

      // Should not crash — either succeeds with empty result or exits cleanly
      expect(result.exitCode).toBe(0)
    })
  })

  it('adopt -> migrate preserves multi-file skill directories', async () => {
    await withTempDir(async (dir) => {
      const skillDir = join(dir, '.claude/skills/multi-file')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), createSkillMd({ name: 'multi-file' }))
      writeFileSync(join(skillDir, 'reference.txt'), 'Reference data for the skill.\n')
      writeFileSync(join(skillDir, 'config.yaml'), 'key: value\n')

      // Create a subdirectory with content
      mkdirSync(join(skillDir, 'templates'), { recursive: true })
      writeFileSync(join(skillDir, 'templates/default.txt'), 'Default template content.\n')

      await runCliJson<AdoptOutput>(['adopt', '--json'], { cwd: dir })
      await runCliJson<MigrateOutput>(['migrate', '--yes', '--json'], { cwd: dir })

      // All files should be present at canonical path
      const canonical = join(dir, '.agents/skills/multi-file')
      expect(existsSync(join(canonical, 'SKILL.md'))).toBe(true)
      expect(existsSync(join(canonical, 'reference.txt'))).toBe(true)
      expect(existsSync(join(canonical, 'config.yaml'))).toBe(true)
      expect(existsSync(join(canonical, 'templates/default.txt'))).toBe(true)

      // Content integrity
      expect(readFileSync(join(canonical, 'reference.txt'), 'utf-8')).toBe(
        'Reference data for the skill.\n'
      )
      expect(readFileSync(join(canonical, 'templates/default.txt'), 'utf-8')).toBe(
        'Default template content.\n'
      )
    })
  })
})
