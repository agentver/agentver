import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInstalledPackage, createLockfile, createManifest } from '../helpers/fixtures'
import { createMockServer } from '../helpers/mock-server'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  rmSync: vi.fn(),
}))

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/test'),
}))

vi.mock('../../shared/context', () => ({
  getWorkingDirectory: vi.fn(),
}))

vi.mock('../../storage', () => ({
  readManifest: vi.fn(),
  writeManifest: vi.fn(),
  readLockfile: vi.fn(),
  writeLockfile: vi.fn(),
}))

vi.mock('@agentver/agent-definitions', () => ({
  getSkillPlacementPath: vi.fn(),
}))

describe('tools/remove', () => {
  let fs: typeof import('node:fs')
  let contextMod: typeof import('../../shared/context')
  let storageMod: typeof import('../../storage')
  let agentDefs: typeof import('@agentver/agent-definitions')
  let handler: (...args: unknown[]) => unknown

  beforeEach(async () => {
    vi.clearAllMocks()
    fs = await import('node:fs')
    contextMod = await import('../../shared/context')
    storageMod = await import('../../storage')
    agentDefs = await import('@agentver/agent-definitions')

    const { registerRemoveTool } = await import('../../tools/remove')
    const { server, getHandler } = createMockServer()
    registerRemoveTool(server)
    handler = getHandler('agentver_remove')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws NOT_FOUND when package not in manifest', async () => {
    vi.mocked(contextMod.getWorkingDirectory).mockReturnValue('/project')
    vi.mocked(storageMod.readManifest).mockReturnValue(createManifest())

    await expect(handler({ package: 'org/nonexistent', global: false })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('removes skill directories for each agent in package', async () => {
    vi.mocked(contextMod.getWorkingDirectory).mockReturnValue('/project')
    vi.mocked(storageMod.readManifest).mockReturnValue(
      createManifest({
        packages: {
          'test-org/test-skill': createInstalledPackage({ agents: ['claude-code', 'cursor'] }),
        },
      })
    )
    vi.mocked(storageMod.readLockfile).mockReturnValue(createLockfile())
    vi.mocked(agentDefs.getSkillPlacementPath)
      .mockReturnValueOnce('.claude/skills/test-skill')
      .mockReturnValueOnce('.cursor/skills/test-skill')
    vi.mocked(fs.existsSync).mockReturnValue(true)

    await handler({ package: 'test-org/test-skill', global: false })

    expect(fs.rmSync).toHaveBeenCalledTimes(2)
    expect(fs.rmSync).toHaveBeenCalledWith(expect.stringContaining('.claude/skills/test-skill'), {
      recursive: true,
      force: true,
    })
  })

  it('deletes package from manifest and writes updated manifest', async () => {
    vi.mocked(contextMod.getWorkingDirectory).mockReturnValue('/project')
    vi.mocked(storageMod.readManifest).mockReturnValue(
      createManifest({
        packages: { 'test-org/test-skill': createInstalledPackage() },
      })
    )
    vi.mocked(storageMod.readLockfile).mockReturnValue(createLockfile())
    vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue(null)

    await handler({ package: 'test-org/test-skill', global: false })

    expect(storageMod.writeManifest).toHaveBeenCalledWith(
      '/project',
      expect.objectContaining({
        packages: expect.not.objectContaining({
          'test-org/test-skill': expect.anything(),
        }),
      })
    )
  })

  it('deletes package from lockfile and writes updated lockfile', async () => {
    vi.mocked(contextMod.getWorkingDirectory).mockReturnValue('/project')
    vi.mocked(storageMod.readManifest).mockReturnValue(
      createManifest({
        packages: { 'test-org/test-skill': createInstalledPackage() },
      })
    )
    vi.mocked(storageMod.readLockfile).mockReturnValue(
      createLockfile({
        packages: {
          'test-org/test-skill': {
            version: '1.0.0',
            resolved: 'https://app.agentver.com/api/v1/skills/test-org/test-skill/1.0.0/download',
            integrity: 'sha256-abc',
            agents: ['claude-code'],
          },
        },
      })
    )
    vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue(null)

    await handler({ package: 'test-org/test-skill', global: false })

    expect(storageMod.writeLockfile).toHaveBeenCalledWith(
      '/project',
      expect.objectContaining({
        packages: expect.not.objectContaining({
          'test-org/test-skill': expect.anything(),
        }),
      })
    )
  })

  it('returns summary with removed package name and affected agents', async () => {
    vi.mocked(contextMod.getWorkingDirectory).mockReturnValue('/project')
    vi.mocked(storageMod.readManifest).mockReturnValue(
      createManifest({
        packages: { 'test-org/test-skill': createInstalledPackage() },
      })
    )
    vi.mocked(storageMod.readLockfile).mockReturnValue(createLockfile())
    vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/test-skill')
    vi.mocked(fs.existsSync).mockReturnValue(true)

    const result = (await handler({ package: 'test-org/test-skill', global: false })) as {
      content: Array<{ text: string }>
    }
    expect(result.content[0].text).toContain('Removed test-org/test-skill')
    expect(result.content[0].text).toContain('claude-code')
  })

  it('handles agents with no placement path', async () => {
    vi.mocked(contextMod.getWorkingDirectory).mockReturnValue('/project')
    vi.mocked(storageMod.readManifest).mockReturnValue(
      createManifest({
        packages: { 'test-org/test-skill': createInstalledPackage() },
      })
    )
    vi.mocked(storageMod.readLockfile).mockReturnValue(createLockfile())
    vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue(null)

    const result = (await handler({ package: 'test-org/test-skill', global: false })) as {
      content: Array<{ text: string }>
    }
    expect(result.content[0].text).toContain('No agent directories required cleanup')
  })

  it('handles directories that do not exist on disk', async () => {
    vi.mocked(contextMod.getWorkingDirectory).mockReturnValue('/project')
    vi.mocked(storageMod.readManifest).mockReturnValue(
      createManifest({
        packages: { 'test-org/test-skill': createInstalledPackage() },
      })
    )
    vi.mocked(storageMod.readLockfile).mockReturnValue(createLockfile())
    vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/test-skill')
    vi.mocked(fs.existsSync).mockReturnValue(false)

    const result = (await handler({ package: 'test-org/test-skill', global: false })) as {
      content: Array<{ text: string }>
    }
    expect(fs.rmSync).not.toHaveBeenCalled()
    expect(result.content[0].text).toContain('No agent directories required cleanup')
  })
})
