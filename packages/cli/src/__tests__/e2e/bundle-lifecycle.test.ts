/**
 * E2E: Bundle lifecycle — seed → list (grouping) → info (membership) → remove (all constituents).
 *
 * Bundles install constituent packages that reference a parent bundle key
 * via the `bundle` field in ManifestV2Package. This test verifies that the
 * CLI correctly groups, reports, and removes bundle-linked packages.
 */

import { existsSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import type { InfoResult, ListResult, RemoveResult } from '@agentver/shared'
import { describe, expect, it } from 'vitest'
import { createSkillMd } from '../helpers/fixtures'
import { readProjectState, withTempDir } from '../helpers/mock-fs'
import { runCli, runCliJson, setupInstalledSkill } from './helpers'

// ---------------------------------------------------------------------------
// Shared test constants
// ---------------------------------------------------------------------------

const BUNDLE_NAME = 'my-bundle'
const SKILL_A = 'skill-a'
const SKILL_B = 'skill-b'
const SKILL_C = 'skill-c'
const AGENTS = ['claude-code']

const BUNDLE_SOURCE = {
  type: 'git' as const,
  uri: 'github.com/test-org/bundle-repo',
  path: '',
  ref: 'main',
  commit: 'abc1234567890abcdef1234567890abcdef123456',
}

/**
 * Seeds a complete bundle state: a BUNDLE parent entry plus three constituent
 * skills, all with real files, symlinks, and manifest/lockfile entries.
 */
function seedBundleState(dir: string): void {
  // 1. Bundle parent entry (no files on disk — bundles are metadata-only)
  setupInstalledSkill(dir, {
    name: BUNDLE_NAME,
    files: { 'agentver.bundle.yaml': 'name: my-bundle\nversion: 1.0.0\n' },
    agents: AGENTS,
    source: BUNDLE_SOURCE,
    packageType: 'BUNDLE',
  })

  // 2. Constituent skills referencing the bundle
  for (const skillName of [SKILL_A, SKILL_B, SKILL_C]) {
    setupInstalledSkill(dir, {
      name: skillName,
      files: {
        'SKILL.md': createSkillMd({ name: skillName, description: `Part of ${BUNDLE_NAME}` }),
      },
      agents: AGENTS,
      source: BUNDLE_SOURCE,
      bundle: BUNDLE_NAME,
    })
  }
}

// ---------------------------------------------------------------------------
// List command — bundle grouping
// ---------------------------------------------------------------------------

describe('E2E: bundle list grouping', () => {
  it('groups constituents under their parent bundle in JSON output', async () => {
    await withTempDir(async (dir) => {
      seedBundleState(dir)

      const { data, exitCode } = await runCliJson<ListResult>(['list', '--json'], { cwd: dir })

      expect(exitCode).toBe(0)

      // Should contain 4 entries total: 1 bundle + 3 constituents
      expect(data.packages).toHaveLength(4)

      // Bundle parent entry
      const bundleEntry = data.packages.find((p) => p.name === BUNDLE_NAME)
      expect(bundleEntry).toBeDefined()
      expect(bundleEntry!.package.packageType).toBe('BUNDLE')

      // Constituent entries reference the bundle
      for (const skillName of [SKILL_A, SKILL_B, SKILL_C]) {
        const entry = data.packages.find((p) => p.name === skillName)
        expect(entry, `Expected constituent ${skillName} in list output`).toBeDefined()
        expect(entry!.package.bundle).toBe(BUNDLE_NAME)
      }
    })
  })

  it('renders bundle grouping in human-readable output', async () => {
    await withTempDir(async (dir) => {
      seedBundleState(dir)

      const { stdout, exitCode } = await runCli(['list'], { cwd: dir })

      expect(exitCode).toBe(0)
      expect(stdout).toContain(BUNDLE_NAME)
      expect(stdout).toContain('bundle')
      expect(stdout).toContain(SKILL_A)
      expect(stdout).toContain(SKILL_B)
      expect(stdout).toContain(SKILL_C)
    })
  })
})

// ---------------------------------------------------------------------------
// Info command — bundle membership
// ---------------------------------------------------------------------------

describe('E2E: bundle info membership', () => {
  it('shows bundle membership for a constituent in JSON output', async () => {
    await withTempDir(async (dir) => {
      seedBundleState(dir)

      const { data, exitCode } = await runCliJson<InfoResult>(['info', SKILL_A, '--json'], {
        cwd: dir,
      })

      expect(exitCode).toBe(0)
      expect(data.name).toBe(SKILL_A)
      expect(data.bundle).toBe(BUNDLE_NAME)
    })
  })

  it('shows BUNDLE packageType for the parent in JSON output', async () => {
    await withTempDir(async (dir) => {
      seedBundleState(dir)

      const { data, exitCode } = await runCliJson<InfoResult>(['info', BUNDLE_NAME, '--json'], {
        cwd: dir,
      })

      expect(exitCode).toBe(0)
      expect(data.name).toBe(BUNDLE_NAME)
      expect(data.packageType).toBe('BUNDLE')
      expect(data.bundle).toBeUndefined()
    })
  })

  it('shows bundle membership in human-readable output', async () => {
    await withTempDir(async (dir) => {
      seedBundleState(dir)

      const { stdout, exitCode } = await runCli(['info', SKILL_B], { cwd: dir })

      expect(exitCode).toBe(0)
      expect(stdout).toContain(SKILL_B)
      expect(stdout).toContain(BUNDLE_NAME)
    })
  })
})

// ---------------------------------------------------------------------------
// Remove command — bundle removal cascades to constituents
// ---------------------------------------------------------------------------

describe('E2E: bundle removal', () => {
  it('removes all constituents when removing a bundle', async () => {
    await withTempDir(async (dir) => {
      seedBundleState(dir)

      // Verify everything is installed first
      const beforeState = readProjectState(dir)
      expect(Object.keys(beforeState.manifest?.packages ?? {})).toHaveLength(4)

      const { data, exitCode } = await runCliJson<RemoveResult>(
        ['remove', BUNDLE_NAME, '--yes', '--json'],
        { cwd: dir }
      )

      expect(exitCode).toBe(0)
      expect(data.removed).toBe(true)
      expect(data.name).toBe(BUNDLE_NAME)
      expect(data.bundleConstituents).toBeDefined()
      expect(data.bundleConstituents).toHaveLength(3)
      expect(data.bundleConstituents).toContain(SKILL_A)
      expect(data.bundleConstituents).toContain(SKILL_B)
      expect(data.bundleConstituents).toContain(SKILL_C)

      // Manifest and lockfile should be empty
      const afterState = readProjectState(dir)
      expect(Object.keys(afterState.manifest?.packages ?? {})).toHaveLength(0)
      expect(Object.keys(afterState.lockfile?.packages ?? {})).toHaveLength(0)
    })
  })

  it('cleans up all canonical directories and symlinks', async () => {
    await withTempDir(async (dir) => {
      seedBundleState(dir)

      await runCli(['remove', BUNDLE_NAME, '--yes', '--json'], { cwd: dir })

      // Canonical skill directories should be gone
      for (const skillName of [SKILL_A, SKILL_B, SKILL_C, BUNDLE_NAME]) {
        expect(
          existsSync(join(dir, '.agents', 'skills', skillName)),
          `Canonical dir for ${skillName} should be removed`
        ).toBe(false)
      }

      // Symlinks should also be gone
      for (const skillName of [SKILL_A, SKILL_B, SKILL_C, BUNDLE_NAME]) {
        const symlinkPath = join(dir, '.claude', 'skills', skillName)
        expect(() => lstatSync(symlinkPath)).toThrow()
      }

      // Overall: no skills, no symlinks
      const state = readProjectState(dir)
      expect(state.skills).toHaveLength(0)
      expect(state.symlinks).toHaveLength(0)
    })
  })

  it('lists as empty after bundle removal', async () => {
    await withTempDir(async (dir) => {
      seedBundleState(dir)

      await runCli(['remove', BUNDLE_NAME, '--yes', '--json'], { cwd: dir })

      const { data } = await runCliJson<ListResult>(['list', '--json'], { cwd: dir })
      expect(data.packages).toHaveLength(0)
    })
  })

  it('shows dry-run output with bundleConstituents', async () => {
    await withTempDir(async (dir) => {
      seedBundleState(dir)

      const { data, exitCode } = await runCliJson<RemoveResult>(
        ['remove', BUNDLE_NAME, '--yes', '--dry-run', '--json'],
        { cwd: dir }
      )

      expect(exitCode).toBe(0)
      expect(data.removed).toBe(false)
      expect(data.bundleConstituents).toHaveLength(3)

      // Should NOT have actually removed anything
      const state = readProjectState(dir)
      expect(Object.keys(state.manifest?.packages ?? {})).toHaveLength(4)
    })
  })
})

// ---------------------------------------------------------------------------
// Removing a single constituent
// ---------------------------------------------------------------------------

describe('E2E: single constituent removal', () => {
  it('removes only the targeted constituent, leaving the bundle and siblings', async () => {
    await withTempDir(async (dir) => {
      seedBundleState(dir)

      const { data, exitCode } = await runCliJson<RemoveResult>(
        ['remove', SKILL_A, '--yes', '--json'],
        { cwd: dir }
      )

      expect(exitCode).toBe(0)
      expect(data.removed).toBe(true)
      expect(data.name).toBe(SKILL_A)

      // Bundle parent and other constituents remain
      const state = readProjectState(dir)
      const keys = Object.keys(state.manifest?.packages ?? {})
      expect(keys).toHaveLength(3)
      expect(keys).toContain(BUNDLE_NAME)
      expect(keys).toContain(SKILL_B)
      expect(keys).toContain(SKILL_C)
      expect(keys).not.toContain(SKILL_A)

      // Sibling skill files are intact
      expect(existsSync(join(dir, '.agents', 'skills', SKILL_B, 'SKILL.md'))).toBe(true)
      expect(existsSync(join(dir, '.agents', 'skills', SKILL_C, 'SKILL.md'))).toBe(true)

      // Removed skill is gone
      expect(existsSync(join(dir, '.agents', 'skills', SKILL_A))).toBe(false)
    })
  })

  it('warns about bundle membership in human-readable output', async () => {
    await withTempDir(async (dir) => {
      seedBundleState(dir)

      const { stdout, exitCode } = await runCli(['remove', SKILL_C, '--yes'], { cwd: dir })

      expect(exitCode).toBe(0)
      expect(stdout).toContain('bundle')
    })
  })
})

// ---------------------------------------------------------------------------
// Full bundle lifecycle flow
// ---------------------------------------------------------------------------

describe('E2E: full bundle lifecycle', () => {
  it('seed → list → info → remove → verify empty', async () => {
    await withTempDir(async (dir) => {
      // 1. Seed the bundle
      seedBundleState(dir)

      // 2. List — verify grouping
      const listResult = await runCliJson<ListResult>(['list', '--json'], { cwd: dir })
      expect(listResult.data.packages).toHaveLength(4)
      const bundlePkgs = listResult.data.packages.filter((p) => p.package.bundle === BUNDLE_NAME)
      expect(bundlePkgs).toHaveLength(3)

      // 3. Info on a constituent — verify bundle reference
      const infoResult = await runCliJson<InfoResult>(['info', SKILL_B, '--json'], { cwd: dir })
      expect(infoResult.data.bundle).toBe(BUNDLE_NAME)
      expect(infoResult.data.agents).toEqual(AGENTS)

      // 4. Remove the bundle — cascades to all constituents
      const removeResult = await runCliJson<RemoveResult>(
        ['remove', BUNDLE_NAME, '--yes', '--json'],
        { cwd: dir }
      )
      expect(removeResult.data.removed).toBe(true)
      expect(removeResult.data.bundleConstituents).toHaveLength(3)

      // 5. Verify empty state
      const finalList = await runCliJson<ListResult>(['list', '--json'], { cwd: dir })
      expect(finalList.data.packages).toHaveLength(0)

      const finalState = readProjectState(dir)
      expect(Object.keys(finalState.manifest?.packages ?? {})).toHaveLength(0)
      expect(Object.keys(finalState.lockfile?.packages ?? {})).toHaveLength(0)
      expect(finalState.skills).toHaveLength(0)
      expect(finalState.symlinks).toHaveLength(0)
    })
  })
})
