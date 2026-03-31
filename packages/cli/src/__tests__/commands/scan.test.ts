import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createManifest, createManifestPackage, createSharedGitSource } from '../helpers/fixtures'

// ---------------------------------------------------------------------------
// Module-level mocks — must be declared before any import of the SUT
// ---------------------------------------------------------------------------

vi.mock('@agentver/agent-definitions', () => ({
  detectInstalledAgents: vi.fn(),
  detectGlobalAgents: vi.fn(),
  scanForSkillFiles: vi.fn(),
  scanGlobalSkillFiles: vi.fn(),
}))

vi.mock('@agentver/shared', () => ({
  validateSkillMd: vi.fn(),
  getPackageSourceCommit: vi.fn((source: { commit?: string }) => source.commit ?? ''),
  getPackageSourceLocation: vi.fn((source: { uri?: string; path?: string; hostname?: string }) => {
    if (source.uri) return source.path ? `${source.uri}/${source.path}` : source.uri
    return source.hostname ?? 'unknown'
  }),
  getPackageSourceReference: vi.fn((source: { ref?: string }) => source.ref ?? 'unknown'),
}))

vi.mock('../../storage/manifest.js', () => ({
  readManifest: vi.fn(),
}))

vi.mock('../../output', () => ({
  isJSONMode: vi.fn(),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
  createSpinner: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    text: '',
  })),
}))

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}))

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/test-user'),
}))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import { registerScanCommand } from '../../commands/scan'

// ---------------------------------------------------------------------------
// Mock module imports (typed references)
// ---------------------------------------------------------------------------

import * as nodeFs from 'node:fs'
import * as agentDefs from '@agentver/agent-definitions'
import * as sharedModule from '@agentver/shared'
import { Command } from 'commander'
import * as outputModule from '../../output'
import * as manifestModule from '../../storage/manifest.js'

