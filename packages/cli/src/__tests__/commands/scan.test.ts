import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createManifest } from '../helpers/fixtures'

vi.mock('@agentver/agent-definitions', () => ({
  detectInstalledAgents: vi.fn(),
  detectGlobalAgents: vi.fn(),
  scanForSkillFiles: vi.fn(),
  scanGlobalSkillFiles: vi.fn(),
}))

vi.mock('@agentver/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentver/shared')>()
  return {
    ...actual,
    validateSkillMd: vi.fn(),
  }
})

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

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: vi.fn(),
  }
})

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return {
    ...actual,
    homedir: vi.fn(() => '/home/test-user'),
  }
})

describe('scan command', () => {
  let detectInstalledAgents: ReturnType<typeof vi.fn>
  let detectGlobalAgents: ReturnType<typeof vi.fn>
  let scanForSkillFiles: ReturnType<typeof vi.fn>
  let scanGlobalSkillFiles: ReturnType<typeof vi.fn>
  let validateSkillMd: ReturnType<typeof vi.fn>
  let readManifest: ReturnType<typeof vi.fn>
  let isJSONMode: ReturnType<typeof vi.fn>
  let outputSuccess: ReturnType<typeof vi.fn>
  let readFileSync: ReturnType<typeof vi.fn>
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let registerScanCommand: typeof import('../../commands/scan').registerScanCommand
  let Command: typeof import('commander').Command

  beforeEach(async () => {
    vi.clearAllMocks()

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const agentDefModule = await import('@agentver/agent-definitions')
    const sharedModule = await import('@agentver/shared')
    const manifestModule = await import('../../storage/manifest.js')
    const outputModule = await import('../../output')
    const fsModule = await import('node:fs')

    detectInstalledAgents = vi.mocked(agentDefModule.detectInstalledAgents)
    detectGlobalAgents = vi.mocked(agentDefModule.detectGlobalAgents)
    scanForSkillFiles = vi.mocked(agentDefModule.scanForSkillFiles)
    scanGlobalSkillFiles = vi.mocked(agentDefModule.scanGlobalSkillFiles)
    validateSkillMd = vi.mocked(sharedModule.validateSkillMd)
    readManifest = vi.mocked(manifestModule.readManifest)
    isJSONMode = vi.mocked(outputModule.isJSONMode)
    outputSuccess = vi.mocked(outputModule.outputSuccess)
    readFileSync = vi.mocked(fsModule.readFileSync)

    const commanderModule = await import('commander')
    Command = commanderModule.Command

    const scanModule = await import('../../commands/scan')
    registerScanCommand = scanModule.registerScanCommand
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
      isJSONMode.mockReturnValue(false)

      detectInstalledAgents.mockReturnValue([
        { id: 'claude-code', name: 'Claude Code', configPath: '.claude/config.json' },
        { id: 'cursor', name: 'Cursor', configPath: '.cursor/config.json' },
      ])

      detectGlobalAgents.mockReturnValue([])

      scanForSkillFiles.mockReturnValue([
        {
          name: 'my-skill',
          path: '/project/.agents/skills/my-skill/SKILL.md',
          agentId: 'claude-code',
          detectedType: 'SKILL',
        },
      ])

      scanGlobalSkillFiles.mockReturnValue([])

      readFileSync.mockReturnValue('---\nname: my-skill\ndescription: A skill\n---\n# My Skill')

      validateSkillMd.mockReturnValue({
        valid: true,
        specCompliant: true,
        errors: [],
        warnings: [],
        agentverExtensions: [],
      })

      readManifest.mockReturnValue(createManifest())

      await runScan()

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(output).toContain('Claude Code')
      expect(output).toContain('Cursor')
      expect(output).toContain('my-skill')
    })
  })

  // ---------------------------------------------------------------------------
  // Empty project
  // ---------------------------------------------------------------------------

  describe('empty project', () => {
    it('shows appropriate message when no agents or skills are found', async () => {
      isJSONMode.mockReturnValue(false)

      detectInstalledAgents.mockReturnValue([])
      detectGlobalAgents.mockReturnValue([])
      scanForSkillFiles.mockReturnValue([])
      scanGlobalSkillFiles.mockReturnValue([])
      readManifest.mockReturnValue(createManifest())

      await runScan()

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(output).toContain('No agents detected')
      expect(output).toContain('No skill or config files found')
    })
  })

  // ---------------------------------------------------------------------------
  // --path flag (scan [path])
  // ---------------------------------------------------------------------------

  describe('--path flag', () => {
    it('scans the specified directory rather than cwd', async () => {
      isJSONMode.mockReturnValue(false)

      detectInstalledAgents.mockReturnValue([])
      detectGlobalAgents.mockReturnValue([])
      scanForSkillFiles.mockReturnValue([])
      scanGlobalSkillFiles.mockReturnValue([])
      readManifest.mockReturnValue(createManifest())

      await runScan('/custom/path')

      expect(detectInstalledAgents).toHaveBeenCalledWith('/custom/path')
      expect(scanForSkillFiles).toHaveBeenCalledWith('/custom/path')
    })
  })

  // ---------------------------------------------------------------------------
  // --json output
  // ---------------------------------------------------------------------------

  describe('--json output', () => {
    it('outputs JSON matching the ScanResult schema', async () => {
      isJSONMode.mockReturnValue(true)

      detectInstalledAgents.mockReturnValue([
        { id: 'claude-code', name: 'Claude Code', configPath: '.claude/config.json' },
      ])

      detectGlobalAgents.mockReturnValue([])

      scanForSkillFiles.mockReturnValue([
        {
          name: 'my-skill',
          path: '/project/.agents/skills/my-skill/SKILL.md',
          agentId: 'claude-code',
          detectedType: 'SKILL',
        },
      ])

      scanGlobalSkillFiles.mockReturnValue([])

      await runScan()

      expect(outputSuccess).toHaveBeenCalledOnce()
      const data = outputSuccess.mock.calls[0]![0] as {
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
      isJSONMode.mockReturnValue(false)

      detectInstalledAgents.mockReturnValue([])
      detectGlobalAgents.mockReturnValue([])

      scanForSkillFiles.mockReturnValue([
        {
          name: 'valid-skill',
          path: '/project/.agents/skills/valid-skill/SKILL.md',
          agentId: 'claude-code',
          detectedType: 'SKILL',
        },
        {
          name: 'invalid-skill',
          path: '/project/.agents/skills/invalid-skill/SKILL.md',
          agentId: 'claude-code',
          detectedType: 'SKILL',
        },
      ])

      scanGlobalSkillFiles.mockReturnValue([])

      readFileSync
        .mockReturnValueOnce('---\nname: valid-skill\ndescription: Valid\n---\n')
        .mockReturnValueOnce('---\nname: invalid-skill\n---\n')

      validateSkillMd
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

      readManifest.mockReturnValue(createManifest())

      await runScan()

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
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
      isJSONMode.mockReturnValue(false)

      detectInstalledAgents.mockReturnValue([
        { id: 'claude-code', name: 'Claude Code', configPath: '.claude/config.json' },
      ])

      detectGlobalAgents.mockReturnValue([
        { id: 'cursor', name: 'Cursor', configPath: '~/.cursor/config.json' },
        { id: 'windsurf', name: 'Windsurf', configPath: '~/.windsurf/config.json' },
      ])

      scanForSkillFiles.mockReturnValue([])
      scanGlobalSkillFiles.mockReturnValue([])
      readManifest.mockReturnValue(createManifest())

      await runScan()

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(output).toContain('Claude Code')
      expect(output).toContain('Cursor')
      expect(output).toContain('Windsurf')
    })

    it('deduplicates agents found in both project and global', async () => {
      isJSONMode.mockReturnValue(true)

      detectInstalledAgents.mockReturnValue([
        { id: 'claude-code', name: 'Claude Code', configPath: '.claude/config.json' },
      ])

      detectGlobalAgents.mockReturnValue([
        { id: 'claude-code', name: 'Claude Code', configPath: '~/.claude/config.json' },
        { id: 'cursor', name: 'Cursor', configPath: '~/.cursor/config.json' },
      ])

      scanForSkillFiles.mockReturnValue([])
      scanGlobalSkillFiles.mockReturnValue([])

      await runScan()

      expect(outputSuccess).toHaveBeenCalledOnce()
      const data = outputSuccess.mock.calls[0]![0] as {
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
      isJSONMode.mockReturnValue(true)

      detectInstalledAgents.mockReturnValue([])
      detectGlobalAgents.mockReturnValue([])

      scanForSkillFiles.mockReturnValue([
        {
          name: 'project-skill',
          path: '/project/.agents/skills/project-skill/SKILL.md',
          agentId: 'claude-code',
          detectedType: 'SKILL',
        },
      ])

      scanGlobalSkillFiles.mockReturnValue([
        {
          name: 'global-skill',
          path: '/home/test-user/.agents/skills/global-skill/SKILL.md',
          agentId: 'claude-code',
          detectedType: 'SKILL',
        },
      ])

      await runScan()

      expect(outputSuccess).toHaveBeenCalledOnce()
      const data = outputSuccess.mock.calls[0]![0] as {
        skills: Array<{ name: string }>
      }

      expect(data.skills).toHaveLength(2)
      expect(data.skills.map((s) => s.name)).toEqual(['project-skill', 'global-skill'])
    })
  })
})
