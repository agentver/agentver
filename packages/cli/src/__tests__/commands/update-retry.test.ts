import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createLockfile,
  createLockfilePackage,
  createManifest,
  createManifestPackage,
  createPlatformSource,
} from '../helpers/fixtures'
import { createNoopSpinner } from '../helpers/mock-spinner.js'

vi.mock('../../git/index.js', () => ({
  parseGitSource: vi.fn(),
  resolveRef: vi.fn(),
  fetchFiles: vi.fn(),
}))

vi.mock('../../git/fetcher.js', () => ({
  readFilesFromDirectory: vi.fn(),
}))

vi.mock('../../storage/manifest', () => ({
  readManifest: vi.fn(),
}))

vi.mock('../../storage/lockfile', () => ({
  readLockfile: vi.fn(),
}))

vi.mock('../../storage/canonical.js', () => ({
  getCanonicalSkillPath: vi.fn(),
  createAgentSymlinks: vi.fn(),
  isSymlinkedInstall: vi.fn(),
  removeAgentSymlinks: vi.fn(),
  removeCanonicalDirectory: vi.fn(),
  resolveReadPath: vi.fn(),
}))

vi.mock('../../storage/integrity', async () => {
  const actual =
    await vi.importActual<typeof import('../../storage/integrity')>('../../storage/integrity')
  return {
    ...actual,
    computeSha256FromFiles: vi.fn(),
    deriveCommitFromIntegrity: vi.fn((integrity: string) => `derived-${integrity}`),
  }
})

vi.mock('../../storage/patches.js', () => ({
  generatePatch: vi.fn(),
  savePatch: vi.fn(),
  applyPatch: vi.fn(),
  removePatch: vi.fn(),
}))

vi.mock('../../utils/backup', () => ({
  createBackup: vi.fn().mockReturnValue({
    packageName: 'test-skill',
    tempDir: '/tmp/agentver-backup',
    targets: [],
  }),
  restoreBackup: vi.fn(),
  cleanupBackup: vi.fn(),
}))

vi.mock('../../commands/install', () => ({
  installPackage: vi.fn(),
}))

vi.mock('../../registry/auth.js', () => ({
  getCredentials: vi.fn(),
  isAuthenticated: vi.fn(),
}))

vi.mock('../../registry/config.js', () => ({
  readConfig: vi.fn(),
  getPlatformUrl: vi.fn(),
}))

vi.mock('../../registry/reporter.js', () => ({
  reportInstallation: vi.fn(),
  reportRemoval: vi.fn(),
}))

vi.mock('../../security/index.js', () => ({
  scanFiles: vi.fn(),
  renderScanResult: vi.fn(),
}))

vi.mock('../../wellknown/index.js', () => ({
  fetchWellKnownIndex: vi.fn(),
  fetchWellKnownSkill: vi.fn(),
}))

vi.mock('../../output.js', () => ({
  isJSONMode: vi.fn().mockReturnValue(false),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
  createSpinner: vi.fn(),
}))

vi.mock('@agentver/agent-definitions', () => ({
  getSkillPlacementPath: vi.fn(),
  getAgentPlacementPath: vi.fn(),
  getCommandPlacementPath: vi.fn(),
  detectInstalledAgents: vi.fn(),
  getConfigFilePath: vi.fn(),
}))

vi.mock('prompts', () => ({
  default: vi.fn().mockResolvedValue({ confirmed: true }),
}))

import { installPackage } from '../../commands/install'
import { registerUpdateCommand } from '../../commands/update'
import * as outputModule from '../../output.js'
import * as authModule from '../../registry/auth.js'
import * as configModule from '../../registry/config.js'
import * as integrityModule from '../../storage/integrity'
import * as lockfileModule from '../../storage/lockfile'
import * as manifestModule from '../../storage/manifest'
import * as backupModule from '../../utils/backup'

type UpdateAction = (
  name: string | undefined,
  options: { dryRun?: boolean; global?: boolean; yes?: boolean }
) => Promise<void>

function getUpdateAction(): UpdateAction {
  const mockProgram = {
    command: vi.fn().mockReturnThis(),
    description: vi.fn().mockReturnThis(),
    option: vi.fn().mockReturnThis(),
    action: vi.fn().mockReturnThis(),
  }

  registerUpdateCommand(mockProgram as never)

  return mockProgram.action.mock.calls[0]![0] as UpdateAction
}