describe('scan command', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function createProgram(): InstanceType<typeof Command> {
    const program = new Command()
    program.exitOverride()
    registerScanCommand(program)
    return program
  }

  async function runScan(...args: string[]): Promise<void> {
    const program = createProgram()
    await program.parseAsync(['node', 'agentver', 'scan', ...args])
  }

  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------

  describe('happy path', () => {
    it('detects agents and skills in project directory', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([
        { id: 'claude-code', name: 'Claude Code', configPath: '.claude/config.json' },
        { id: 'cursor', name: 'Cursor', configPath: '.cursor/config.json' },
      ])

      vi.mocked(agentDefs.detectGlobalAgents).mockReturnValue([])

      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([
        {
          name: 'my-skill',
          path: '/project/.agents/skills/my-skill/SKILL.md',
          agentId: 'claude-code',
          type: 'skill',
          detectedType: 'SKILL',
        },
      ])

      vi.mocked(agentDefs.scanGlobalSkillFiles).mockReturnValue([])

      vi.mocked(nodeFs.readFileSync).mockReturnValue(
        '---\nname: my-skill\ndescription: A skill\n---\n# My Skill'
      )

      vi.mocked(sharedModule.validateSkillMd).mockReturnValue({
        valid: true,
        specCompliant: true,
        errors: [],
        warnings: [],
        agentverExtensions: [],
      })

      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())

      await runScan()

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('Claude Code')
      expect(output).toContain('Cursor')
      expect(output).toContain('my-skill')
    })

    it('renders installed package display names when manifest keys are stable ids', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([])
      vi.mocked(agentDefs.detectGlobalAgents).mockReturnValue([])
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([])
      vi.mocked(agentDefs.scanGlobalSkillFiles).mockReturnValue([])

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'git:https%3A%2F%2Fgithub.com%2Forg%2Frepo%23skills%2Fmy-skill': createManifestPackage({
              name: 'org/my-skill',
              source: createSharedGitSource({
                uri: 'https://github.com/org/repo',
                path: 'skills/my-skill',
                ref: 'main',
                commit: 'abc1234567',
              }),
            }),
          },
        })
      )

      await runScan()

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('org/my-skill')
      expect(output).not.toContain('git:https%3A%2F%2Fgithub.com%2Forg%2Frepo%23skills%2Fmy-skill')
    })
  })

  // ---------------------------------------------------------------------------
  // Empty project
  // ---------------------------------------------------------------------------

  describe('empty project', () => {
    it('shows appropriate message when no agents or skills are found', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([])
      vi.mocked(agentDefs.detectGlobalAgents).mockReturnValue([])
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([])
      vi.mocked(agentDefs.scanGlobalSkillFiles).mockReturnValue([])
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())

      await runScan()

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('No agents detected')
      expect(output).toContain('No skill or config files found')
    })
  })

  // ---------------------------------------------------------------------------
  // --path flag (scan [path])
  // ---------------------------------------------------------------------------

  describe('--path flag', () => {
    it('scans the specified directory rather than cwd', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([])
      vi.mocked(agentDefs.detectGlobalAgents).mockReturnValue([])
      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([])
      vi.mocked(agentDefs.scanGlobalSkillFiles).mockReturnValue([])
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())

      await runScan('/custom/path')

      expect(agentDefs.detectInstalledAgents).toHaveBeenCalledWith('/custom/path')
      expect(agentDefs.scanForSkillFiles).toHaveBeenCalledWith('/custom/path')
    })
  })

  // ---------------------------------------------------------------------------
  // --json output
  // ---------------------------------------------------------------------------

  describe('--json output', () => {
    it('outputs JSON matching the ScanResult schema', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([
        { id: 'claude-code', name: 'Claude Code', configPath: '.claude/config.json' },
      ])

      vi.mocked(agentDefs.detectGlobalAgents).mockReturnValue([])

      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([
        {
          name: 'my-skill',
          path: '/project/.agents/skills/my-skill/SKILL.md',
          agentId: 'claude-code',
          type: 'skill',
          detectedType: 'SKILL',
        },
      ])

      vi.mocked(agentDefs.scanGlobalSkillFiles).mockReturnValue([])

      await runScan()

      expect(outputModule.outputSuccess).toHaveBeenCalledOnce()
      const mockedOutputSuccess = vi.mocked(outputModule.outputSuccess)
      const data = mockedOutputSuccess.mock.calls[0]![0] as {
        agents: Array<{ id: string; name: string; paths: string[] }>
        skills: Array<{ name: string; path: string; type: string }>
      }

      expect(data.agents).toHaveLength(1)
      expect(data.agents[0]!.id).toBe('claude-code')
      expect(data.skills).toHaveLength(1)
      expect(data.skills[0]!.name).toBe('my-skill')
      expect(data.skills[0]!.type).toBe('SKILL')
    })
  })

  // ---------------------------------------------------------------------------
  // SKILL.md validation
  // ---------------------------------------------------------------------------

  describe('SKILL.md validation', () => {
    it('reports spec compliance for found skill files', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([])
      vi.mocked(agentDefs.detectGlobalAgents).mockReturnValue([])

      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([
        {
          name: 'valid-skill',
          path: '/project/.agents/skills/valid-skill/SKILL.md',
          agentId: 'claude-code',
          type: 'skill',
          detectedType: 'SKILL',
        },
        {
          name: 'invalid-skill',
          path: '/project/.agents/skills/invalid-skill/SKILL.md',
          agentId: 'claude-code',
          type: 'skill',
          detectedType: 'SKILL',
        },
      ])

      vi.mocked(agentDefs.scanGlobalSkillFiles).mockReturnValue([])

      vi.mocked(nodeFs.readFileSync)
        .mockReturnValueOnce('---\nname: valid-skill\ndescription: Valid\n---\n')
        .mockReturnValueOnce('---\nname: invalid-skill\n---\n')

      vi.mocked(sharedModule.validateSkillMd)
        .mockReturnValueOnce({
          valid: true,
          specCompliant: true,
          errors: [],
          warnings: [],
          agentverExtensions: [],
        })
        .mockReturnValueOnce({
          valid: false,
          specCompliant: false,
          errors: ['Missing description'],
          warnings: [],
          agentverExtensions: [],
        })

      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())

      await runScan()

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('Agent Skills spec compliant')
      expect(output).toContain('Invalid')
      expect(output).toContain('Missing description')
    })
  })

  // ---------------------------------------------------------------------------
  // Multiple agents
  // ---------------------------------------------------------------------------

  describe('multiple agents', () => {
    it('lists all installed agents including global ones', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([
        { id: 'claude-code', name: 'Claude Code', configPath: '.claude/config.json' },
      ])

      vi.mocked(agentDefs.detectGlobalAgents).mockReturnValue([
        { id: 'cursor', name: 'Cursor', configPath: '~/.cursor/config.json' },
        { id: 'windsurf', name: 'Windsurf', configPath: '~/.windsurf/config.json' },
      ])

      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([])
      vi.mocked(agentDefs.scanGlobalSkillFiles).mockReturnValue([])
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())

      await runScan()

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('Claude Code')
      expect(output).toContain('Cursor')
      expect(output).toContain('Windsurf')
    })

    it('deduplicates agents found in both project and global', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([
        { id: 'claude-code', name: 'Claude Code', configPath: '.claude/config.json' },
      ])

      vi.mocked(agentDefs.detectGlobalAgents).mockReturnValue([
        { id: 'claude-code', name: 'Claude Code', configPath: '~/.claude/config.json' },
        { id: 'cursor', name: 'Cursor', configPath: '~/.cursor/config.json' },
      ])

      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([])
      vi.mocked(agentDefs.scanGlobalSkillFiles).mockReturnValue([])

      await runScan()

      expect(outputModule.outputSuccess).toHaveBeenCalledOnce()
      const mockedOutputSuccess = vi.mocked(outputModule.outputSuccess)
      const data = mockedOutputSuccess.mock.calls[0]![0] as {
        agents: Array<{ id: string }>
      }

      const ids = data.agents.map((a) => a.id)
      expect(ids).toEqual(['claude-code', 'cursor'])
    })
  })

  // ---------------------------------------------------------------------------
  // Global scan
  // ---------------------------------------------------------------------------

  describe('global scan', () => {
    it('detects globally installed skills alongside project skills', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([])
      vi.mocked(agentDefs.detectGlobalAgents).mockReturnValue([])

      vi.mocked(agentDefs.scanForSkillFiles).mockReturnValue([
        {
          name: 'project-skill',
          path: '/project/.agents/skills/project-skill/SKILL.md',
          agentId: 'claude-code',
          type: 'skill',
          detectedType: 'SKILL',
        },
      ])

      vi.mocked(agentDefs.scanGlobalSkillFiles).mockReturnValue([
        {
          name: 'global-skill',
          path: '/home/test-user/.agents/skills/global-skill/SKILL.md',
          agentId: 'claude-code',
          type: 'skill',
          detectedType: 'SKILL',
        },
      ])

      await runScan()

      expect(outputModule.outputSuccess).toHaveBeenCalledOnce()
      const mockedOutputSuccess = vi.mocked(outputModule.outputSuccess)
      const data = mockedOutputSuccess.mock.calls[0]![0] as {
        skills: Array<{ name: string }>
      }

      expect(data.skills).toHaveLength(2)
      expect(data.skills.map((s) => s.name)).toEqual(['project-skill', 'global-skill'])
    })
  })
})
