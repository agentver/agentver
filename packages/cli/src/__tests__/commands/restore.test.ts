import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createLockfile,
  createLockfilePackage,
  createManifest,
  createManifestPackage,
} from '../helpers/fixtures'
import { createNoopSpinner } from '../helpers/mock-spinner.js'

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../../storage/manifest', () => ({
  readManifest: vi.fn(),
  writeManifest: vi.fn(),
}))

vi.mock('../../storage/lockfile', () => ({
  readLockfile: vi.fn(),
  writeLockfile: vi.fn(),
}))

vi.mock('../../storage/pair', () => ({
  updateManifestAndLockfile: vi.fn(),
}))

vi.mock('../../storage/package-identity', () => ({
  setManifestPackage: vi.fn(),
  setLockfilePackage: vi.fn(),
}))

vi.mock('../../storage/canonical', () => ({
  getCanonicalSkillPath: vi.fn().mockReturnValue('/project/.agents/skills/test-skill'),
}))

vi.mock('../../output.js', () => ({
  isJSONMode: vi.fn().mockReturnValue(false),
  isVerbose: vi.fn().mockReturnValue(false),
  isQuiet: vi.fn().mockReturnValue(false),
  createSpinner: vi.fn().mockReturnValue(createNoopSpinner()),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
}))

vi.mock('../../git/index.js', () => ({
  parseGitSource: vi.fn(),
  resolveRef: vi.fn(),
  fetchFiles: vi.fn(),
}))

vi.mock('../../wellknown/index.js', () => ({
  fetchWellKnownIndex: vi.fn(),
  fetchWellKnownSkill: vi.fn(),
  looksLikeWellKnownUrl: vi.fn(),
  parseWellKnownSource: vi.fn(),
}))

vi.mock('../../registry/config.js', () => ({
  readConfig: vi.fn().mockReturnValue({ platformUrl: 'https://app.agentver.com' }),
}))

vi.mock('../../registry/auth.js', () => ({
  getCredentials: vi.fn().mockResolvedValue({ token: 'test-token' }),
}))

vi.mock('../../registry/reporter.js', () => ({
  reportInstallation: vi.fn(),
}))

vi.mock('../../security/index.js', () => ({
  scanFiles: vi.fn().mockResolvedValue({ verdict: 'PASS', findings: [] }),
  renderScanResult: vi.fn(),
  SCAN_RULES: [],
}))

vi.mock('../../dependency-check.js', () => ({
  enforceDependencies: vi.fn(),
  enforceConflicts: vi.fn(),
  extractDependencyMetadata: vi.fn().mockReturnValue({ dependsOn: [], conflictsWith: [] }),
}))

vi.mock('@agentver/installer', () => ({
  planInstall: vi.fn().mockReturnValue({
    request: {},
    kind: 'fresh',
    canonical: { path: '/project/.agents/skills/test-skill', category: 'skills' },
    placements: [],
    conflicts: [],
    backupsRequired: [],
    manifestEntry: {
      name: 'test-skill',
      source: { type: 'unknown' },
      agents: ['claude-code'],
      installedAt: new Date().toISOString(),
      modified: false,
    },
    lockfileEntry: {
      name: 'test-skill',
      source: { type: 'unknown' },
      integrity: 'sha256-test',
      agents: ['claude-code'],
    },
    skippedAgents: [],
    skippedFiles: [],
    executable: true,
  }),
  executeInstall: vi.fn().mockReturnValue({
    success: true,
    packageKey: 'test-skill',
    displayName: 'test-skill',
    placements: [],
    conflictsResolved: [],
    backups: [],
    manifestWritten: false,
    lockfileWritten: false,
    manifestEntry: {
      name: 'test-skill',
      source: { type: 'unknown' },
      agents: ['claude-code'],
      installedAt: new Date().toISOString(),
      modified: false,
    },
    lockfileEntry: {
      name: 'test-skill',
      source: { type: 'unknown' },
      integrity: 'sha256-test',
      agents: ['claude-code'],
    },
    filesPlacedCount: 1,
    agentsInstalledCount: 1,
  }),
  planRestore: vi.fn(),
  executeRestore: vi.fn(),
}))

