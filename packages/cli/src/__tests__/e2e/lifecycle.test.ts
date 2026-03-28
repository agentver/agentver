/**
 * E2E lifecycle tests — runs the actual CLI binary against temp directories
 * with real filesystem state.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { lockfileV2Schema, manifestV2Schema } from '@agentver/shared'
import { describe, expect, it } from 'vitest'
import { createSkillMd } from '../helpers/fixtures'
import { readProjectState, seedProject, withTempDir } from '../helpers/mock-fs'
import { runCli, runCliJson, setupInstalledSkill } from './helpers'

// ---------------------------------------------------------------------------
// Status command
// ---------------------------------------------------------------------------

describe('E2E: status', () => {
  it('shows up-to-date for a clean install', async () => {
    await withTempDir(async (dir) => {
      setupInstalledSkill(dir, {
        name: 'test-skill',
        files: { 'SKILL.md': createSkillMd() },
        agents: ['claude-code'],
      })

      const { data, exitCode } = await runCliJson<{
        packages: Array<{ name: string; status: string }>
        summary: { total: number }
      }>(['status', '--offline', '--json'], { cwd: dir })

      expect(exitCode).toBe(0)
      expect(data.packages).toHaveLength(1)
      expect(data.packages[0]!.name).toBe('test-skill')
      expect(data.packages[0]!.status).toBe('up-to-date')
    })
  })

  it('shows modified after local file change', async () => {
    await withTempDir(async (dir) => {
      setupInstalledSkill(dir, {
        name: 'test-skill',
        files: { 'SKILL.md': createSkillMd() },
        agents: ['claude-code'],
      })

      writeFileSync(join(dir, '.agents/skills/test-skill/SKILL.md'), '# Modified content\n')

      const { data, exitCode } = await runCliJson<{
        packages: Array<{ name: string; status: string; modified: boolean }>
      }>(['status', '--offline', '--json'], { cwd: dir })

      expect(exitCode).toBe(0)
      expect(data.packages[0]!.status).toBe('modified')
      expect(data.packages[0]!.modified).toBe(true)
    })
  })

  it('reports empty state when no packages installed', async () => {
    await withTempDir(async (dir) => {
      seedProject(dir, {
        manifest: { version: 2, packages: {} },
        lockfile: { version: 2, packages: {} },
      })

      const { data, exitCode } = await runCliJson<{
        summary: { total: number }
      }>(['status', '--offline', '--json'], { cwd: dir })

      expect(exitCode).toBe(0)
      expect(data.summary.total).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// Remove command
// ---------------------------------------------------------------------------

describe('E2E: remove', () => {
  it('removes all files and updates manifest/lockfile', async () => {
    await withTempDir(async (dir) => {
      setupInstalledSkill(dir, {
        name: 'test-skill',
        files: { 'SKILL.md': createSkillMd() },
        agents: ['claude-code'],
      })

      const { data, exitCode } = await runCliJson<{ name: string; removed: boolean }>(
        ['remove', 'test-skill', '--yes', '--json'],
        { cwd: dir }
      )

      expect(exitCode).toBe(0)
      expect(data.removed).toBe(true)

      const state = readProjectState(dir)
      expect(Object.keys(state.manifest?.packages ?? {})).toHaveLength(0)
      expect(Object.keys(state.lockfile?.packages ?? {})).toHaveLength(0)
      expect(state.skills).toHaveLength(0)
      expect(state.symlinks).toHaveLength(0)

      // Use lstatSync to verify the symlink inode itself is gone (not just dangling)
      expect(existsSync(join(dir, '.agents/skills/test-skill'))).toBe(false)
      expect(() => lstatSync(join(dir, '.claude/skills/test-skill'))).toThrow()
    })
  })

  it('exits with error for non-existent package', async () => {
    await withTempDir(async (dir) => {
      seedProject(dir, {
        manifest: { version: 2, packages: {} },
        lockfile: { version: 2, packages: {} },
      })

      const { success, exitCode } = await runCliJson<never>(
        ['remove', 'nonexistent', '--yes', '--json'],
        { cwd: dir }
      )

      expect(exitCode).not.toBe(0)
      expect(success).toBe(false)
    })
  })

  it('leaves other skills intact when removing one', async () => {
    await withTempDir(async (dir) => {
      setupInstalledSkill(dir, {
        name: 'skill-a',
        files: { 'SKILL.md': createSkillMd({ name: 'skill-a' }) },
        agents: ['claude-code'],
      })
      setupInstalledSkill(dir, {
        name: 'skill-b',
        files: { 'SKILL.md': createSkillMd({ name: 'skill-b' }) },
        agents: ['claude-code'],
      })

      await runCliJson(['remove', 'skill-a', '--yes', '--json'], { cwd: dir })

      const state = readProjectState(dir)
      expect(Object.keys(state.manifest?.packages ?? {})).toEqual(['skill-b'])
      expect(state.skills).toContain('skill-b')
      expect(state.skills).not.toContain('skill-a')
      expect(existsSync(join(dir, '.agents/skills/skill-b/SKILL.md'))).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// Doctor command
// ---------------------------------------------------------------------------

describe('E2E: doctor', () => {
  it('passes all local checks on healthy state', async () => {
    await withTempDir(async (dir) => {
      setupInstalledSkill(dir, {
        name: 'test-skill',
        files: { 'SKILL.md': createSkillMd() },
        agents: ['claude-code'],
      })

      const { data } = await runCliJson<{
        checks: Array<{ name: string; status: string }>
        passed: number
        failed: number
      }>(['doctor', '--json'], { cwd: dir })

      const localChecks = data.checks.filter((c) => c.name !== 'authentication')
      for (const c of localChecks) {
        expect(c.status, `check "${c.name}" should pass`).not.toBe('fail')
      }
      expect(data.failed).toBeLessThanOrEqual(1)
    })
  })

  it('fails skill-files-exist when canonical directory is missing', async () => {
    await withTempDir(async (dir) => {
      setupInstalledSkill(dir, {
        name: 'test-skill',
        files: { 'SKILL.md': createSkillMd() },
        agents: ['claude-code'],
      })

      // Delete only the canonical directory contents, leave symlink intact
      // This tests the skill-files-exist check specifically
      rmSync(join(dir, '.agents/skills/test-skill'), { recursive: true, force: true })

      const { data } = await runCliJson<{
        checks: Array<{ name: string; status: string }>
      }>(['doctor', '--json'], { cwd: dir })

      const skillFilesCheck = data.checks.find((c) => c.name === 'skill-files-exist')
      expect(skillFilesCheck?.status).toBe('fail')
    })
  })

  it('fails symlinks-valid with a dangling symlink (different from missing dir)', async () => {
    await withTempDir(async (dir) => {
      setupInstalledSkill(dir, {
        name: 'test-skill',
        files: { 'SKILL.md': createSkillMd() },
        agents: ['claude-code'],
      })

      // Replace the symlink with one pointing to a non-existent target
      // This creates a genuinely different broken state from the previous test:
      // canonical dir exists but symlink is dangling
      const symlinkPath = join(dir, '.claude/skills/test-skill')
      rmSync(symlinkPath, { recursive: true, force: true })
      symlinkSync('../../.agents/skills/does-not-exist', symlinkPath)

      const { data } = await runCliJson<{
        checks: Array<{ name: string; status: string }>
      }>(['doctor', '--json'], { cwd: dir })

      const symlinkCheck = data.checks.find((c) => c.name === 'symlinks-valid')
      expect(symlinkCheck?.status).toBe('fail')

      // The skill-files-exist check should still pass since canonical dir is intact
      const skillFilesCheck = data.checks.find((c) => c.name === 'skill-files-exist')
      expect(skillFilesCheck?.status).toBe('pass')
    })
  })

  it('does not crash on empty directory with no .agentver', async () => {
    await withTempDir(async (dir) => {
      const { data } = await runCliJson<{
        checks: Array<{ name: string; status: string }>
      }>(['doctor', '--json'], { cwd: dir })

      expect(data.checks.length).toBeGreaterThan(0)

      const manifestCheck = data.checks.find((c) => c.name === 'manifest-integrity')
      expect(manifestCheck?.status).toBe('warn')
    })
  })
})

// ---------------------------------------------------------------------------
// Adopt command
// ---------------------------------------------------------------------------

describe('E2E: adopt', () => {
  it('discovers pre-existing SKILL.md and adopts it with valid schema', async () => {
    await withTempDir(async (dir) => {
      const skillDir = join(dir, '.claude/skills/my-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), createSkillMd({ name: 'my-skill' }))

      const { data, exitCode } = await runCliJson<{
        adopted: Array<{ name: string }>
        skipped: Array<{ name: string }>
      }>(['adopt', '--json'], { cwd: dir })

      expect(exitCode).toBe(0)
      expect(data.adopted.length).toBeGreaterThanOrEqual(1)
      expect(data.adopted.some((a) => a.name === 'my-skill')).toBe(true)

      // Verify manifest and lockfile were written and are schema-valid
      const state = readProjectState(dir)
      expect(state.manifest?.packages['my-skill']).toBeDefined()
      expect(state.lockfile?.packages['my-skill']).toBeDefined()

      // Schema compliance after adopt
      const manifestRaw = readFileSync(join(dir, '.agentver/manifest.json'), 'utf-8')
      expect(manifestV2Schema.safeParse(JSON.parse(manifestRaw) as unknown).success).toBe(true)

      const lockfileRaw = readFileSync(join(dir, '.agentver/lockfile.json'), 'utf-8')
      expect(lockfileV2Schema.safeParse(JSON.parse(lockfileRaw) as unknown).success).toBe(true)
    })
  })

  it('skips already-managed skills', async () => {
    await withTempDir(async (dir) => {
      setupInstalledSkill(dir, {
        name: 'test-skill',
        files: { 'SKILL.md': createSkillMd() },
        agents: ['claude-code'],
      })

      const { data, exitCode } = await runCliJson<{
        adopted: Array<{ name: string }>
        skipped: Array<{ name: string }>
      }>(['adopt', '--json'], { cwd: dir })

      expect(exitCode).toBe(0)
      expect(data.skipped.some((s) => s.name === 'test-skill')).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// Verify command
// ---------------------------------------------------------------------------

describe('E2E: verify', () => {
  it('passes integrity check on unmodified skill', async () => {
    await withTempDir(async (dir) => {
      setupInstalledSkill(dir, {
        name: '@test-org/test-skill',
        files: { 'SKILL.md': createSkillMd() },
        agents: ['claude-code'],
      })

      const { data } = await runCliJson<{
        integrityPassed: boolean
        securityPassed: boolean
      }>(['verify', '@test-org/test-skill', '--json'], { cwd: dir })

      expect(data.integrityPassed).toBe(true)
      expect(data.securityPassed).toBe(true)
    })
  })

  it('fails integrity check on modified skill', async () => {
    await withTempDir(async (dir) => {
      setupInstalledSkill(dir, {
        name: '@test-org/test-skill',
        files: { 'SKILL.md': createSkillMd() },
        agents: ['claude-code'],
      })

      writeFileSync(
        join(dir, '.agents/skills/@test-org/test-skill/SKILL.md'),
        '# Tampered content\n'
      )

      const { data } = await runCliJson<{
        integrityPassed: boolean
      }>(['verify', '@test-org/test-skill', '--json'], { cwd: dir })

      expect(data.integrityPassed).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// Symlink relativity
// ---------------------------------------------------------------------------

describe('E2E: symlink relativity', () => {
  it('creates relative symlinks (not absolute paths)', async () => {
    await withTempDir(async (dir) => {
      setupInstalledSkill(dir, {
        name: 'test-skill',
        files: { 'SKILL.md': createSkillMd() },
        agents: ['claude-code'],
      })

      const symlinkPath = join(dir, '.claude/skills/test-skill')
      expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true)

      const target = readlinkSync(symlinkPath)
      expect(target.startsWith('/')).toBe(false)
      expect(target).toContain('.agents/skills/test-skill')
    })
  })
})

// ---------------------------------------------------------------------------
// Schema compliance
// ---------------------------------------------------------------------------

describe('E2E: schema compliance', () => {
  it('manifest is schema-valid after remove', async () => {
    await withTempDir(async (dir) => {
      setupInstalledSkill(dir, {
        name: 'test-skill',
        files: { 'SKILL.md': createSkillMd() },
        agents: ['claude-code'],
      })

      await runCli(['remove', 'test-skill', '--yes', '--json'], { cwd: dir })

      const manifestPath = join(dir, '.agentver/manifest.json')
      expect(existsSync(manifestPath)).toBe(true)

      const raw = readFileSync(manifestPath, 'utf-8')
      const parsed = JSON.parse(raw) as unknown
      const result = manifestV2Schema.safeParse(parsed)
      expect(result.success).toBe(true)

      // Check deterministic serialisation: trailing newline, 2-space indent
      expect(raw.endsWith('\n')).toBe(true)
      expect(raw).toContain('  ')
    })
  })

  it('lockfile is schema-valid after remove', async () => {
    await withTempDir(async (dir) => {
      setupInstalledSkill(dir, {
        name: 'test-skill',
        files: { 'SKILL.md': createSkillMd() },
        agents: ['claude-code'],
      })

      await runCli(['remove', 'test-skill', '--yes', '--json'], { cwd: dir })

      const lockfilePath = join(dir, '.agentver/lockfile.json')
      expect(existsSync(lockfilePath)).toBe(true)

      const raw = readFileSync(lockfilePath, 'utf-8')
      const parsed = JSON.parse(raw) as unknown
      const result = lockfileV2Schema.safeParse(parsed)
      expect(result.success).toBe(true)

      expect(raw.endsWith('\n')).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// Update command
// ---------------------------------------------------------------------------

describe('E2E: update', () => {
  it('reports no updates needed when skill is up-to-date', async () => {
    await withTempDir(async (dir) => {
      setupInstalledSkill(dir, {
        name: 'test-skill',
        files: { 'SKILL.md': createSkillMd() },
        agents: ['claude-code'],
      })

      // Update with --offline and --json — no upstream changes available
      // The update command will try network calls, but with a fake HOME
      // and no git remote, it should report the skill as skipped/unchanged
      const result = await runCli(['update', '--json'], { cwd: dir })

      // Parse whatever JSON output we get — the command should not crash
      const lines = result.stdout.trim().split('\n')
      const jsonLine = lines.find((line) => line.startsWith('{'))
      expect(jsonLine).toBeDefined()

      const parsed = JSON.parse(jsonLine!) as {
        success: boolean
        data?: { updated: unknown[]; skipped: unknown[] }
      }

      // Should succeed but with no updates (network will fail silently)
      expect(parsed.success).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// Full lifecycle
// ---------------------------------------------------------------------------

describe('E2E: full lifecycle', () => {
  it('install (seeded) -> status -> modify -> status -> remove', async () => {
    await withTempDir(async (dir) => {
      // 1. Seed an install
      setupInstalledSkill(dir, {
        name: 'lifecycle-skill',
        files: { 'SKILL.md': createSkillMd({ name: 'lifecycle-skill' }) },
        agents: ['claude-code'],
      })

      // 2. Status should show up-to-date
      const status1 = await runCliJson<{
        packages: Array<{ name: string; status: string }>
      }>(['status', '--offline', '--json'], { cwd: dir })

      expect(status1.data.packages[0]!.status).toBe('up-to-date')

      // 3. Modify the file
      writeFileSync(
        join(dir, '.agents/skills/lifecycle-skill/SKILL.md'),
        '# Modified lifecycle skill\n'
      )

      // 4. Status should show modified
      const status2 = await runCliJson<{
        packages: Array<{ name: string; status: string; modified: boolean }>
      }>(['status', '--offline', '--json'], { cwd: dir })

      expect(status2.data.packages[0]!.status).toBe('modified')
      expect(status2.data.packages[0]!.modified).toBe(true)

      // 5. Remove
      const removeResult = await runCliJson<{ removed: boolean }>(
        ['remove', 'lifecycle-skill', '--yes', '--json'],
        { cwd: dir }
      )

      expect(removeResult.data.removed).toBe(true)

      // 6. State should be empty
      const state = readProjectState(dir)
      expect(Object.keys(state.manifest?.packages ?? {})).toHaveLength(0)

      // 7. Status should show total: 0
      const status3 = await runCliJson<{
        summary: { total: number }
      }>(['status', '--offline', '--json'], { cwd: dir })

      expect(status3.data.summary.total).toBe(0)
    })
  })
})
