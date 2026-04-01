/**
 * E2E tests for multi-agent skill placement, pin/unpin commands,
 * list command, and info command.
 *
 * Runs the actual CLI binary against temp directories with real filesystem state.
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
import { manifestV2Schema } from '@agentver/shared'
import { describe, expect, it } from 'vitest'
import { createSkillMd } from '../helpers/fixtures'
import { withTempDir } from '../helpers/mock-fs'
import { runCli, runCliJson, setupInstalledSkill } from './helpers'

// ---------------------------------------------------------------------------
// Multi-agent placement
// ---------------------------------------------------------------------------

describe('E2E: multi-agent placement', () => {
  it('installs symlinks for all detected agents', async () => {
    await withTempDir(async (dir) => {
      // Create agent detection directories
      mkdirSync(join(dir, '.claude'), { recursive: true })
      mkdirSync(join(dir, '.cursor'), { recursive: true })

      setupInstalledSkill(dir, {
        name: 'test-skill',
        files: { 'SKILL.md': createSkillMd() },
        agents: ['claude-code', 'cursor'],
      })

      // Assert symlinks exist at both agent paths
      const claudeSymlink = join(dir, '.claude/skills/test-skill')
      const cursorSymlink = join(dir, '.cursor/skills/test-skill')

      expect(lstatSync(claudeSymlink).isSymbolicLink()).toBe(true)
      expect(lstatSync(cursorSymlink).isSymbolicLink()).toBe(true)

      // Assert both symlinks are relative (target doesn't start with '/')
      const claudeTarget = readlinkSync(claudeSymlink)
      const cursorTarget = readlinkSync(cursorSymlink)

      expect(claudeTarget.startsWith('/')).toBe(false)
      expect(cursorTarget.startsWith('/')).toBe(false)

      // Assert both symlinks resolve to the same canonical path
      const { realpathSync } = await import('node:fs')
      const claudeResolved = realpathSync(claudeSymlink)
      const cursorResolved = realpathSync(cursorSymlink)

      expect(claudeResolved).toBe(cursorResolved)
      expect(claudeResolved).toContain('.agents/skills/test-skill')
    })
  })

  it('remove cleans up all agent symlinks', async () => {
    await withTempDir(async (dir) => {
      mkdirSync(join(dir, '.claude'), { recursive: true })
      mkdirSync(join(dir, '.cursor'), { recursive: true })

      setupInstalledSkill(dir, {
        name: 'test-skill',
        files: { 'SKILL.md': createSkillMd() },
        agents: ['claude-code', 'cursor'],
      })

      // Verify symlinks exist before removal
      expect(lstatSync(join(dir, '.claude/skills/test-skill')).isSymbolicLink()).toBe(true)
      expect(lstatSync(join(dir, '.cursor/skills/test-skill')).isSymbolicLink()).toBe(true)

      const { exitCode, data } = await runCliJson<{ removed: boolean }>(
        ['remove', 'test-skill', '--yes', '--json'],
        { cwd: dir }
      )

      expect(exitCode).toBe(0)
      expect(data.removed).toBe(true)

      // Symlinks should be gone from both agents
      expect(() => lstatSync(join(dir, '.claude/skills/test-skill'))).toThrow()
      expect(() => lstatSync(join(dir, '.cursor/skills/test-skill'))).toThrow()

      // Canonical directory should be removed
      expect(existsSync(join(dir, '.agents/skills/test-skill'))).toBe(false)
    })
  })

  it('list shows correct agent count per package', async () => {
    await withTempDir(async (dir) => {
      mkdirSync(join(dir, '.claude'), { recursive: true })
      mkdirSync(join(dir, '.cursor'), { recursive: true })

      setupInstalledSkill(dir, {
        name: 'test-skill',
        files: { 'SKILL.md': createSkillMd() },
        agents: ['claude-code', 'cursor'],
      })

      const { data, exitCode } = await runCliJson<{
        packages: Array<{
          name: string
          scope: string
          package: { agents: string[] }
        }>
      }>(['list', '--json'], { cwd: dir })

      expect(exitCode).toBe(0)
      expect(data.packages).toHaveLength(1)

      const pkg = data.packages[0]!
      expect(pkg.package.agents).toContain('claude-code')
      expect(pkg.package.agents).toContain('cursor')
      expect(pkg.package.agents).toHaveLength(2)
    })
  })
})

// ---------------------------------------------------------------------------
// Pin and unpin
// ---------------------------------------------------------------------------

describe('E2E: pin and unpin', () => {
  it('pin marks a package as pinned in manifest', async () => {
    await withTempDir(async (dir) => {
      mkdirSync(join(dir, '.claude'), { recursive: true })

      setupInstalledSkill(dir, {
        name: 'test-skill',
        files: { 'SKILL.md': createSkillMd() },
        agents: ['claude-code'],
      })

      const { success, exitCode, data } = await runCliJson<{ name: string; pinned: boolean }>(
        ['pin', 'test-skill', '--json'],
        { cwd: dir }
      )

      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.pinned).toBe(true)

      // Verify manifest on disk
      const manifestRaw = readFileSync(join(dir, '.agentver/manifest.json'), 'utf-8')
      const manifest = manifestV2Schema.parse(JSON.parse(manifestRaw) as unknown)
      expect(manifest.packages['test-skill']!.pinned).toBe(true)
    })
  })

  it('unpin removes pin from package', async () => {
    await withTempDir(async (dir) => {
      mkdirSync(join(dir, '.claude'), { recursive: true })

      setupInstalledSkill(dir, {
        name: 'test-skill',
        files: { 'SKILL.md': createSkillMd() },
        agents: ['claude-code'],
      })

      // Pin first
      await runCli(['pin', 'test-skill', '--json'], { cwd: dir })

      // Verify pinned
      const manifestBefore = JSON.parse(
        readFileSync(join(dir, '.agentver/manifest.json'), 'utf-8')
      ) as { packages: Record<string, { pinned?: boolean }> }
      expect(manifestBefore.packages['test-skill']!.pinned).toBe(true)

      // Unpin
      const { success, exitCode, data } = await runCliJson<{ name: string; pinned: boolean }>(
        ['unpin', 'test-skill', '--json'],
        { cwd: dir }
      )

      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.pinned).toBe(false)

      // Verify manifest on disk - pinned should be absent (deleted)
      const manifestAfter = JSON.parse(
        readFileSync(join(dir, '.agentver/manifest.json'), 'utf-8')
      ) as { packages: Record<string, { pinned?: boolean }> }
      expect(manifestAfter.packages['test-skill']!.pinned).toBeUndefined()
    })
  })

  it('pin fails for non-existent package', async () => {
    await withTempDir(async (dir) => {
      // Seed empty manifest/lockfile
      const agentverDir = join(dir, '.agentver')
      mkdirSync(agentverDir, { recursive: true })
      writeFileSync(
        join(agentverDir, 'manifest.json'),
        JSON.stringify({ version: 2, packages: {} }, null, 2)
      )
      writeFileSync(
        join(agentverDir, 'lockfile.json'),
        JSON.stringify({ version: 2, packages: {} }, null, 2)
      )

      const { success, exitCode } = await runCliJson<never>(['pin', 'nonexistent', '--json'], {
        cwd: dir,
      })

      expect(exitCode).not.toBe(0)
      expect(success).toBe(false)
    })
  })

  it('unpin fails for non-existent package', async () => {
    await withTempDir(async (dir) => {
      // Seed empty manifest/lockfile
      const agentverDir = join(dir, '.agentver')
      mkdirSync(agentverDir, { recursive: true })
      writeFileSync(
        join(agentverDir, 'manifest.json'),
        JSON.stringify({ version: 2, packages: {} }, null, 2)
      )
      writeFileSync(
        join(agentverDir, 'lockfile.json'),
        JSON.stringify({ version: 2, packages: {} }, null, 2)
      )

      const { success, exitCode } = await runCliJson<never>(['unpin', 'nonexistent', '--json'], {
        cwd: dir,
      })

      expect(exitCode).not.toBe(0)
      expect(success).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// List command
// ---------------------------------------------------------------------------

describe('E2E: list command', () => {
  it('list shows installed packages with correct structure', async () => {
    await withTempDir(async (dir) => {
      mkdirSync(join(dir, '.claude'), { recursive: true })

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

      const { data, exitCode } = await runCliJson<{
        packages: Array<{
          name: string
          scope: string
          package: {
            source: { type: string }
            agents: string[]
          }
        }>
      }>(['list', '--json'], { cwd: dir })

      expect(exitCode).toBe(0)
      expect(data.packages).toHaveLength(2)

      for (const pkg of data.packages) {
        expect(pkg.name).toBeDefined()
        expect(pkg.scope).toBe('project')
        expect(pkg.package.source).toBeDefined()
        expect(pkg.package.agents).toBeDefined()
        expect(Array.isArray(pkg.package.agents)).toBe(true)
      }

      const names = data.packages.map((p) => p.name)
      expect(names).toContain('skill-a')
      expect(names).toContain('skill-b')
    })
  })

  it('list shows empty state correctly', async () => {
    await withTempDir(async (dir) => {
      // Seed empty manifest/lockfile
      const agentverDir = join(dir, '.agentver')
      mkdirSync(agentverDir, { recursive: true })
      writeFileSync(
        join(agentverDir, 'manifest.json'),
        JSON.stringify({ version: 2, packages: {} }, null, 2)
      )
      writeFileSync(
        join(agentverDir, 'lockfile.json'),
        JSON.stringify({ version: 2, packages: {} }, null, 2)
      )

      const { data, exitCode } = await runCliJson<{
        packages: Array<unknown>
      }>(['list', '--json'], { cwd: dir })

      expect(exitCode).toBe(0)
      expect(data.packages).toHaveLength(0)
    })
  })
})

// ---------------------------------------------------------------------------
// Info command
// ---------------------------------------------------------------------------

describe('E2E: info command', () => {
  it('info shows detailed package information', async () => {
    await withTempDir(async (dir) => {
      mkdirSync(join(dir, '.claude'), { recursive: true })

      setupInstalledSkill(dir, {
        name: 'test-skill',
        files: { 'SKILL.md': createSkillMd() },
        agents: ['claude-code'],
      })

      const { data, exitCode, success } = await runCliJson<{
        name: string
        source: { type: string }
        agents: string[]
        installedAt: string
        modified: boolean
        integrity: string
        pinned: boolean
        files: { count: number; totalSize: number }
      }>(['info', 'test-skill', '--json'], { cwd: dir })

      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.name).toBe('test-skill')
      expect(data.source).toBeDefined()
      expect(data.source.type).toBe('git')
      expect(data.agents).toContain('claude-code')
      expect(data.installedAt).toBeDefined()
      expect(typeof data.installedAt).toBe('string')
      expect(data.integrity).toMatch(/^sha256-/)
      expect(typeof data.modified).toBe('boolean')
      expect(typeof data.pinned).toBe('boolean')
      expect(data.files.count).toBeGreaterThan(0)
    })
  })

  it('info fails for non-existent package', async () => {
    await withTempDir(async (dir) => {
      // Seed empty manifest/lockfile
      const agentverDir = join(dir, '.agentver')
      mkdirSync(agentverDir, { recursive: true })
      writeFileSync(
        join(agentverDir, 'manifest.json'),
        JSON.stringify({ version: 2, packages: {} }, null, 2)
      )
      writeFileSync(
        join(agentverDir, 'lockfile.json'),
        JSON.stringify({ version: 2, packages: {} }, null, 2)
      )

      const { success, exitCode } = await runCliJson<never>(['info', 'nonexistent', '--json'], {
        cwd: dir,
      })

      expect(exitCode).not.toBe(0)
      expect(success).toBe(false)
    })
  })
})