// ---------------------------------------------------------------------------
// Helpers for building fetch responses
// ---------------------------------------------------------------------------

function platformResolveResponse(overrides?: Record<string, unknown>) {
  return {
    source: 'platform',
    gitUri: 'agentver://test-org',
    gitPath: 'skills/test-skill',
    gitRef: 'main',
    files: [{ path: 'SKILL.md', content: 'updated content' }],
    ...overrides,
  }
}

function serverErrorResponse(text = 'temporary outage'): Response {
  return {
    ok: false,
    status: 500,
    text: () => Promise.resolve(text),
  } as Response
}

function clientErrorResponse(status = 404, text = 'not found'): Response {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(text),
  } as Response
}

function successResponse(body?: Record<string, unknown>): Response {
  return {
    ok: true,
    json: () => Promise.resolve(body ?? platformResolveResponse()),
  } as Response
}

describe('commands/update retry flow', () => {
  const originalCwd = process.cwd
  const originalFetch = globalThis.fetch
  const originalExit = process.exit

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    process.cwd = vi.fn().mockReturnValue('/project')
    process.exit = vi.fn() as never
    vi.mocked(outputModule.createSpinner).mockReturnValue(
      createNoopSpinner() as unknown as ReturnType<typeof outputModule.createSpinner>
    )
    vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(authModule.getCredentials).mockResolvedValue({ token: 'test-token' })
    vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue('sha256-updated')

    const source = createPlatformSource({
      uri: 'agentver://test-org',
      path: 'skills/test-skill',
      ref: 'main',
      commit: 'old1234567890abcdef1234567890abcdef1234567',
    })

    vi.mocked(manifestModule.readManifest).mockReturnValue(
      createManifest({
        packages: {
          'test-skill': createManifestPackage({
            source,
            agents: ['claude-code'],
          }),
        },
      })
    )
    vi.mocked(lockfileModule.readLockfile).mockReturnValue(
      createLockfile({
        packages: {
          'test-skill': createLockfilePackage({
            source,
            agents: ['claude-code'],
          }),
        },
      })
    )
    vi.mocked(installPackage).mockResolvedValue({
      name: 'test-skill',
      ref: 'main',
      commitSha: 'new1234567890abcdef1234567890abcdef1234567',
      agents: ['claude-code'],
    })
  })

  afterEach(() => {
    process.cwd = originalCwd
    process.exit = originalExit
    globalThis.fetch = originalFetch
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('retries a transient platform failure and completes the update', async () => {
    let attempts = 0
    globalThis.fetch = vi.fn(async () => {
      attempts += 1

      if (attempts === 1) {
        return serverErrorResponse()
      }

      return successResponse()
    })

    const updateAction = getUpdateAction()
    const updatePromise = updateAction(undefined, {})

    await vi.advanceTimersByTimeAsync(1_000)
    await updatePromise

    expect(attempts).toBe(2)
    expect(installPackage).toHaveBeenCalledWith(
      'agentver://test-org/skills/test-skill@main',
      expect.objectContaining({ agent: ['claude-code'] })
    )
  })

  it('succeeds on the second attempt after a transient 500 error', async () => {
    let attempts = 0
    globalThis.fetch = vi.fn(async () => {
      attempts += 1

      if (attempts === 1) {
        return serverErrorResponse('internal server error')
      }

      return successResponse()
    })

    const updateAction = getUpdateAction()
    const updatePromise = updateAction(undefined, {})

    await vi.advanceTimersByTimeAsync(1_000)
    await updatePromise

    expect(attempts).toBe(2)
    expect(installPackage).toHaveBeenCalledTimes(1)
  })

  it('exhausts all retries and propagates the final error', async () => {
    globalThis.fetch = vi.fn(async () => serverErrorResponse('persistent failure'))

    const updateAction = getUpdateAction()
    const updatePromise = updateAction(undefined, {})

    // Advance through all retry delays (1s, 2s for 3 attempts total)
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(2_000)
    await updatePromise

    // installPackage should never be called because resolution itself fails
    expect(installPackage).not.toHaveBeenCalled()
    // The update should still complete (not crash), but the package is skipped
    expect(globalThis.fetch).toHaveBeenCalled()
  })

  it('treats 4xx client errors as resolution failures without installing', async () => {
    let attempts = 0
    globalThis.fetch = vi.fn(async () => {
      attempts += 1
      return clientErrorResponse(404, 'not found')
    })

    const updateAction = getUpdateAction()
    const updatePromise = updateAction(undefined, {})

    // Advance through all retry delays (1s + 2s)
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(2_000)
    await updatePromise

    // Resolution fails — installPackage should never be called
    expect(installPackage).not.toHaveBeenCalled()
    expect(attempts).toBeGreaterThanOrEqual(1)
  })

  it('treats 403 forbidden as a resolution failure', async () => {
    let attempts = 0
    globalThis.fetch = vi.fn(async () => {
      attempts += 1
      return clientErrorResponse(403, 'forbidden')
    })

    const updateAction = getUpdateAction()
    const updatePromise = updateAction(undefined, {})

    // Advance through all retry delays
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(2_000)
    await updatePromise

    expect(installPackage).not.toHaveBeenCalled()
    expect(attempts).toBeGreaterThanOrEqual(1)
  })

  it('handles mixed outcomes — one package succeeds, another fails', async () => {
    const sourceA = createPlatformSource({
      uri: 'agentver://test-org',
      path: 'skills/skill-a',
      ref: 'main',
      commit: 'oldA234567890abcdef1234567890abcdef1234567',
    })
    const sourceB = createPlatformSource({
      uri: 'agentver://test-org',
      path: 'skills/skill-b',
      ref: 'main',
      commit: 'oldB234567890abcdef1234567890abcdef1234567',
    })

    vi.mocked(manifestModule.readManifest).mockReturnValue(
      createManifest({
        packages: {
          'skill-a': createManifestPackage({ source: sourceA, agents: ['claude-code'] }),
          'skill-b': createManifestPackage({ source: sourceB, agents: ['claude-code'] }),
        },
      })
    )
    vi.mocked(lockfileModule.readLockfile).mockReturnValue(
      createLockfile({
        packages: {
          'skill-a': createLockfilePackage({ source: sourceA, agents: ['claude-code'] }),
          'skill-b': createLockfilePackage({ source: sourceB, agents: ['claude-code'] }),
        },
      })
    )

    // skill-a resolves fine, skill-b fails
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()

      if (urlStr.includes('skill-a')) {
        return successResponse(
          platformResolveResponse({
            gitPath: 'skills/skill-a',
            files: [{ path: 'SKILL.md', content: 'skill-a content' }],
          })
        )
      }

      // skill-b always fails
      return clientErrorResponse(404, 'skill not found')
    })

    // installPackage succeeds for skill-a
    vi.mocked(installPackage).mockResolvedValue({
      name: 'skill-a',
      ref: 'main',
      commitSha: 'newA234567890abcdef1234567890abcdef1234567',
      agents: ['claude-code'],
    })

    const updateAction = getUpdateAction()
    const updatePromise = updateAction(undefined, {})

    // Advance through retry delays for the failing package
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(2_000)
    await updatePromise

    // skill-a should have been installed
    // skill-b should have been skipped due to resolution failure
    const installCalls = vi.mocked(installPackage).mock.calls
    const installedSources = installCalls.map((call) => call[0])
    expect(installedSources.some((s) => s.includes('skill-a'))).toBe(true)
  })

  it('restores backup when installPackage throws after all retries', async () => {
    // Resolution succeeds but installPackage fails
    globalThis.fetch = vi.fn(async () => successResponse())

    vi.mocked(installPackage).mockRejectedValue(new Error('disk write failed'))

    const updateAction = getUpdateAction()
    const updatePromise = updateAction(undefined, {})

    await vi.advanceTimersByTimeAsync(100)
    await updatePromise

    // Backup should have been created and then restored on failure
    expect(backupModule.createBackup).toHaveBeenCalled()
    expect(backupModule.restoreBackup).toHaveBeenCalled()
    expect(backupModule.cleanupBackup).toHaveBeenCalled()
  })
})
