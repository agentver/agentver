import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createLockfile,
  createLockfilePackage,
  createManifest,
  createManifestPackage,
  createSharedGitSource,
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
  createBackup: vi.fn(),
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

describe('commands/update retry flow', () => {
  const originalCwd = process.cwd
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    process.cwd = vi.fn().mockReturnValue('/project')
    vi.mocked(outputModule.createSpinner).mockReturnValue(
      createNoopSpinner() as unknown as ReturnType<typeof outputModule.createSpinner>
    )
    vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(authModule.getCredentials).mockResolvedValue({ token: 'test-token' })
    vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue('sha256-updated')

    const source = createSharedGitSource({
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
    globalThis.fetch = originalFetch
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('retries a transient platform failure and completes the update', async () => {
    let attempts = 0
    globalThis.fetch = vi.fn(async () => {
      attempts += 1

      if (attempts === 1) {
        return {
          ok: false,
          status: 500,
          text: () => Promise.resolve('temporary outage'),
        } as Response
      }

      return {
        ok: true,
        json: () =>
          Promise.resolve({
            source: 'platform',
            gitUri: 'agentver://test-org',
            gitPath: 'skills/test-skill',
            gitRef: 'main',
            files: [{ path: 'SKILL.md', content: 'updated content' }],
          }),
      } as Response
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
})
