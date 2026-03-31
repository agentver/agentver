import type { ScannedFile } from '@agentver/agent-definitions'
import { adoptResultSchema, createCLIOutputSchema } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLockfile, createManifest, createManifestPackage } from '../helpers/fixtures'
import { createNoopSpinner } from '../helpers/mock-spinner.js'

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('@agentver/agent-definitions', () => ({
  scanForSkillFiles: vi.fn(),
  scanGlobalSkillFiles: vi.fn(),
}))

vi.mock('../../storage/manifest', () => ({
  readManifest: vi.fn(),
  writeManifest: vi.fn(),
}))

vi.mock('../../storage/lockfile', () => ({
  readLockfile: vi.fn(),
  writeLockfile: vi.fn(),
}))

vi.mock('../../storage/pair', () => ({
  updateManifestAndLockfile: vi.fn(),
}))

vi.mock('../../storage/integrity', () => ({
  computeSha256FromBuffer: vi.fn().mockReturnValue('sha256-test-hash'),
}))

vi.mock('node:fs', () => ({
  readFileSync: vi.fn().mockReturnValue('test content'),
}))

vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('/home/testuser'),
}))

vi.mock('../../output.js', () => ({
  isJSONMode: vi.fn().mockReturnValue(false),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
  createSpinner: vi.fn(),
}))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import * as agentDefs from '@agentver/agent-definitions'
import { adoptSkills } from '../../commands/adopt'
import * as outputModule from '../../output.js'
import * as lockfileModule from '../../storage/lockfile'
import * as manifestModule from '../../storage/manifest'
import * as pairModule from '../../storage/pair'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createScannedFile(overrides?: Partial<ScannedFile>): ScannedFile {
  return {
    path: '/project/.claude/skills/test-skill/SKILL.md',
    name: 'test-skill',
    agentId: 'claude-code',
    detectedType: 'SKILL',
    ...overrides,
  } as ScannedFile
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('commands/adopt', () => {
  const originalCwd = process.cwd
  const originalArgv = process.argv
  const originalExit = process.exit

  beforeEach(() => {
    vi.clearAllMocks()
    process.cwd = vi.fn().mockReturnValue('/project')
    process.argv = ['node', 'agentver', 'adopt']
    process.exit = vi.fn() as never

    vi.mocked(outputModule.createSpinner).mockReturnValue(
      createNoopSpinner() as unknown as ReturnType<typeof outputModule.createSpinner>
    )
    vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
    vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())
    vi.mocked(lockfileModule.readLockfile).mockReturnValue(createLockfile())
    vi.mocked(pairModule.updateManifestAndLockfile).mockImplementation(
      (projectRoot, scope, updater) => {
        const manifest = structuredClone(manifestModule.readManifest(projectRoot, scope))
        const lockfile = structuredClone(lockfileModule.readLockfile(projectRoot, scope))
        const updated = updater(manifest, lockfile)
        manifestModule.writeManifest(projectRoot, updated.manifest, scope)
        lockfileModule.writeLockfile(projectRoot, updated.lockfile, scope)
        return updated
      }
    )
    vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([])
    vi.mocked(agentDefs.scanGlobalSkillFiles).mockReturnValue([])
  })

  afterEach(() => {
    process.cwd = originalCwd
    process.argv = originalArgv
    process.exit = originalExit
  })

  // -------------------------------------------------------------------------
  // 1. Happy path
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    it('scans project and adds found skills to manifest', async () => {
      const scannedFile = createScannedFile()
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([scannedFile])

      await adoptSkills(undefined, {})

      expect(manifestModule.writeManifest).toHaveBeenCalledTimes(1)
      const [, manifest] = vi.mocked(manifestModule.writeManifest).mock.calls[0]!
      expect(manifest.packages).toHaveProperty('test-skill')
      expect(manifest.packages['test-skill']!.agents).toEqual(['claude-code'])
    })

    it('writes lockfile with integrity hash for adopted skill', async () => {
      const scannedFile = createScannedFile()
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([scannedFile])

      await adoptSkills(undefined, {})

      expect(lockfileModule.writeLockfile).toHaveBeenCalledTimes(1)
      const [, lockfile] = vi.mocked(lockfileModule.writeLockfile).mock.calls[0]!
      expect(lockfile.packages).toHaveProperty('test-skill')
      expect(lockfile.packages['test-skill']!.integrity).toContain('sha256-')
    })
  })

  // -------------------------------------------------------------------------
  // 2. --global flag
  // -------------------------------------------------------------------------

  describe('--global flag', () => {
    it('scans global agent paths in addition to project paths', async () => {
      const projectFile = createScannedFile({ name: 'project-skill' })
      const globalFile = createScannedFile({
        name: 'global-skill',
        path: '/home/testuser/.claude/skills/global-skill/SKILL.md',
      })

      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([projectFile])
      vi.mocked(agentDefs.scanGlobalSkillFiles).mockReturnValue([globalFile])

      await adoptSkills(undefined, { global: true })

      expect(agentDefs.scanGlobalSkillFiles).toHaveBeenCalledWith('/home/testuser')
      expect(manifestModule.writeManifest).toHaveBeenCalledTimes(1)
      const [, manifest] = vi.mocked(manifestModule.writeManifest).mock.calls[0]!
      expect(manifest.packages).toHaveProperty('project-skill')
      expect(manifest.packages).toHaveProperty('global-skill')
    })
  })

  // -------------------------------------------------------------------------
  // 3. --dry-run
  // -------------------------------------------------------------------------

  describe('--dry-run', () => {
    it('shows what would be adopted without writing anything', async () => {
      const scannedFile = createScannedFile()
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([scannedFile])

      await adoptSkills(undefined, { dryRun: true })

      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
      expect(lockfileModule.writeLockfile).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 4. Already managed
  // -------------------------------------------------------------------------

  describe('already managed', () => {
    it('skips skills already in manifest without duplicating', async () => {
      const scannedFile = createScannedFile()
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([scannedFile])
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'test-skill': createManifestPackage(),
          },
        })
      )

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'adopt', '--json']

      await adoptSkills(undefined, {})

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown[]>
      expect(typed.adopted).toHaveLength(0)
      expect(typed.skipped).toHaveLength(1)
    })
  })

  // -------------------------------------------------------------------------
  // 5. --name filter
  // -------------------------------------------------------------------------

  describe('--name filter', () => {
    it('only adopts skill matching the provided name', async () => {
      const file1 = createScannedFile({ name: 'skill-a' })
      const file2 = createScannedFile({ name: 'skill-b' })
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([file1, file2])

      await adoptSkills(undefined, { name: 'skill-a' })

      expect(manifestModule.writeManifest).toHaveBeenCalledTimes(1)
      const [, manifest] = vi.mocked(manifestModule.writeManifest).mock.calls[0]!
      expect(manifest.packages).toHaveProperty('skill-a')
      expect(manifest.packages).not.toHaveProperty('skill-b')
    })

    it('exits with error when no skill matches the name filter', async () => {
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([
        createScannedFile({ name: 'skill-a' }),
      ])
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'adopt', '--json']

      await adoptSkills(undefined, { name: 'nonexistent' })

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'NOT_FOUND',
        expect.stringContaining('nonexistent')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -------------------------------------------------------------------------
  // 6. --json output
  // -------------------------------------------------------------------------

  describe('--json output', () => {
    it('validates against adoptResultSchema', async () => {
      const scannedFile = createScannedFile()
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([scannedFile])
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'adopt', '--json']

      await adoptSkills(undefined, {})

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const envelope = { success: true, data }
      const outputSchema = createCLIOutputSchema(adoptResultSchema)
      const result = outputSchema.safeParse(envelope)
      expect(result.success).toBe(true)
    })

    it('includes adopted and skipped arrays', async () => {
      const scannedFile = createScannedFile({
        name: 'new-skill',
        path: '/project/.claude/skills/new-skill/SKILL.md',
      })
      const existingFile = createScannedFile({
        name: 'old-skill',
        path: '/project/.claude/skills/old-skill/SKILL.md',
      })
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([scannedFile, existingFile])
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: { 'old-skill': createManifestPackage() },
        })
      )
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'adopt', '--json']

      await adoptSkills(undefined, {})

      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as { adopted: unknown[]; skipped: unknown[] }
      expect(typed.adopted).toHaveLength(1)
      expect(typed.skipped).toHaveLength(1)
    })
  })

  // -------------------------------------------------------------------------
  // 7. Multiple agents same skill — deduplication
  // -------------------------------------------------------------------------

  describe('deduplication', () => {
    it('merges agents for the same file path instead of duplicating', async () => {
      const file1 = createScannedFile({
        path: '/project/.claude/skills/shared-skill/SKILL.md',
        name: 'shared-skill',
        agentId: 'claude-code',
      })
      const file2 = createScannedFile({
        path: '/project/.claude/skills/shared-skill/SKILL.md',
        name: 'shared-skill',
        agentId: 'cursor',
      })
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([file1, file2])

      await adoptSkills(undefined, {})

      expect(manifestModule.writeManifest).toHaveBeenCalledTimes(1)
      const [, manifest] = vi.mocked(manifestModule.writeManifest).mock.calls[0]!
      expect(manifest.packages['shared-skill']!.agents).toEqual(['claude-code', 'cursor'])
    })
  })

  // -------------------------------------------------------------------------
  // 8. Empty project
  // -------------------------------------------------------------------------

  describe('empty project', () => {
    it('returns empty arrays when no skills found', async () => {
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([])
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'adopt', '--json']

      await adoptSkills(undefined, {})

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data, _warnings] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as { adopted: unknown[]; skipped: unknown[] }
      expect(typed.adopted).toHaveLength(0)
      expect(typed.skipped).toHaveLength(0)
    })

    it('does not write manifest when no skills found', async () => {
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([])

      await adoptSkills(undefined, {})

      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
    })
  })
})
