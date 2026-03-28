import { AgentverError } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInstalledPackage, createManifest } from '../helpers/fixtures'
import { createMockServer } from '../helpers/mock-server'

vi.mock('../../shared/context', () => ({
  getWorkingDirectory: vi.fn(),
}))

vi.mock('../../shared/registry', () => ({
  isAuthenticated: vi.fn(),
  registryFetch: vi.fn(),
}))

vi.mock('../../storage', () => ({
  readManifest: vi.fn(),
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

describe('tools/update', () => {
  let contextMod: typeof import('../../shared/context')
  let registryMod: typeof import('../../shared/registry')
  let storageMod: typeof import('../../storage')
  let handler: (...args: unknown[]) => unknown

  beforeEach(async () => {
    vi.clearAllMocks()
    contextMod = await import('../../shared/context')
    registryMod = await import('../../shared/registry')
    storageMod = await import('../../storage')
    const { registerUpdateTool } = await import('../../tools/update')
    const { server, getHandler } = createMockServer()
    registerUpdateTool(server)
    handler = getHandler('agentver_update')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws UNAUTHORISED when not authenticated', async () => {
    vi.mocked(registryMod.isAuthenticated).mockReturnValue(false)

    await expect(handler({ package: undefined })).rejects.toThrow(AgentverError)
    await expect(handler({ package: undefined })).rejects.toMatchObject({ code: 'UNAUTHORISED' })
  })

  it('returns "No packages installed" when manifest is empty', async () => {
    vi.mocked(registryMod.isAuthenticated).mockReturnValue(true)
    vi.mocked(contextMod.getWorkingDirectory).mockReturnValue('/project')
    vi.mocked(storageMod.readManifest).mockReturnValue(createManifest())

    const result = (await handler({ package: undefined })) as { content: Array<{ text: string }> }
    expect(result.content[0].text).toContain('No packages installed')
  })

  it('returns "Package not installed" when specified package not in manifest', async () => {
    vi.mocked(registryMod.isAuthenticated).mockReturnValue(true)
    vi.mocked(contextMod.getWorkingDirectory).mockReturnValue('/project')
    vi.mocked(storageMod.readManifest).mockReturnValue(createManifest())

    const result = (await handler({ package: 'org/nonexistent' })) as {
      content: Array<{ text: string }>
    }
    expect(result.content[0].text).toContain('not installed')
  })

  it('sends correct payload to check-updates endpoint', async () => {
    vi.mocked(registryMod.isAuthenticated).mockReturnValue(true)
    vi.mocked(contextMod.getWorkingDirectory).mockReturnValue('/project')
    vi.mocked(storageMod.readManifest).mockReturnValue(
      createManifest({
        packages: { 'test-org/test-skill': createInstalledPackage() },
      })
    )
    vi.mocked(registryMod.registryFetch).mockResolvedValue({ updates: [] })

    await handler({ package: undefined })

    expect(registryMod.registryFetch).toHaveBeenCalledWith('/skills/check-updates', {
      method: 'POST',
      body: {
        packages: [{ name: 'test-org/test-skill', version: '1.0.0' }],
      },
    })
  })

  it('returns "All packages are up to date" when no updates', async () => {
    vi.mocked(registryMod.isAuthenticated).mockReturnValue(true)
    vi.mocked(contextMod.getWorkingDirectory).mockReturnValue('/project')
    vi.mocked(storageMod.readManifest).mockReturnValue(
      createManifest({
        packages: { 'test-org/test-skill': createInstalledPackage() },
      })
    )
    vi.mocked(registryMod.registryFetch).mockResolvedValue({ updates: [] })

    const result = (await handler({ package: undefined })) as { content: Array<{ text: string }> }
    expect(result.content[0].text).toContain('All packages are up to date')
  })

  it('returns formatted update list when updates exist', async () => {
    vi.mocked(registryMod.isAuthenticated).mockReturnValue(true)
    vi.mocked(contextMod.getWorkingDirectory).mockReturnValue('/project')
    vi.mocked(storageMod.readManifest).mockReturnValue(
      createManifest({
        packages: { 'test-org/test-skill': createInstalledPackage() },
      })
    )
    vi.mocked(registryMod.registryFetch).mockResolvedValue({
      updates: [{ name: 'test-org/test-skill', current: '1.0.0', latest: '2.0.0' }],
    })

    const result = (await handler({ package: undefined })) as { content: Array<{ text: string }> }
    const text = result.content[0].text
    expect(text).toContain('test-org/test-skill')
    expect(text).toContain('1.0.0 -> 2.0.0')
  })

  it('checks single package when package specified', async () => {
    vi.mocked(registryMod.isAuthenticated).mockReturnValue(true)
    vi.mocked(contextMod.getWorkingDirectory).mockReturnValue('/project')
    vi.mocked(storageMod.readManifest).mockReturnValue(
      createManifest({
        packages: {
          'test-org/test-skill': createInstalledPackage(),
          'test-org/other-skill': createInstalledPackage({
            name: 'test-org/other-skill',
            version: '2.0.0',
          }),
        },
      })
    )
    vi.mocked(registryMod.registryFetch).mockResolvedValue({ updates: [] })

    await handler({ package: 'test-org/test-skill' })

    expect(registryMod.registryFetch).toHaveBeenCalledWith('/skills/check-updates', {
      method: 'POST',
      body: {
        packages: [{ name: 'test-org/test-skill', version: '1.0.0' }],
      },
    })
  })
})
