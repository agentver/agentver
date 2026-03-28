import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInstalledPackage, createManifest } from '../helpers/fixtures'
import { createMockServer } from '../helpers/mock-server'

vi.mock('../../shared/context', () => ({
  getWorkingDirectory: vi.fn(),
}))

vi.mock('../../storage', () => ({
  readManifest: vi.fn(),
}))

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/test'),
}))

describe('tools/list', () => {
  let contextMod: typeof import('../../shared/context')
  let storageMod: typeof import('../../storage')
  let handler: (...args: unknown[]) => unknown

  beforeEach(async () => {
    vi.clearAllMocks()
    contextMod = await import('../../shared/context')
    storageMod = await import('../../storage')
    const { registerListTool } = await import('../../tools/list')
    const { server, getHandler } = createMockServer()
    registerListTool(server)
    handler = getHandler('agentver_list')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists packages with name, version, and agents', async () => {
    vi.mocked(contextMod.getWorkingDirectory).mockReturnValue('/project')
    vi.mocked(storageMod.readManifest).mockReturnValue(
      createManifest({
        packages: {
          'test-org/test-skill': createInstalledPackage(),
        },
      })
    )

    const result = (await handler({ global: false })) as { content: Array<{ text: string }> }
    const text = result.content[0]!.text

    expect(text).toContain('test-org/test-skill@1.0.0')
    expect(text).toContain('claude-code')
  })

  it('returns "No packages installed" when manifest empty', async () => {
    vi.mocked(contextMod.getWorkingDirectory).mockReturnValue('/project')
    vi.mocked(storageMod.readManifest).mockReturnValue(createManifest())

    const result = (await handler({ global: false })) as { content: Array<{ text: string }> }
    expect(result.content[0]!.text).toContain('No packages installed')
  })

  it('uses project root from getWorkingDirectory for project scope', async () => {
    vi.mocked(contextMod.getWorkingDirectory).mockReturnValue('/my/project')
    vi.mocked(storageMod.readManifest).mockReturnValue(createManifest())

    await handler({ global: false })
    expect(storageMod.readManifest).toHaveBeenCalledWith('/my/project')
  })

  it('uses ~/.agentver for global scope', async () => {
    vi.mocked(storageMod.readManifest).mockReturnValue(createManifest())

    await handler({ global: true })
    expect(storageMod.readManifest).toHaveBeenCalledWith('/home/test/.agentver')
  })

  it('shows correct scope label', async () => {
    vi.mocked(contextMod.getWorkingDirectory).mockReturnValue('/project')
    vi.mocked(storageMod.readManifest).mockReturnValue(
      createManifest({
        packages: { 'test-org/test-skill': createInstalledPackage() },
      })
    )

    const projectResult = (await handler({ global: false })) as { content: Array<{ text: string }> }
    expect(projectResult.content[0]!.text).toContain('Project')

    const globalResult = (await handler({ global: true })) as { content: Array<{ text: string }> }
    expect(globalResult.content[0]!.text).toContain('Global')
  })
})
