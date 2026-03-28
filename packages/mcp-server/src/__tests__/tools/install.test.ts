import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDownloadResponse,
  createLockfile,
  createManifest,
  createVersionListResponse,
} from '../helpers/fixtures'
import { createMockServer } from '../helpers/mock-server'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/test'),
}))

vi.mock('../../shared/context', () => ({
  getWorkingDirectory: vi.fn(),
}))

vi.mock('../../shared/registry', () => ({
  isAuthenticated: vi.fn(),
  registryFetch: vi.fn(),
  getRegistryUrl: vi.fn(),
}))

vi.mock('../../storage', () => ({
  readManifest: vi.fn(),
  writeManifest: vi.fn(),
  readLockfile: vi.fn(),
  writeLockfile: vi.fn(),
}))

vi.mock('@agentver/agent-definitions', () => ({
  detectInstalledAgents: vi.fn(),
  getSkillPlacementPath: vi.fn(),
}))

vi.mock('@agentver/shared', () => ({
  AgentverError: class AgentverError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
      this.name = 'AgentverError'
    }
  },
}))

describe('tools/install', () => {
  let fs: typeof import('node:fs')
  let contextMod: typeof import('../../shared/context')
  let registryMod: typeof import('../../shared/registry')
  let storageMod: typeof import('../../storage')
  let agentDefs: typeof import('@agentver/agent-definitions')
  let handler: (...args: unknown[]) => unknown

  beforeEach(async () => {
    vi.clearAllMocks()
    fs = await import('node:fs')
    contextMod = await import('../../shared/context')
    registryMod = await import('../../shared/registry')
    storageMod = await import('../../storage')
    agentDefs = await import('@agentver/agent-definitions')

    const { registerInstallTool } = await import('../../tools/install')
    const { server, getHandler } = createMockServer()
    registerInstallTool(server)
    handler = getHandler('agentver_install')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function setupAuthenticated(): void {
    vi.mocked(registryMod.isAuthenticated).mockReturnValue(true)
    vi.mocked(contextMod.getWorkingDirectory).mockReturnValue('/project')
    vi.mocked(registryMod.getRegistryUrl).mockReturnValue('https://app.agentver.com/api/v1')
    vi.mocked(storageMod.readManifest).mockReturnValue(createManifest())
    vi.mocked(storageMod.readLockfile).mockReturnValue(createLockfile())
    vi.mocked(fs.existsSync).mockReturnValue(false)
  }

  it('throws UNAUTHORISED when not authenticated', async () => {
    vi.mocked(registryMod.isAuthenticated).mockReturnValue(false)

    await expect(
      handler({ package: 'org/skill', version: undefined, agents: undefined, global: false })
    ).rejects.toMatchObject({ code: 'UNAUTHORISED' })
  })

  it('throws VALIDATION_ERROR for invalid package name', async () => {
    vi.mocked(registryMod.isAuthenticated).mockReturnValue(true)

    await expect(
      handler({ package: 'invalid!name', version: undefined, agents: undefined, global: false })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('resolves latest version when version not specified', async () => {
    setupAuthenticated()
    vi.mocked(registryMod.registryFetch)
      .mockResolvedValueOnce(createVersionListResponse())
      .mockResolvedValueOnce(createDownloadResponse())
    vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([
      { id: 'claude-code', name: 'Claude Code', configPath: '/project/.claude' },
    ] as ReturnType<typeof agentDefs.detectInstalledAgents>)
    vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/test-skill')

    await handler({
      package: 'test-org/test-skill',
      version: undefined,
      agents: undefined,
      global: false,
    })

    expect(registryMod.registryFetch).toHaveBeenCalledWith(expect.stringContaining('/versions'))
  })

  it('uses specified version when provided', async () => {
    setupAuthenticated()
    vi.mocked(registryMod.registryFetch).mockResolvedValue(createDownloadResponse())
    vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([
      { id: 'claude-code', name: 'Claude Code', configPath: '/project/.claude' },
    ] as ReturnType<typeof agentDefs.detectInstalledAgents>)
    vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/test-skill')

    await handler({
      package: 'test-org/test-skill',
      version: '2.0.0',
      agents: undefined,
      global: false,
    })

    // Should NOT call /versions endpoint
    expect(registryMod.registryFetch).toHaveBeenCalledTimes(1)
    expect(registryMod.registryFetch).toHaveBeenCalledWith(
      expect.stringContaining('/2.0.0/download')
    )
  })

  it('returns "no files" message when fileManifest is empty', async () => {
    setupAuthenticated()
    vi.mocked(registryMod.registryFetch).mockResolvedValue(
      createDownloadResponse({ fileManifest: {} })
    )

    const result = (await handler({
      package: 'test-org/test-skill',
      version: '1.0.0',
      agents: undefined,
      global: false,
    })) as { content: Array<{ text: string }> }

    expect(result.content[0]!.text).toContain('no files')
  })

  it('returns "no agents detected" when no agents found and none specified', async () => {
    setupAuthenticated()
    vi.mocked(registryMod.registryFetch).mockResolvedValue(createDownloadResponse())
    vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([])

    const result = (await handler({
      package: 'test-org/test-skill',
      version: '1.0.0',
      agents: undefined,
      global: false,
    })) as { content: Array<{ text: string }> }

    expect(result.content[0]!.text).toContain('No AI agents detected')
  })

  it('uses explicitly provided agent IDs instead of auto-detection', async () => {
    setupAuthenticated()
    vi.mocked(registryMod.registryFetch).mockResolvedValue(createDownloadResponse())
    vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.cursor/skills/test-skill')

    await handler({
      package: 'test-org/test-skill',
      version: '1.0.0',
      agents: ['cursor'],
      global: false,
    })

    expect(agentDefs.detectInstalledAgents).not.toHaveBeenCalled()
    expect(agentDefs.getSkillPlacementPath).toHaveBeenCalledWith('cursor', 'test-skill', 'project')
  })

  it('places files in correct directories via getSkillPlacementPath', async () => {
    setupAuthenticated()
    vi.mocked(registryMod.registryFetch).mockResolvedValue(
      createDownloadResponse({
        fileManifest: { 'SKILL.md': '# Skill content' },
      })
    )
    vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([
      { id: 'claude-code', name: 'Claude Code', configPath: '/project/.claude' },
    ] as ReturnType<typeof agentDefs.detectInstalledAgents>)
    vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/test-skill')

    await handler({
      package: 'test-org/test-skill',
      version: '1.0.0',
      agents: undefined,
      global: false,
    })

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('SKILL.md'),
      '# Skill content',
      'utf-8'
    )
  })

  it('skips files with .. in path', async () => {
    setupAuthenticated()
    vi.mocked(registryMod.registryFetch).mockResolvedValue(
      createDownloadResponse({
        fileManifest: [
          { path: '../../../etc/passwd', content: 'malicious' },
          { path: 'SKILL.md', content: '# Safe' },
        ] as unknown as Record<string, unknown>,
      })
    )
    vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([
      { id: 'claude-code', name: 'Claude Code', configPath: '/project/.claude' },
    ] as ReturnType<typeof agentDefs.detectInstalledAgents>)
    vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/test-skill')

    await handler({
      package: 'test-org/test-skill',
      version: '1.0.0',
      agents: undefined,
      global: false,
    })

    // Only SKILL.md should have been written
    const writeCalls = vi.mocked(fs.writeFileSync).mock.calls
    expect(writeCalls).toHaveLength(1)
    expect(writeCalls[0]![0]).toContain('SKILL.md')
  })

  it('updates manifest with package entry after install', async () => {
    setupAuthenticated()
    vi.mocked(registryMod.registryFetch).mockResolvedValue(createDownloadResponse())
    vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([
      { id: 'claude-code', name: 'Claude Code', configPath: '/project/.claude' },
    ] as ReturnType<typeof agentDefs.detectInstalledAgents>)
    vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/test-skill')

    await handler({
      package: 'test-org/test-skill',
      version: '1.0.0',
      agents: undefined,
      global: false,
    })

    expect(storageMod.writeManifest).toHaveBeenCalledWith(
      '/project',
      expect.objectContaining({
        packages: expect.objectContaining({
          'test-org/test-skill': expect.objectContaining({
            name: 'test-org/test-skill',
            version: '1.0.0',
          }),
        }),
      })
    )
  })

  it('updates lockfile with integrity hash and resolved URL', async () => {
    setupAuthenticated()
    vi.mocked(registryMod.registryFetch).mockResolvedValue(
      createDownloadResponse({ sha256: 'deadbeef' })
    )
    vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([
      { id: 'claude-code', name: 'Claude Code', configPath: '/project/.claude' },
    ] as ReturnType<typeof agentDefs.detectInstalledAgents>)
    vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/test-skill')

    await handler({
      package: 'test-org/test-skill',
      version: '1.0.0',
      agents: undefined,
      global: false,
    })

    expect(storageMod.writeLockfile).toHaveBeenCalledWith(
      '/project',
      expect.objectContaining({
        packages: expect.objectContaining({
          'test-org/test-skill': expect.objectContaining({
            integrity: 'sha256-deadbeef',
            resolved: expect.stringContaining('/download'),
          }),
        }),
      })
    )
  })

  it('returns summary with package name, version, agents, file count, and scope', async () => {
    setupAuthenticated()
    vi.mocked(registryMod.registryFetch).mockResolvedValue(createDownloadResponse())
    vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([
      { id: 'claude-code', name: 'Claude Code', configPath: '/project/.claude' },
    ] as ReturnType<typeof agentDefs.detectInstalledAgents>)
    vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/test-skill')

    const result = (await handler({
      package: 'test-org/test-skill',
      version: '1.0.0',
      agents: undefined,
      global: false,
    })) as { content: Array<{ text: string }> }

    const text = result.content[0]!.text
    expect(text).toContain('test-org/test-skill@1.0.0')
    expect(text).toContain('claude-code')
    expect(text).toContain('1 file(s)')
    expect(text).toContain('project')
  })

  it('filters out YANKED versions when resolving latest', async () => {
    setupAuthenticated()
    vi.mocked(registryMod.registryFetch)
      .mockResolvedValueOnce(
        createVersionListResponse({
          versions: [
            { version: '2.0.0', status: 'YANKED' },
            { version: '1.0.0', status: 'PUBLISHED' },
          ],
        })
      )
      .mockResolvedValueOnce(createDownloadResponse({ version: '1.0.0' }))
    vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([
      { id: 'claude-code', name: 'Claude Code', configPath: '/project/.claude' },
    ] as ReturnType<typeof agentDefs.detectInstalledAgents>)
    vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/test-skill')

    const result = (await handler({
      package: 'test-org/test-skill',
      version: undefined,
      agents: undefined,
      global: false,
    })) as { content: Array<{ text: string }> }

    expect(result.content[0]!.text).toContain('1.0.0')
    expect(registryMod.registryFetch).toHaveBeenLastCalledWith(
      expect.stringContaining('/1.0.0/download')
    )
  })
})