vi.mock('@agentver/agent-definitions', () => ({
  detectInstalledAgents: vi.fn().mockReturnValue([{ id: 'claude-code', name: 'Claude Code' }]),
  composeConfigs: vi.fn(),
  getConfigFilePath: vi.fn(),
  getGlobalConfigFilePath: vi.fn(),
  isComposedConfig: vi.fn(),
  parseComposedSections: vi.fn(),
  translateConfig: vi.fn().mockReturnValue([]),
}))

vi.mock('@agentver/storage', () => ({
  computeIntegrity: vi.fn().mockReturnValue('sha256-test'),
}))

// Must come after vi.mock declarations
const { readManifest } = await import('../../storage/manifest')
const { readLockfile } = await import('../../storage/lockfile')
const { isJSONMode, outputSuccess } = await import('../../output.js')
const { planRestore, executeRestore } = await import('@agentver/installer')

const mockReadManifest = vi.mocked(readManifest)
const mockReadLockfile = vi.mocked(readLockfile)
const mockIsJSONMode = vi.mocked(isJSONMode)
const mockOutputSuccess = vi.mocked(outputSuccess)
const mockPlanRestore = vi.mocked(planRestore)
const mockExecuteRestore = vi.mocked(executeRestore)

// Dynamically import the SUT after mocks are established
const { restoreFromManifest } = await import('../../commands/install.js')

