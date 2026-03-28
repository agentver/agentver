import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockServer } from '../helpers/mock-server'

vi.mock('../../shared/registry', () => ({
  registryFetch: vi.fn(),
}))

describe('tools/info', () => {
  let registryMod: typeof import('../../shared/registry')
  let handler: (...args: unknown[]) => unknown

  beforeEach(async () => {
    vi.clearAllMocks()
    registryMod = await import('../../shared/registry')
    const { registerInfoTool } = await import('../../tools/info')
    const { server, getHandler } = createMockServer()
    registerInfoTool(server)
    handler = getHandler('agentver_info')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function createPackageInfoResponse(overrides?: Record<string, unknown>) {
    return {
      id: 'pkg-1',
      name: 'test-skill',
      slug: 'test-skill',
      description: 'A great skill',
      type: 'SKILL',
      visibility: 'PUBLIC',
      tags: ['typescript', 'testing'],
      readme: '# README',
      organisation: { slug: 'test-org', name: 'Test Org' },
      author: { name: 'Jane Doe', image: null },
      versions: [
        { version: '1.0.0', changelog: null, createdAt: '2024-01-01T00:00:00.000Z', sha256: null },
      ],
      _count: { installationReports: 150, forks: 3 },
      ...overrides,
    }
  }

  it('returns formatted package info for valid package name', async () => {
    vi.mocked(registryMod.registryFetch).mockResolvedValue(createPackageInfoResponse())

    const result = (await handler({ package: 'test-org/test-skill' })) as {
      content: Array<{ text: string }>
    }
    const text = result.content[0].text

    expect(text).toContain('test-org/test-skill')
    expect(text).toContain('Type: SKILL')
    expect(text).toContain('Latest: 1.0.0')
    expect(text).toContain('Jane Doe')
    expect(text).toContain('Downloads: 150')
    expect(text).toContain('Forks: 3')
    expect(text).toContain('PUBLIC')
    expect(text).toContain('typescript, testing')
  })

  it('returns error message for invalid package name', async () => {
    const result = (await handler({ package: 'invalid-name' })) as {
      content: Array<{ text: string }>
    }
    expect(result.content[0].text).toContain('Invalid package name')
  })

  it('encodes org and name in URL', async () => {
    vi.mocked(registryMod.registryFetch).mockResolvedValue(createPackageInfoResponse())

    await handler({ package: 'my-org/my-skill' })

    expect(registryMod.registryFetch).toHaveBeenCalledWith('/skills/my-org/my-skill')
  })

  it('displays all fields including tags', async () => {
    vi.mocked(registryMod.registryFetch).mockResolvedValue(createPackageInfoResponse())

    const result = (await handler({ package: 'test-org/test-skill' })) as {
      content: Array<{ text: string }>
    }
    const text = result.content[0].text

    expect(text).toContain('Visibility: PUBLIC')
    expect(text).toContain('Tags: typescript, testing')
  })

  it('handles package with no versions', async () => {
    vi.mocked(registryMod.registryFetch).mockResolvedValue(
      createPackageInfoResponse({ versions: [] })
    )

    const result = (await handler({ package: 'test-org/test-skill' })) as {
      content: Array<{ text: string }>
    }
    expect(result.content[0].text).toContain('Latest: none')
    expect(result.content[0].text).toContain('(none)')
  })

  it('handles null description and null author', async () => {
    vi.mocked(registryMod.registryFetch).mockResolvedValue(
      createPackageInfoResponse({ description: null, author: null })
    )

    const result = (await handler({ package: 'test-org/test-skill' })) as {
      content: Array<{ text: string }>
    }
    const text = result.content[0].text
    expect(text).toContain('No description')
    expect(text).toContain('Author: Test Org')
  })
})
