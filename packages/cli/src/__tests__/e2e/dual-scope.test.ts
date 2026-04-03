/**
 * E2E dual-scope tests — verifies the full interaction between project-local
 * and global scopes in a single test run.
 *
 * Exercises list, status, info, remove, and doctor across both scopes,
 * ensuring they report the correct data and never leak state between scopes.
 */

import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lockfileV2Schema, manifestV2Schema } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSkillMd } from '../helpers/fixtures'
import { cleanupTempDir, createTempDir, readProjectState } from '../helpers/mock-fs'
import { runCliJson, setupInstalledSkill } from './helpers'

// ---------------------------------------------------------------------------
// Mock homedir so setupInstalledSkill can seed global scope in test process
// ---------------------------------------------------------------------------

let fakeHomePath: string | null = null
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return {
    ...actual,
    homedir: () => fakeHomePath ?? actual.homedir(),
    tmpdir: actual.tmpdir,
  }
})

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let projectDir: string
let homeDir: string

beforeEach(() => {
  projectDir = createTempDir()
  homeDir = createTempDir()
  fakeHomePath = homeDir
})

afterEach(() => {
  fakeHomePath = null
  cleanupTempDir(projectDir)
  cleanupTempDir(homeDir)
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Options passed to every runCli / runCliJson call for dual-scope tests. */
function cliOpts() {
  return { cwd: projectDir, homeDir }
}

/**
 * Validates that a manifest file on disk conforms to the V2 schema.
 */
function assertManifestSchemaValid(manifestPath: string): void {
  expect(existsSync(manifestPath)).toBe(true)
  const raw = readFileSync(manifestPath, 'utf-8')
  const result = manifestV2Schema.safeParse(JSON.parse(raw) as unknown)
  expect(result.success).toBe(true)
}

/**
 * Validates that a lockfile file on disk conforms to the V2 schema.
 */
function assertLockfileSchemaValid(lockfilePath: string): void {
  expect(existsSync(lockfilePath)).toBe(true)
  const raw = readFileSync(lockfilePath, 'utf-8')
  const result = lockfileV2Schema.safeParse(JSON.parse(raw) as unknown)
  expect(result.success).toBe(true)
}

// ---------------------------------------------------------------------------
// Dual-scope lifecycle
// ---------------------------------------------------------------------------

describe('E2E: dual-scope lifecycle', () => {
  it('full dual-scope lifecycle: install, list, status, info, remove, doctor', async () => {
    // -----------------------------------------------------------------
    // Step 1: Seed skill-a globally
    // -----------------------------------------------------------------
    setupInstalledSkill(homeDir, {
      name: 'skill-a',
      files: { 'SKILL.md': createSkillMd({ name: 'skill-a', description: 'Global skill A' }) },
      agents: ['claude-code'],
      scope: 'global',
    })

    // Verify global manifest and canonical files exist
    const globalState = readProjectState(homeDir)
    expect(Object.keys(globalState.manifest?.packages ?? {})).toContain('skill-a')
    expect(globalState.skills).toContain('skill-a')

    // Verify global symlink exists
    const globalSymlink = join(homeDir, '.claude/skills/skill-a')
    expect(lstatSync(globalSymlink).isSymbolicLink()).toBe(true)

    // Schema validation for global manifest/lockfile
    assertManifestSchemaValid(join(homeDir, '.agentver/manifest.json'))
    assertLockfileSchemaValid(join(homeDir, '.agentver/lockfile.json'))

    // -----------------------------------------------------------------
    // Step 2: Seed skill-b in project scope
    // -----------------------------------------------------------------
    setupInstalledSkill(projectDir, {
      name: 'skill-b',
      files: { 'SKILL.md': createSkillMd({ name: 'skill-b', description: 'Project skill B' }) },
      agents: ['claude-code'],
      scope: 'project',
    })

    // Verify project manifest and canonical files exist
    const projectState = readProjectState(projectDir)
    expect(Object.keys(projectState.manifest?.packages ?? {})).toContain('skill-b')
    expect(projectState.skills).toContain('skill-b')

    // Verify project symlink exists
    const projectSymlink = join(projectDir, '.claude/skills/skill-b')
    expect(lstatSync(projectSymlink).isSymbolicLink()).toBe(true)

    // Schema validation for project manifest/lockfile
    assertManifestSchemaValid(join(projectDir, '.agentver/manifest.json'))
    assertLockfileSchemaValid(join(projectDir, '.agentver/lockfile.json'))

    // -----------------------------------------------------------------
    // Step 3: list (default) → shows only project skill (skill-b)
    // -----------------------------------------------------------------
    const listDefault = await runCliJson<{
      packages: Array<{ name: string; scope: string }>
    }>(['list', '--json'], cliOpts())

    expect(listDefault.exitCode).toBe(0)
    expect(listDefault.data.packages).toHaveLength(1)
    expect(listDefault.data.packages[0]!.name).toBe('skill-b')
    expect(listDefault.data.packages[0]!.scope).toBe('project')

    // -----------------------------------------------------------------
    // Step 4: list --global → shows only global skill (skill-a)
    // -----------------------------------------------------------------
    const listGlobal = await runCliJson<{
      packages: Array<{ name: string; scope: string }>
    }>(['list', '--global', '--json'], cliOpts())

    expect(listGlobal.exitCode).toBe(0)
    expect(listGlobal.data.packages).toHaveLength(1)
    expect(listGlobal.data.packages[0]!.name).toBe('skill-a')
    expect(listGlobal.data.packages[0]!.scope).toBe('global')

    // -----------------------------------------------------------------
    // Step 5: list --all --json → shows BOTH skills with correct scope
    // -----------------------------------------------------------------
    const listAll = await runCliJson<{
      packages: Array<{ name: string; scope: string }>
    }>(['list', '--all', '--json'], cliOpts())

    expect(listAll.exitCode).toBe(0)
    expect(listAll.data.packages).toHaveLength(2)

    const names = listAll.data.packages.map((p) => p.name)
    expect(names).toContain('skill-a')
    expect(names).toContain('skill-b')

    const skillAEntry = listAll.data.packages.find((p) => p.name === 'skill-a')!
    const skillBEntry = listAll.data.packages.find((p) => p.name === 'skill-b')!
    expect(skillAEntry.scope).toBe('global')
    expect(skillBEntry.scope).toBe('project')

    // -----------------------------------------------------------------
    // Step 6: status --all --json → both up-to-date
    // -----------------------------------------------------------------
    const statusAll = await runCliJson<{
      packages: Array<{ name: string; status: string; modified: boolean }>
      summary: { total: number; upToDate: number; modified: number }
    }>(['status', '--all', '--offline', '--json'], cliOpts())

    expect(statusAll.exitCode).toBe(0)
    expect(statusAll.data.packages).toHaveLength(2)
    expect(statusAll.data.summary.total).toBe(2)
    expect(statusAll.data.summary.upToDate).toBe(2)
    expect(statusAll.data.summary.modified).toBe(0)

    for (const pkg of statusAll.data.packages) {
      expect(pkg.status).toBe('up-to-date')
      expect(pkg.modified).toBe(false)
    }

    // -----------------------------------------------------------------
    // Step 7: info skill-a (without --global) → should fail with hint
    // -----------------------------------------------------------------
    const infoNoFlag = await runCliJson<never>(['info', 'skill-a', '--json'], cliOpts())

    expect(infoNoFlag.exitCode).not.toBe(0)
    expect(infoNoFlag.success).toBe(false)
    expect(infoNoFlag.error?.code).toBe('NOT_FOUND')
    expect(infoNoFlag.error?.message).toContain('global')

    // -----------------------------------------------------------------
    // Step 8: info skill-a --global → shows full info
    // -----------------------------------------------------------------
    const infoGlobal = await runCliJson<{
      name: string
      source: { type: string }
      agents: string[]
      modified: boolean
      pinned: boolean
      files: { count: number }
    }>(['info', 'skill-a', '--global', '--json'], cliOpts())

    expect(infoGlobal.exitCode).toBe(0)
    expect(infoGlobal.success).toBe(true)
    expect(infoGlobal.data.name).toBe('skill-a')
    expect(infoGlobal.data.source.type).toBe('git')
    expect(infoGlobal.data.agents).toContain('claude-code')
    expect(infoGlobal.data.modified).toBe(false)
    expect(infoGlobal.data.files.count).toBeGreaterThan(0)

    // -----------------------------------------------------------------
    // Step 9: remove skill-b from project → global untouched
    // -----------------------------------------------------------------
    const removeProject = await runCliJson<{ name: string; removed: boolean }>(
      ['remove', 'skill-b', '--yes', '--json'],
      cliOpts()
    )

    expect(removeProject.exitCode).toBe(0)
    expect(removeProject.data.removed).toBe(true)

    // Verify project is clean
    const projectStateAfterRemove = readProjectState(projectDir)
    expect(Object.keys(projectStateAfterRemove.manifest?.packages ?? {})).toHaveLength(0)
    expect(projectStateAfterRemove.skills).toHaveLength(0)
    expect(existsSync(join(projectDir, '.agents/skills/skill-b'))).toBe(false)

    // Verify global is untouched
    const globalStateAfterRemove = readProjectState(homeDir)
    expect(Object.keys(globalStateAfterRemove.manifest?.packages ?? {})).toContain('skill-a')
    expect(globalStateAfterRemove.skills).toContain('skill-a')
    expect(existsSync(join(homeDir, '.agents/skills/skill-a/SKILL.md'))).toBe(true)

    // Schema validation after project remove
    assertManifestSchemaValid(join(projectDir, '.agentver/manifest.json'))
    assertManifestSchemaValid(join(homeDir, '.agentver/manifest.json'))

    // -----------------------------------------------------------------
    // Step 10: list --all → now only shows global skill-a
    // -----------------------------------------------------------------
    const listAfterRemove = await runCliJson<{
      packages: Array<{ name: string; scope: string }>
    }>(['list', '--all', '--json'], cliOpts())

    expect(listAfterRemove.exitCode).toBe(0)
    expect(listAfterRemove.data.packages).toHaveLength(1)
    expect(listAfterRemove.data.packages[0]!.name).toBe('skill-a')
    expect(listAfterRemove.data.packages[0]!.scope).toBe('global')

    // -----------------------------------------------------------------
    // Step 11: remove skill-a --global → removes from global
    // -----------------------------------------------------------------
    const removeGlobal = await runCliJson<{ name: string; removed: boolean }>(
      ['remove', 'skill-a', '--global', '--yes', '--json'],
      cliOpts()
    )

    expect(removeGlobal.exitCode).toBe(0)
    expect(removeGlobal.data.removed).toBe(true)

    // Verify global is now clean
    const globalStateAfterGlobalRemove = readProjectState(homeDir)
    expect(Object.keys(globalStateAfterGlobalRemove.manifest?.packages ?? {})).toHaveLength(0)
    expect(globalStateAfterGlobalRemove.skills).toHaveLength(0)
    expect(existsSync(join(homeDir, '.agents/skills/skill-a'))).toBe(false)
    expect(() => lstatSync(join(homeDir, '.claude/skills/skill-a'))).toThrow()

    // Schema validation after global remove
    assertManifestSchemaValid(join(homeDir, '.agentver/manifest.json'))

    // -----------------------------------------------------------------
    // Step 12: list --all → empty in both scopes
    // -----------------------------------------------------------------
    const listEmpty = await runCliJson<{
      packages: Array<{ name: string; scope: string }>
    }>(['list', '--all', '--json'], cliOpts())

    expect(listEmpty.exitCode).toBe(0)
    expect(listEmpty.data.packages).toHaveLength(0)

    // -----------------------------------------------------------------
    // Step 13: doctor → clean (no orphaned files or broken symlinks)
    // -----------------------------------------------------------------
    const doctor = await runCliJson<{
      checks: Array<{ name: string; status: string }>
      passed: number
      failed: number
    }>(['doctor', '--json'], cliOpts())

    expect(doctor.exitCode).toBe(0)
    const localChecks = doctor.data.checks.filter((c) => c.name !== 'authentication')
    for (const check of localChecks) {
      expect(check.status, `doctor check "${check.name}" should not fail`).not.toBe('fail')
    }
  })
})

// ---------------------------------------------------------------------------
// Scope isolation
// ---------------------------------------------------------------------------

describe('E2E: scope isolation', () => {
  it('removing from wrong scope fails with hint about correct scope', async () => {
    // Install skill-a globally
    setupInstalledSkill(homeDir, {
      name: 'scope-skill',
      files: { 'SKILL.md': createSkillMd({ name: 'scope-skill' }) },
      agents: ['claude-code'],
      scope: 'global',
    })

    // Try to remove from project scope → should fail with hint
    const result = await runCliJson<never>(['remove', 'scope-skill', '--yes', '--json'], cliOpts())

    expect(result.exitCode).not.toBe(0)
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('global')

    // Verify global skill is still intact
    const globalState = readProjectState(homeDir)
    expect(Object.keys(globalState.manifest?.packages ?? {})).toContain('scope-skill')
  })

  it('info without --global for global-only skill hints at correct scope', async () => {
    setupInstalledSkill(homeDir, {
      name: 'global-only',
      files: { 'SKILL.md': createSkillMd({ name: 'global-only' }) },
      agents: ['claude-code'],
      scope: 'global',
    })

    const result = await runCliJson<never>(['info', 'global-only', '--json'], cliOpts())

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('NOT_FOUND')
    expect(result.error?.message).toContain('global')
  })

  it('status --global shows only global, status (default) shows only project', async () => {
    setupInstalledSkill(homeDir, {
      name: 'g-skill',
      files: { 'SKILL.md': createSkillMd({ name: 'g-skill' }) },
      agents: ['claude-code'],
      scope: 'global',
    })

    setupInstalledSkill(projectDir, {
      name: 'p-skill',
      files: { 'SKILL.md': createSkillMd({ name: 'p-skill' }) },
      agents: ['claude-code'],
      scope: 'project',
    })

    // Default status (project)
    const statusProject = await runCliJson<{
      packages: Array<{ name: string }>
      summary: { total: number }
    }>(['status', '--offline', '--json'], cliOpts())

    expect(statusProject.data.summary.total).toBe(1)
    expect(statusProject.data.packages[0]!.name).toBe('p-skill')

    // Global status
    const statusGlobal = await runCliJson<{
      packages: Array<{ name: string }>
      summary: { total: number }
    }>(['status', '--global', '--offline', '--json'], cliOpts())

    expect(statusGlobal.data.summary.total).toBe(1)
    expect(statusGlobal.data.packages[0]!.name).toBe('g-skill')
  })

  it('project remove does not affect global manifest or files', async () => {
    // Install same-named skill in both scopes
    setupInstalledSkill(homeDir, {
      name: 'shared-name',
      files: { 'SKILL.md': createSkillMd({ name: 'shared-name', version: '2.0.0' }) },
      agents: ['claude-code'],
      scope: 'global',
    })

    setupInstalledSkill(projectDir, {
      name: 'shared-name',
      files: { 'SKILL.md': createSkillMd({ name: 'shared-name', version: '1.0.0' }) },
      agents: ['claude-code'],
      scope: 'project',
    })

    // list --all should show both
    const listBefore = await runCliJson<{
      packages: Array<{ name: string; scope: string }>
    }>(['list', '--all', '--json'], cliOpts())

    expect(listBefore.data.packages).toHaveLength(2)

    const scopes = listBefore.data.packages.map((p) => p.scope).sort()
    expect(scopes).toEqual(['global', 'project'])

    // Remove from project
    await runCliJson(['remove', 'shared-name', '--yes', '--json'], cliOpts())

    // Global should still have the skill
    const globalState = readProjectState(homeDir)
    expect(Object.keys(globalState.manifest?.packages ?? {})).toContain('shared-name')
    expect(existsSync(join(homeDir, '.agents/skills/shared-name/SKILL.md'))).toBe(true)

    // list --all should now show only global
    const listAfter = await runCliJson<{
      packages: Array<{ name: string; scope: string }>
    }>(['list', '--all', '--json'], cliOpts())

    expect(listAfter.data.packages).toHaveLength(1)
    expect(listAfter.data.packages[0]!.scope).toBe('global')
  })
})