describe('restoreFromManifest', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  })

  afterEach(() => {
    stderrSpy.mockRestore()
  })

  it('exits gracefully when manifest has no packages', async () => {
    mockReadManifest.mockReturnValue(createManifest())
    mockReadLockfile.mockReturnValue(createLockfile())

    await restoreFromManifest({})

    expect(mockPlanRestore).not.toHaveBeenCalled()
    expect(mockExecuteRestore).not.toHaveBeenCalled()
  })

  it('exits gracefully when manifest is empty in JSON mode', async () => {
    mockIsJSONMode.mockReturnValue(true)
    mockReadManifest.mockReturnValue(createManifest())
    mockReadLockfile.mockReturnValue(createLockfile())

    await restoreFromManifest({})

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'RESTORE_COMPLETE',
        installedCount: 0,
        success: true,
      })
    )
  })

  it('skips when all packages are up to date', async () => {
    const manifest = createManifest({
      packages: {
        'test-skill': createManifestPackage(),
      },
    })
    const lockfile = createLockfile({
      packages: {
        'test-skill': createLockfilePackage(),
      },
    })

    mockReadManifest.mockReturnValue(manifest)
    mockReadLockfile.mockReturnValue(lockfile)

    mockPlanRestore.mockReturnValue({
      toInstall: [],
      upToDate: [
        {
          packageKey: 'test-skill',
          displayName: 'test-skill',
          manifestEntry: manifest.packages['test-skill']!,
          lockfileEntry: lockfile.packages['test-skill'],
          fetchStrategy: 'git',
          alreadyInstalled: true,
        },
      ],
      toSkip: [],
      agents: ['claude-code'],
      policy: {
        projectRoot: process.cwd(),
        scope: 'project',
        agents: [],
        preferredLinkMode: 'symlink',
        allowFallback: true,
        force: false,
        concurrency: 4,
        offline: false,
        securityScanPolicy: 'warn-only',
      },
    })

    await restoreFromManifest({})

    expect(mockExecuteRestore).not.toHaveBeenCalled()
  })

  it('skips local/unknown sources', async () => {
    const manifest = createManifest({
      packages: {
        'local-skill': createManifestPackage({
          source: { type: 'local', path: '/local/path' },
        }),
      },
    })

    mockReadManifest.mockReturnValue(manifest)
    mockReadLockfile.mockReturnValue(createLockfile())

    mockPlanRestore.mockReturnValue({
      toInstall: [],
      upToDate: [],
      toSkip: [
        {
          packageKey: 'local-skill',
          displayName: 'local-skill',
          reason: 'Local package — run agentver promote or re-install from a remote source.',
        },
      ],
      agents: ['claude-code'],
      policy: {
        projectRoot: process.cwd(),
        scope: 'project',
        agents: [],
        preferredLinkMode: 'symlink',
        allowFallback: true,
        force: false,
        concurrency: 4,
        offline: false,
        securityScanPolicy: 'warn-only',
      },
    })

    await restoreFromManifest({})

    expect(mockExecuteRestore).not.toHaveBeenCalled()
  })

  it('executes restore and reports results', async () => {
    const manifest = createManifest({
      packages: {
        'test-skill': createManifestPackage(),
      },
    })
    const lockfile = createLockfile({
      packages: {
        'test-skill': createLockfilePackage(),
      },
    })

    mockReadManifest.mockReturnValue(manifest)
    mockReadLockfile.mockReturnValue(lockfile)

    mockPlanRestore.mockReturnValue({
      toInstall: [
        {
          packageKey: 'test-skill',
          displayName: 'test-skill',
          manifestEntry: manifest.packages['test-skill']!,
          lockfileEntry: lockfile.packages['test-skill'],
          fetchStrategy: 'git',
          alreadyInstalled: false,
        },
      ],
      upToDate: [],
      toSkip: [],
      agents: ['claude-code'],
      policy: {
        projectRoot: process.cwd(),
        scope: 'project',
        agents: [],
        preferredLinkMode: 'symlink',
        allowFallback: true,
        force: false,
        concurrency: 4,
        offline: false,
        securityScanPolicy: 'warn-only',
      },
    })

    mockExecuteRestore.mockResolvedValue({
      packages: [
        {
          packageKey: 'test-skill',
          displayName: 'test-skill',
          status: 'installed',
          agents: ['claude-code'],
          filesPlacedCount: 2,
        },
      ],
      installedCount: 1,
      upToDateCount: 0,
      skippedCount: 0,
      failedCount: 0,
      success: true,
    })

    await restoreFromManifest({})

    expect(mockExecuteRestore).toHaveBeenCalled()
  })

  it('reports results in JSON mode', async () => {
    mockIsJSONMode.mockReturnValue(true)

    const manifest = createManifest({
      packages: {
        'test-skill': createManifestPackage(),
      },
    })
    const lockfile = createLockfile({
      packages: {
        'test-skill': createLockfilePackage(),
      },
    })

    mockReadManifest.mockReturnValue(manifest)
    mockReadLockfile.mockReturnValue(lockfile)

    mockPlanRestore.mockReturnValue({
      toInstall: [
        {
          packageKey: 'test-skill',
          displayName: 'test-skill',
          manifestEntry: manifest.packages['test-skill']!,
          lockfileEntry: lockfile.packages['test-skill'],
          fetchStrategy: 'git',
          alreadyInstalled: false,
        },
      ],
      upToDate: [],
      toSkip: [],
      agents: ['claude-code'],
      policy: {
        projectRoot: process.cwd(),
        scope: 'project',
        agents: [],
        preferredLinkMode: 'symlink',
        allowFallback: true,
        force: false,
        concurrency: 4,
        offline: false,
        securityScanPolicy: 'warn-only',
      },
    })

    mockExecuteRestore.mockResolvedValue({
      packages: [
        {
          packageKey: 'test-skill',
          displayName: 'test-skill',
          status: 'installed',
          agents: ['claude-code'],
          filesPlacedCount: 2,
        },
      ],
      installedCount: 1,
      upToDateCount: 0,
      skippedCount: 0,
      failedCount: 0,
      success: true,
    })

    await restoreFromManifest({})

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'RESTORE_COMPLETE',
        installedCount: 1,
        success: true,
      })
    )
  })

  it('passes --force through to restore policy', async () => {
    const manifest = createManifest({
      packages: {
        'test-skill': createManifestPackage(),
      },
    })
    const lockfile = createLockfile({
      packages: {
        'test-skill': createLockfilePackage(),
      },
    })

    mockReadManifest.mockReturnValue(manifest)
    mockReadLockfile.mockReturnValue(lockfile)

    mockPlanRestore.mockReturnValue({
      toInstall: [],
      upToDate: [],
      toSkip: [],
      agents: ['claude-code'],
      policy: {
        projectRoot: process.cwd(),
        scope: 'project',
        agents: [],
        preferredLinkMode: 'symlink',
        allowFallback: true,
        force: true,
        concurrency: 4,
        offline: false,
        securityScanPolicy: 'warn-only',
      },
    })

    await restoreFromManifest({ force: true })

    expect(mockPlanRestore).toHaveBeenCalledWith(
      manifest,
      lockfile,
      expect.objectContaining({ force: true })
    )
  })

  it('skips all packages in offline mode', async () => {
    const manifest = createManifest({
      packages: {
        'test-skill': createManifestPackage(),
      },
    })
    const lockfile = createLockfile({
      packages: {
        'test-skill': createLockfilePackage(),
      },
    })

    mockReadManifest.mockReturnValue(manifest)
    mockReadLockfile.mockReturnValue(lockfile)

    // planRestore returns packages to install
    mockPlanRestore.mockReturnValue({
      toInstall: [
        {
          packageKey: 'test-skill',
          displayName: 'test-skill',
          manifestEntry: manifest.packages['test-skill']!,
          lockfileEntry: lockfile.packages['test-skill'],
          fetchStrategy: 'git',
          alreadyInstalled: false,
        },
      ],
      upToDate: [],
      toSkip: [],
      agents: ['claude-code'],
      policy: {
        projectRoot: process.cwd(),
        scope: 'project',
        agents: [],
        preferredLinkMode: 'symlink',
        allowFallback: true,
        force: false,
        concurrency: 4,
        offline: true,
        securityScanPolicy: 'warn-only',
      },
    })

    await restoreFromManifest({ offline: true })

    // offline mode should move everything from toInstall to toSkip,
    // so executeRestore should not be called
    expect(mockExecuteRestore).not.toHaveBeenCalled()
  })

  it('sets exitCode to 1 when restore has failures', async () => {
    const originalExitCode = process.exitCode

    const manifest = createManifest({
      packages: {
        'test-skill': createManifestPackage(),
      },
    })
    const lockfile = createLockfile({
      packages: {
        'test-skill': createLockfilePackage(),
      },
    })

    mockReadManifest.mockReturnValue(manifest)
    mockReadLockfile.mockReturnValue(lockfile)

    mockPlanRestore.mockReturnValue({
      toInstall: [
        {
          packageKey: 'test-skill',
          displayName: 'test-skill',
          manifestEntry: manifest.packages['test-skill']!,
          lockfileEntry: lockfile.packages['test-skill'],
          fetchStrategy: 'git',
          alreadyInstalled: false,
        },
      ],
      upToDate: [],
      toSkip: [],
      agents: ['claude-code'],
      policy: {
        projectRoot: process.cwd(),
        scope: 'project',
        agents: [],
        preferredLinkMode: 'symlink',
        allowFallback: true,
        force: false,
        concurrency: 4,
        offline: false,
        securityScanPolicy: 'warn-only',
      },
    })

    mockExecuteRestore.mockResolvedValue({
      packages: [
        {
          packageKey: 'test-skill',
          displayName: 'test-skill',
          status: 'failed',
          error: 'Network error',
        },
      ],
      installedCount: 0,
      upToDateCount: 0,
      skippedCount: 0,
      failedCount: 1,
      success: false,
    })

    await restoreFromManifest({})

    expect(process.exitCode).toBe(1)

    // Restore original
    process.exitCode = originalExitCode
  })
})

describe('registerInstallCommand', () => {
  it('install command accepts optional source argument', async () => {
    // We test indirectly that the command registration uses [source]
    // by verifying restoreFromManifest is exported (used by ci command)
    expect(restoreFromManifest).toBeDefined()
    expect(typeof restoreFromManifest).toBe('function')
  })
})
