import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPackageKey } from '@agentver/shared'
import { computeIntegrity } from '@agentver/storage'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../../shared/registry', () => ({
  registryFetch: vi.fn(),
  isAuthenticated: vi.fn(),
  getCredentials: vi.fn(),
  getRegistryUrl: vi.fn(),
}))

vi.mock('../../shared/context', () => ({
  getWorkingDirectory: vi.fn(),
  logDebug: vi.fn(),
}))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import * as contextModule from '../../shared/context'
import * as registryModule from '../../shared/registry'
import { registerInstallTool } from '../../tools/install'

// ---------------------------------------------------------------------------
// McpServer stub
// ---------------------------------------------------------------------------

type ToolHandler = (
  args: Record<string, unknown>
) => Promise<{ content: Array<{ type: string; text: string }> }>

function createMockServer(): {
  server: { registerTool: ReturnType<typeof vi.fn> }
  getHandler: () => ToolHandler
} {
  const handlers = new Map<string, ToolHandler>()

  const server = {
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(name, handler)
    }),
  }

  return {
    server,
    getHandler: () => {
      const handler = handlers.get('agentver_install')
      if (!handler) throw new Error('Install tool was not registered')
      return handler
    },
  }
}

function makeDownloadResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    version: '1.0.0',
    content: null,
    fileManifest: [{ path: 'SKILL.md', content: '# My Skill' }],
    sha256: 'abc123hash',
    size: 100,
    gitRef: 'v1.0.0',
    gitCommitSha: 'commit123',
    gitUri: 'https://github.com/org/repo',
    gitPath: 'skills/my-skill',
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('install tool', () => {
  let tempDir: string
  let getWorkingDirectoryMock: Mock
  let isAuthenticatedMock: Mock
  let registryFetchMock: Mock

  beforeEach(() => {
    vi.clearAllMocks()
    tempDir = join(
      tmpdir(),
      `agentver-install-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    mkdirSync(tempDir, { recursive: true })
    getWorkingDirectoryMock = contextModule.getWorkingDirectory as unknown as Mock
    isAuthenticatedMock = registryModule.isAuthenticated as unknown as Mock
    registryFetchMock = registryModule.registryFetch as unknown as Mock
    getWorkingDirectoryMock.mockReturnValue(tempDir)
    isAuthenticatedMock.mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('registers the agentver_install tool on the server', () => {
    const { server } = createMockServer()
    registerInstallTool(server as never)
    expect(server.registerTool).toHaveBeenCalledWith(
      'agentver_install',
      expect.any(Object),
      expect.any(Function)
    )
  })

  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------

  it('throws UNAUTHORISED when not authenticated', async () => {
    isAuthenticatedMock.mockReturnValue(false)

    const { server, getHandler } = createMockServer()
    registerInstallTool(server as never)

    const handler = getHandler()
    await expect(handler({ package: 'org/skill' })).rejects.toThrow('Not authenticated')
  })

  // ---------------------------------------------------------------------------
  // Input validation
  // ---------------------------------------------------------------------------

  it('rejects invalid package names', async () => {
    const { server, getHandler } = createMockServer()
    registerInstallTool(server as never)

    const handler = getHandler()
    await expect(handler({ package: 'not-valid' })).rejects.toThrow('Invalid package name')
  })

  it('rejects package names with path traversal characters', async () => {
    const { server, getHandler } = createMockServer()
    registerInstallTool(server as never)

    const handler = getHandler()
    await expect(handler({ package: '../etc/passwd' })).rejects.toThrow('Invalid package name')
  })

  it('rejects package names with special characters', async () => {
    const { server, getHandler } = createMockServer()
    registerInstallTool(server as never)

    const handler = getHandler()
    await expect(handler({ package: 'org/sk!ll' })).rejects.toThrow('Invalid package name')
  })

  // ---------------------------------------------------------------------------
  // No agents detected
  // ---------------------------------------------------------------------------

  it('returns a message when no agents are detected and none specified', async () => {
    registryFetchMock
      .mockResolvedValueOnce({ versions: [{ version: '1.0.0', status: 'PUBLISHED' }] })
      .mockResolvedValueOnce(makeDownloadResponse())

    const { server, getHandler } = createMockServer()
    registerInstallTool(server as never)

    const handler = getHandler()
    const result = await handler({ package: 'org/skill' })

    expect(result.content[0]!.text).toContain('No AI agents detected')
  })

  // ---------------------------------------------------------------------------
  // Empty file manifest
  // ---------------------------------------------------------------------------

  it('returns a message when the file manifest is empty', async () => {
    registryFetchMock
      .mockResolvedValueOnce({ versions: [{ version: '1.0.0', status: 'PUBLISHED' }] })
      .mockResolvedValueOnce(makeDownloadResponse({ fileManifest: {} }))

    const { server, getHandler } = createMockServer()
    registerInstallTool(server as never)

    const handler = getHandler()
    const result = await handler({ package: 'org/skill' })

    expect(result.content[0]!.text).toContain('no files')
  })

  // ---------------------------------------------------------------------------
  // Validation error (missing git provenance)
  // ---------------------------------------------------------------------------

  it('throws when registry response is missing required git provenance fields', async () => {
    registryFetchMock
      .mockResolvedValueOnce({ versions: [{ version: '1.0.0', status: 'PUBLISHED' }] })
      .mockResolvedValueOnce(makeDownloadResponse({ gitUri: null }))

    const { server, getHandler } = createMockServer()
    registerInstallTool(server as never)

    const handler = getHandler()
    await expect(handler({ package: 'org/skill' })).rejects.toThrow('missing required fields')
  })

  // ---------------------------------------------------------------------------
  // Successful install with explicit agents
  // ---------------------------------------------------------------------------

  it('installs files to specified agents and updates manifest/lockfile', async () => {
    mkdirSync(join(tempDir, '.claude'), { recursive: true })

    registryFetchMock
      .mockResolvedValueOnce({ versions: [{ version: '1.0.0', status: 'PUBLISHED' }] })
      .mockResolvedValueOnce(makeDownloadResponse())

    const { server, getHandler } = createMockServer()
    registerInstallTool(server as never)

    const handler = getHandler()
    const result = await handler({
      package: 'org/my-skill',
      agents: ['claude-code'],
    })

    const text = result.content[0]!.text
    expect(text).toContain('Installed org/my-skill@1.0.0')
    expect(text).toContain('claude-code')
    expect(text).toContain('1 file(s) placed')

    // Verify manifest was written
    const manifestPath = join(tempDir, '.agentver', 'manifest.json')
    expect(existsSync(manifestPath)).toBe(true)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    const packageKey = createPackageKey('org/my-skill', {
      type: 'git',
      uri: 'https://github.com/org/repo',
      path: 'skills/my-skill',
      ref: 'v1.0.0',
      commit: 'abc1234def567890',
    })
    expect(manifest.packages[packageKey]).toBeDefined()
    expect(manifest.packages[packageKey].name).toBe('org/my-skill')
    expect(manifest.packages[packageKey].source.type).toBe('git')

    // Verify lockfile was written
    const lockfilePath = join(tempDir, '.agentver', 'lockfile.json')
    expect(existsSync(lockfilePath)).toBe(true)
    const lockfile = JSON.parse(readFileSync(lockfilePath, 'utf-8'))
    expect(lockfile.packages[packageKey]).toBeDefined()
    expect(lockfile.packages[packageKey].name).toBe('org/my-skill')
    const expectedIntegrity = computeIntegrity([{ path: 'SKILL.md', content: '# My Skill' }])
    expect(lockfile.packages[packageKey].integrity).toBe(expectedIntegrity)
  })

  // ---------------------------------------------------------------------------
  // Explicit version
  // ---------------------------------------------------------------------------

  it('uses the specified version instead of resolving latest', async () => {
    mkdirSync(join(tempDir, '.claude'), { recursive: true })

    registryFetchMock.mockResolvedValueOnce(makeDownloadResponse({ version: '2.0.0' }))

    const { server, getHandler } = createMockServer()
    registerInstallTool(server as never)

    const handler = getHandler()
    const result = await handler({
      package: 'org/skill',
      version: '2.0.0',
      agents: ['claude-code'],
    })

    expect(result.content[0]!.text).toContain('org/skill@2.0.0')

    // Should only call registryFetch once (download, not version resolution)
    expect(registryFetchMock).toHaveBeenCalledOnce()
  })

  // ---------------------------------------------------------------------------
  // Record-style fileManifest
  // ---------------------------------------------------------------------------

  it('handles record-style file manifests (key-value map)', async () => {
    mkdirSync(join(tempDir, '.claude'), { recursive: true })

    registryFetchMock
      .mockResolvedValueOnce({ versions: [{ version: '1.0.0', status: 'PUBLISHED' }] })
      .mockResolvedValueOnce(
        makeDownloadResponse({
          fileManifest: {
            'SKILL.md': '# My Skill',
            'config.yml': 'key: value',
          },
        })
      )

    const { server, getHandler } = createMockServer()
    registerInstallTool(server as never)

    const handler = getHandler()
    const result = await handler({
      package: 'org/skill',
      agents: ['claude-code'],
    })

    expect(result.content[0]!.text).toContain('2 file(s) placed')
  })

  // ---------------------------------------------------------------------------
  // Version resolution (latest, skipping yanked)
  // ---------------------------------------------------------------------------

  it('skips yanked versions when resolving latest', async () => {
    mkdirSync(join(tempDir, '.claude'), { recursive: true })

    registryFetchMock
      .mockResolvedValueOnce({
        versions: [
          { version: '2.0.0', status: 'YANKED' },
          { version: '1.0.0', status: 'PUBLISHED' },
        ],
      })
      .mockResolvedValueOnce(makeDownloadResponse({ version: '1.0.0' }))

    const { server, getHandler } = createMockServer()
    registerInstallTool(server as never)

    const handler = getHandler()
    const result = await handler({
      package: 'org/skill',
      agents: ['claude-code'],
    })

    expect(result.content[0]!.text).toContain('org/skill@1.0.0')
  })

  it('throws when all versions are yanked', async () => {
    registryFetchMock.mockResolvedValueOnce({
      versions: [{ version: '1.0.0', status: 'YANKED' }],
    })

    const { server, getHandler } = createMockServer()
    registerInstallTool(server as never)

    const handler = getHandler()
    await expect(handler({ package: 'org/skill' })).rejects.toThrow('No published versions')
  })
})
