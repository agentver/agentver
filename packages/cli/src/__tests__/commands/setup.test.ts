import type { ScannedFile } from '@agentver/agent-definitions'
import { createCLIOutputSchema, setupResultSchema } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLockfile, createManifest, createManifestPackage } from '../helpers/fixtures'
import { createNoopSpinner } from '../helpers/mock-spinner.js'

// ---------------------------------------------------------------------------
// Module-level mocks — must be declared before any import of the SUT
// ---------------------------------------------------------------------------

vi.mock('@agentver/agent-definitions', () => ({
  detectInstalledAgents: vi.fn(),
  detectGlobalAgents: vi.fn(),
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
  computeSha256FromFiles: vi.fn().mockReturnValue('sha256-test-hash'),
}))

vi.mock('../../git/fetcher.js', () => ({
  readFilesFromDirectory: vi
    .fn()
    .mockResolvedValue([{ path: 'SKILL.md', content: '# Test', size: 6 }]),
}))

vi.mock('../../git/local-context.js', () => ({
  resolveLocalGitContext: vi.fn().mockResolvedValue(null),
  createGitRepoCache: vi.fn().mockReturnValue({
    roots: new Map(),
    repos: new Map(),
  }),
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

vi.mock('../../commands/doctor.js', () => ({
  checkManifestIntegrity: vi.fn().mockReturnValue({
    name: 'manifest-integrity',
    status: 'pass',
    message: 'Manifest integrity OK',
  }),
  checkLockfileIntegrity: vi.fn().mockReturnValue({
    name: 'lockfile-integrity',
    status: 'pass',
    message: 'Lockfile integrity OK',
  }),
  checkManifestLockfileSync: vi.fn().mockReturnValue({
    name: 'manifest-lockfile-sync',
    status: 'pass',
    message: 'Manifest and lockfile in sync',
  }),
  checkSkillFilesExist: vi.fn().mockReturnValue({
    name: 'skill-files-exist',
    status: 'pass',
    message: 'All skill files exist',
  }),
  checkSymlinksValid: vi.fn().mockReturnValue({
    name: 'symlinks-valid',
    status: 'pass',
    message: 'All symlinks valid',
  }),
  formatCheck: vi.fn().mockReturnValue('  ✓ check passed'),
}))

vi.mock('../../commands/migrate.js', () => ({
  migrateSkills: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('prompts', () => ({
  default: vi.fn().mockResolvedValue({ selected: [] }),
}))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import * as agentDefs from '@agentver/agent-definitions'
import { Command } from 'commander'
import prompts from 'prompts'
import * as doctorModule from '../../commands/doctor.js'
import { registerSetupCommand } from '../../commands/setup'
import * as localContextModule from '../../git/local-context.js'
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
    type: 'skill',
    detectedType: 'SKILL',
    ...overrides,
  } as ScannedFile
}

function createProgram(): InstanceType<typeof Command> {
  const program = new Command()
  program.exitOverride()
  registerSetupCommand(program)
  return program
}

async function runSetup(...args: string[]): Promise<void> {
  const program = createProgram()
  await program.parseAsync(['node', 'agentver', 'setup', ...args])
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('commands/setup', () => {
  const originalCwd = process.cwd
  const originalExit = process.exit
  let stdoutSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    process.cwd = vi.fn().mockReturnValue('/project')
    process.exit = vi.fn() as never

    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

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

    vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([])
    vi.mocked(agentDefs.detectGlobalAgents).mockReturnValue([])
    vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([])
    vi.mocked(agentDefs.scanGlobalSkillFiles).mockReturnValue([])
    vi.mocked(localContextModule.resolveLocalGitContext).mockResolvedValue(null)
    vi.mocked(prompts).mockResolvedValue({ selected: [] })
  })

  afterEach(() => {
    process.cwd = originalCwd
    process.exit = originalExit
    stdoutSpy.mockRestore()
  })

  // -------------------------------------------------------------------------
  // 1. No agents or skills found
  // -------------------------------------------------------------------------

  describe('no agents or skills found', () => {
    it('prints "No agents detected" and "No skill or config files found" then runs health checks', async () => {
      await runSetup('--yes')

      const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')

      expect(output).toContain('No agents detected')
      expect(output).toContain('No skill or config files found')

      // Health checks still run
      expect(doctorModule.checkManifestIntegrity).toHaveBeenCalled()
      expect(doctorModule.checkLockfileIntegrity).toHaveBeenCalled()
      expect(doctorModule.checkManifestLockfileSync).toHaveBeenCalled()
      expect(doctorModule.checkSkillFilesExist).toHaveBeenCalled()
      expect(doctorModule.checkSymlinksValid).toHaveBeenCalled()
    })

    it('exits cleanly without errors', async () => {
      await runSetup('--yes')

      expect(process.exit).not.toHaveBeenCalled()
      expect(outputModule.outputError).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 2. Agents found but no skills
  // -------------------------------------------------------------------------

  describe('agents found but no skills', () => {
    it('displays agents, shows no skills message, and summary shows 0 adopted', async () => {
      vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([
        { id: 'claude-code', name: 'Claude Code', configPath: '.claude/config.json' },
        { id: 'cursor', name: 'Cursor', configPath: '.cursor/config.json' },
      ])

      await runSetup('--yes')

      const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')

      expect(output).toContain('Claude Code')
      expect(output).toContain('Cursor')
      expect(output).toContain('No skill or config files found')

      // No prompts should be shown
      expect(prompts).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 3. All discovered skills already managed
  // -------------------------------------------------------------------------

  describe('all discovered skills already managed', () => {
    it('shows "All discovered skills are already managed" and adopts nothing', async () => {
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([
        createScannedFile({ name: 'existing-skill' }),
      ])
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'existing-skill': createManifestPackage(),
          },
        })
      )

      await runSetup('--yes')

      const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')

      expect(output).toContain('All discovered skills are already managed')
      expect(pairModule.updateManifestAndLockfile).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 4. --yes mode adopts all unmanaged skills
  // -------------------------------------------------------------------------

  describe('--yes mode', () => {
    it('adopts all unmanaged skills without prompts', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      const file1 = createScannedFile({
        name: 'skill-a',
        path: '/project/.claude/skills/skill-a/SKILL.md',
      })
      const file2 = createScannedFile({
        name: 'skill-b',
        path: '/project/.claude/skills/skill-b/SKILL.md',
      })
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([file1, file2])

      await runSetup('--yes')

      // No interactive prompts
      expect(prompts).not.toHaveBeenCalled()

      // Both skills adopted
      expect(outputModule.outputSuccess).toHaveBeenCalledOnce()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as { adopted: Array<{ name: string }> }
      expect(typed.adopted).toHaveLength(2)

      const adoptedNames = typed.adopted.map((a) => a.name)
      expect(adoptedNames).toContain('skill-a')
      expect(adoptedNames).toContain('skill-b')
    })
  })

  // -------------------------------------------------------------------------
  // 5. --dry-run does not write to disk
  // -------------------------------------------------------------------------

  describe('--dry-run', () => {
    it('does not write manifest or lockfile changes', async () => {
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([
        createScannedFile({ name: 'new-skill' }),
      ])

      await runSetup('--yes', '--dry-run')

      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
      expect(lockfileModule.writeLockfile).not.toHaveBeenCalled()
      expect(pairModule.updateManifestAndLockfile).not.toHaveBeenCalled()
    })

    it('still reports what would be adopted in the summary', async () => {
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([
        createScannedFile({ name: 'new-skill' }),
      ])

      await runSetup('--yes', '--dry-run')

      const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')

      expect(output).toContain('dry-run')
    })
  })

  // -------------------------------------------------------------------------
  // 6. --json outputs valid structured result
  // -------------------------------------------------------------------------

  describe('--json output', () => {
    it('outputs JSON with success: true and data matching SetupResult schema', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([
        { id: 'claude-code', name: 'Claude Code', configPath: '.claude/config.json' },
      ])
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([
        createScannedFile({ name: 'my-skill' }),
      ])

      await runSetup('--yes')

      expect(outputModule.outputSuccess).toHaveBeenCalledOnce()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!

      // Validate against the Zod schema
      const envelope = { success: true, data }
      const outputSchema = createCLIOutputSchema(setupResultSchema)
      const result = outputSchema.safeParse(envelope)
      expect(result.success).toBe(true)
    })

    it('includes agents, discovered, adopted, skipped, canonicalised, and healthChecks arrays', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([
        { id: 'claude-code', name: 'Claude Code', configPath: '.claude/config.json' },
      ])
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([
        createScannedFile({ name: 'new-skill' }),
      ])

      await runSetup('--yes')

      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown[]>

      expect(typed.agents).toHaveLength(1)
      expect(typed.discovered).toHaveLength(1)
      expect(typed.adopted).toHaveLength(1)
      expect(typed.skipped).toHaveLength(0)
      expect(typed.canonicalised).toHaveLength(0)
      expect(typed.healthChecks).toHaveLength(5)
    })

    it('does not write human-readable output when in JSON mode', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      await runSetup('--yes')

      const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')

      // No human-readable headings
      expect(output).not.toContain('Agentver Setup')
      expect(output).not.toContain('Detected agents:')
    })
  })

  // -------------------------------------------------------------------------
  // 7. Idempotent — second run adopts nothing
  // -------------------------------------------------------------------------

  describe('idempotent — second run adopts nothing', () => {
    it('first run adopts, second run finds all already managed', async () => {
      const scannedFile = createScannedFile({ name: 'my-skill' })
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([scannedFile])
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      // First run: empty manifest, skill gets adopted
      await runSetup('--yes')

      expect(outputModule.outputSuccess).toHaveBeenCalledOnce()
      const [firstData] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const firstResult = firstData as { adopted: unknown[]; discovered: unknown[] }
      expect(firstResult.adopted).toHaveLength(1)

      // Second run: manifest now contains the skill
      vi.clearAllMocks()

      vi.mocked(outputModule.createSpinner).mockReturnValue(
        createNoopSpinner() as unknown as ReturnType<typeof outputModule.createSpinner>
      )
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([scannedFile])
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'my-skill': createManifestPackage(),
          },
        })
      )

      await runSetup('--yes')

      expect(outputModule.outputSuccess).toHaveBeenCalledOnce()
      const [secondData] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const secondResult = secondData as {
        adopted: unknown[]
        discovered: Array<{ alreadyManaged: boolean }>
      }
      expect(secondResult.adopted).toHaveLength(0)
      expect(secondResult.discovered[0]!.alreadyManaged).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // 8. --global flag includes global paths
  // -------------------------------------------------------------------------

  describe('--global flag', () => {
    it('calls global scanning functions for both agents and skills', async () => {
      vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([])
      vi.mocked(agentDefs.detectGlobalAgents).mockReturnValue([
        { id: 'cursor', name: 'Cursor', configPath: '~/.cursor/config.json' },
      ])
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([])
      vi.mocked(agentDefs.scanGlobalSkillFiles).mockReturnValue([
        createScannedFile({
          name: 'global-skill',
          path: '/home/testuser/.claude/skills/global-skill/SKILL.md',
        }),
      ])

      await runSetup('--yes', '--global')

      expect(agentDefs.detectGlobalAgents).toHaveBeenCalledWith('/home/testuser')
      expect(agentDefs.scanGlobalSkillFiles).toHaveBeenCalledWith('/home/testuser')
    })

    it('does not call global scanning when --global is not set', async () => {
      await runSetup('--yes')

      expect(agentDefs.detectGlobalAgents).not.toHaveBeenCalled()
      expect(agentDefs.scanGlobalSkillFiles).not.toHaveBeenCalled()
    })

    it('deduplicates agents found in both project and global scopes', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([
        { id: 'claude-code', name: 'Claude Code', configPath: '.claude/config.json' },
      ])
      vi.mocked(agentDefs.detectGlobalAgents).mockReturnValue([
        { id: 'claude-code', name: 'Claude Code', configPath: '~/.claude/config.json' },
        { id: 'cursor', name: 'Cursor', configPath: '~/.cursor/config.json' },
      ])

      await runSetup('--yes', '--global')

      expect(outputModule.outputSuccess).toHaveBeenCalledOnce()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as { agents: Array<{ id: string }> }

      const ids = typed.agents.map((a) => a.id)
      expect(ids).toEqual(['claude-code', 'cursor'])
    })
  })

  // -------------------------------------------------------------------------
  // 9. Skills already managed are skipped during adoption
  // -------------------------------------------------------------------------

  describe('mixed managed and unmanaged skills', () => {
    it('adopts new skills and skips already-managed ones', async () => {
      const newSkill = createScannedFile({
        name: 'new-skill',
        path: '/project/.claude/skills/new-skill/SKILL.md',
      })
      const managedSkill = createScannedFile({
        name: 'managed-skill',
        path: '/project/.claude/skills/managed-skill/SKILL.md',
      })
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([newSkill, managedSkill])
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'managed-skill': createManifestPackage(),
          },
        })
      )
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      await runSetup('--yes')

      expect(outputModule.outputSuccess).toHaveBeenCalledOnce()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as {
        adopted: Array<{ name: string }>
        discovered: Array<{ name: string; alreadyManaged: boolean }>
      }

      // Only new-skill should be adopted
      expect(typed.adopted).toHaveLength(1)
      expect(typed.adopted[0]!.name).toBe('new-skill')

      // Discovery should show both, with correct alreadyManaged flags
      expect(typed.discovered).toHaveLength(2)
      const discoveredNew = typed.discovered.find((d) => d.name === 'new-skill')
      const discoveredManaged = typed.discovered.find((d) => d.name === 'managed-skill')
      expect(discoveredNew!.alreadyManaged).toBe(false)
      expect(discoveredManaged!.alreadyManaged).toBe(true)
    })

    it('does not prompt for already-managed skills in interactive mode', async () => {
      const newSkill = createScannedFile({
        name: 'new-skill',
        path: '/project/.claude/skills/new-skill/SKILL.md',
      })
      const managedSkill = createScannedFile({
        name: 'managed-skill',
        path: '/project/.claude/skills/managed-skill/SKILL.md',
      })
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([newSkill, managedSkill])
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'managed-skill': createManifestPackage(),
          },
        })
      )

      // Simulate user selecting the one unmanaged skill
      vi.mocked(prompts).mockResolvedValue({ selected: [0] })

      await runSetup()

      // Prompts should only be called once for skill selection (not canonicalisation,
      // since we mocked prompts to return the skill selection)
      const promptCalls = vi.mocked(prompts).mock.calls
      expect(promptCalls.length).toBeGreaterThanOrEqual(1)

      // The choices presented should only include unmanaged skills
      const firstCall = promptCalls[0]![0] as { choices?: Array<{ title: string }> }
      if (firstCall.choices) {
        expect(firstCall.choices).toHaveLength(1)
        expect(firstCall.choices[0]!.title).toContain('new-skill')
      }
    })
  })

  // -------------------------------------------------------------------------
  // Health checks always run
  // -------------------------------------------------------------------------

  describe('health checks', () => {
    it('runs all five health checks regardless of adoption outcome', async () => {
      await runSetup('--yes')

      expect(doctorModule.checkManifestIntegrity).toHaveBeenCalledWith('/project', 'project')
      expect(doctorModule.checkLockfileIntegrity).toHaveBeenCalledWith('/project', 'project')
      expect(doctorModule.checkManifestLockfileSync).toHaveBeenCalledWith('/project', 'project')
      expect(doctorModule.checkSkillFilesExist).toHaveBeenCalledWith('/project', 'project')
      expect(doctorModule.checkSymlinksValid).toHaveBeenCalledWith('/project', 'project')
    })

    it('passes global scope to health checks when --global is set', async () => {
      await runSetup('--yes', '--global')

      expect(doctorModule.checkManifestIntegrity).toHaveBeenCalledWith('/project', 'global')
      expect(doctorModule.checkLockfileIntegrity).toHaveBeenCalledWith('/project', 'global')
      expect(doctorModule.checkManifestLockfileSync).toHaveBeenCalledWith('/project', 'global')
      expect(doctorModule.checkSkillFilesExist).toHaveBeenCalledWith('/project', 'global')
      expect(doctorModule.checkSymlinksValid).toHaveBeenCalledWith('/project', 'global')
    })

    it('includes health check results in JSON output', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      await runSetup('--yes')

      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as {
        healthChecks: Array<{ name: string; status: string; message: string }>
      }

      expect(typed.healthChecks).toHaveLength(5)
      expect(typed.healthChecks.every((c) => c.status === 'pass')).toBe(true)
    })
  })
})
