import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import {
  createAuditScanResult,
  createLockfile,
  createLockfilePackage,
  createManifest,
  createManifestPackage,
  createSkillMd,
} from '../helpers/fixtures'
import { createNoopSpinner } from '../helpers/mock-spinner.js'

// ---------------------------------------------------------------------------
// Module-level mocks — must be declared before any imports that reference them
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}))

vi.mock('../../git/fetcher.js', () => ({
  readFilesFromDirectory: vi.fn(),
}))

vi.mock('../../git/local-context.js', () => ({
  resolveLocalGitContext: vi.fn(),
  createGitRepoCache: vi.fn().mockReturnValue({
    roots: new Map(),
    repos: new Map(),
  }),
}))

vi.mock('../../registry/platform.js', () => ({
  platformFetch: vi.fn(),
}))

vi.mock('../../security/index.js', () => ({
  scanFiles: vi.fn(),
}))

vi.mock('../../storage/manifest.js', () => ({
  readManifest: vi.fn(),
}))

vi.mock('../../storage/lockfile.js', () => ({
  readLockfile: vi.fn(),
}))

vi.mock('../../storage/pair.js', () => ({
  updateManifestAndLockfile: vi.fn(),
}))

vi.mock('../../storage/integrity.js', () => ({
  computeSha256FromFiles: vi.fn().mockReturnValue('sha256-test-hash'),
}))

vi.mock('@agentver/installer', () => ({
  planInstall: vi.fn().mockReturnValue({
    request: {},
    kind: 'fresh',
    canonical: { path: '/project/.agents/skills/test-skill', category: 'skills' },
    placements: [],
    conflicts: [],
    backupsRequired: [],
    manifestEntry: {},
    lockfileEntry: {},
    skippedAgents: [],
    skippedFiles: [],
    executable: true,
  }),
  executeInstall: vi.fn().mockReturnValue({
    success: true,
    packageKey: 'test-key',
    displayName: 'test-skill',
    placements: [],
    conflictsResolved: [],
    backups: [],
    manifestWritten: false,
    lockfileWritten: false,
    manifestEntry: {},
    lockfileEntry: {},
    filesPlacedCount: 1,
    agentsInstalledCount: 1,
  }),
}))

vi.mock('@agentver/agent-definitions', () => ({
  detectInstalledAgents: vi.fn().mockReturnValue([{ id: 'claude-code' }]),
}))

vi.mock('chalk', () => {
  const identity = (s: string) => s
  const fn = Object.assign(identity, {
    red: identity,
    green: identity,
    cyan: identity,
    yellow: identity,
    dim: identity,
    bold: identity,
  })
  return { default: fn }
})

vi.mock('../../output.js', () => ({
  isJSONMode: vi.fn().mockReturnValue(false),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
  createSpinner: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs'
import type { LocalSource, UnknownSource } from '@agentver/shared'
import { promoteSkills } from '../../commands/promote.js'
import { readFilesFromDirectory } from '../../git/fetcher.js'
import type { LocalGitContext } from '../../git/local-context.js'
import * as localContextModule from '../../git/local-context.js'
import * as outputModule from '../../output.js'
import { platformFetch } from '../../registry/platform.js'
import { scanFiles } from '../../security/index.js'
import { readLockfile } from '../../storage/lockfile.js'
import { readManifest } from '../../storage/manifest.js'
import { updateManifestAndLockfile } from '../../storage/pair.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asMock(value: unknown): Mock {
  return value as Mock
}

function createMockGitContext(overrides?: Partial<LocalGitContext>): LocalGitContext {
  return {
    gitRoot: '/project',
    remoteUri: 'github.com/test-org/test-repo',
    remoteName: 'origin',
    ref: 'main',
    commit: 'abc1234567890abcdef1234567890abcdef12345678',
    relativePath: 'skills/test-skill',
    dirty: false,
    isSubmodule: false,
    ...overrides,
  }
}

const LOCAL_SOURCE: LocalSource = {
  type: 'local',
  path: '/project/skills/test-skill',
}

const UNKNOWN_SOURCE: UnknownSource = {
  type: 'unknown',
  path: '/project/skills/test-skill',
}

const VALID_SKILL_MD = createSkillMd({
  name: 'test-skill',
  description: 'A test skill',
  version: '1.0.0',
})

function captureOutput(): { stdout: string[]; stderr: string[] } {
  const stdout: string[] = []
  const stderr: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk))
    return true
  })
  return { stdout, stderr }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('commands/promote', () => {
  const originalCwd = process.cwd
  const originalExit = process.exit

  beforeEach(() => {
    vi.clearAllMocks()
    process.cwd = vi.fn().mockReturnValue('/project')
    process.exit = vi.fn() as never
    process.argv = ['node', 'agentver', 'promote']

    asMock(outputModule.createSpinner).mockReturnValue(
      createNoopSpinner() as unknown as ReturnType<typeof outputModule.createSpinner>
    )
    asMock(outputModule.isJSONMode).mockReturnValue(false)
    asMock(readManifest).mockReturnValue(createManifest())
    asMock(readLockfile).mockReturnValue(createLockfile())
    asMock(updateManifestAndLockfile).mockImplementation((_projectRoot, _scope, updater) =>
      updater({ version: 2 as const, packages: {} }, { version: 2 as const, packages: {} })
    )
  })

  afterEach(() => {
    process.cwd = originalCwd
    process.exit = originalExit
  })

  // -------------------------------------------------------------------------
  // 1. Promote local package to git
  // -------------------------------------------------------------------------

  describe('--to git', () => {
    it('promotes a local package to git source and updates manifest', async () => {
      const manifestPackage = createManifestPackage({
        source: LOCAL_SOURCE,
      })
      Object.assign(manifestPackage, { name: 'test-skill' })

      asMock(readManifest).mockReturnValue(
        createManifest({
          packages: {
            'local:/project/skills/test-skill': manifestPackage,
          },
        })
      )
      asMock(readLockfile).mockReturnValue(
        createLockfile({
          packages: {
            'local:/project/skills/test-skill': createLockfilePackage({
              source: LOCAL_SOURCE,
            }),
          },
        })
      )
      asMock(localContextModule.resolveLocalGitContext).mockResolvedValue(createMockGitContext())

      const manifestCapture = { packages: {} as Record<string, unknown> }
      asMock(updateManifestAndLockfile).mockImplementation((_root, _scope, updater) => {
        const manifest = {
          version: 2 as const,
          packages: {
            'local:/project/skills/test-skill': { ...manifestPackage },
          },
        }
        const lockfile = {
          version: 2 as const,
          packages: {
            'local:/project/skills/test-skill': {
              source: LOCAL_SOURCE,
              integrity: 'sha256-original',
              agents: ['claude-code'],
            },
          },
        }
        const result = updater(manifest, lockfile)
        manifestCapture.packages = result.manifest.packages
        return result
      })

      captureOutput()
      await promoteSkills('test-skill', { to: 'git' })

      expect(localContextModule.resolveLocalGitContext).toHaveBeenCalledWith(
        '/project/skills/test-skill',
        expect.anything()
      )
      expect(updateManifestAndLockfile).toHaveBeenCalled()

      // Verify source was updated to git
      const packageKeys = Object.keys(manifestCapture.packages)
      expect(packageKeys.length).toBe(1)
      const newPkg = Object.values(manifestCapture.packages)[0] as {
        source: { type: string; uri: string; ref: string }
      }
      expect(newPkg.source.type).toBe('git')
      expect(newPkg.source.uri).toBe('github.com/test-org/test-repo')
      expect(newPkg.source.ref).toBe('main')
    })

    it('errors when package is not in a git repo', async () => {
      asMock(readManifest).mockReturnValue(
        createManifest({
          packages: {
            'local:/project/skills/test-skill': Object.assign(
              createManifestPackage({ source: LOCAL_SOURCE }),
              { name: 'test-skill' }
            ),
          },
        })
      )
      asMock(localContextModule.resolveLocalGitContext).mockResolvedValue(null)

      captureOutput()
      await promoteSkills('test-skill', { to: 'git' })

      const spinner = asMock(outputModule.createSpinner).mock.results[0]?.value
      expect(spinner?.fail).toHaveBeenCalledWith(
        expect.stringContaining('not inside a git repository')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('errors when git repo has no remote', async () => {
      asMock(readManifest).mockReturnValue(
        createManifest({
          packages: {
            'local:/project/skills/test-skill': Object.assign(
              createManifestPackage({ source: LOCAL_SOURCE }),
              { name: 'test-skill' }
            ),
          },
        })
      )
      asMock(localContextModule.resolveLocalGitContext).mockResolvedValue(
        createMockGitContext({ remoteUri: null, remoteName: null })
      )

      captureOutput()
      await promoteSkills('test-skill', { to: 'git' })

      const spinner = asMock(outputModule.createSpinner).mock.results[0]?.value
      expect(spinner?.fail).toHaveBeenCalledWith(expect.stringContaining('no remote configured'))
      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('warns when working tree is dirty', async () => {
      asMock(readManifest).mockReturnValue(
        createManifest({
          packages: {
            'local:/project/skills/test-skill': Object.assign(
              createManifestPackage({ source: LOCAL_SOURCE }),
              { name: 'test-skill' }
            ),
          },
        })
      )
      asMock(localContextModule.resolveLocalGitContext).mockResolvedValue(
        createMockGitContext({ dirty: true })
      )

      const { stdout } = captureOutput()
      await promoteSkills('test-skill', { to: 'git' })

      const combinedOutput = stdout.join('')
      expect(combinedOutput).toContain('dirty')
    })

    it('uses global scope when --global is passed', async () => {
      const manifestPackage = createManifestPackage({
        source: LOCAL_SOURCE,
      })
      Object.assign(manifestPackage, { name: 'test-skill' })

      asMock(readManifest).mockReturnValue(
        createManifest({
          packages: {
            'local:/project/skills/test-skill': manifestPackage,
          },
        })
      )
      asMock(localContextModule.resolveLocalGitContext).mockResolvedValue(createMockGitContext())

      captureOutput()
      await promoteSkills('test-skill', { to: 'git', global: true })

      expect(readManifest).toHaveBeenCalledWith('/project', 'global')
      expect(updateManifestAndLockfile).toHaveBeenCalledWith(
        '/project',
        'global',
        expect.any(Function)
      )
    })
  })

  // -------------------------------------------------------------------------
  // 2. Promote local package to platform
  // -------------------------------------------------------------------------

  describe('--to platform', () => {
    it('promotes to platform using publish flow', async () => {
      asMock(readManifest).mockReturnValue(
        createManifest({
          packages: {
            'local:/project/skills/test-skill': Object.assign(
              createManifestPackage({ source: LOCAL_SOURCE }),
              { name: 'test-skill' }
            ),
          },
        })
      )
      asMock(existsSync).mockReturnValue(true)
      asMock(readFileSync).mockReturnValue(VALID_SKILL_MD)
      asMock(readFilesFromDirectory).mockResolvedValue([
        { path: 'SKILL.md', content: VALID_SKILL_MD, size: VALID_SKILL_MD.length },
      ])
      asMock(scanFiles).mockResolvedValue(createAuditScanResult('PASS'))
      asMock(platformFetch).mockResolvedValue({
        version: '1.0.0',
        commitSha: 'abc1234567890',
      })

      captureOutput()
      await promoteSkills('test-skill', { to: 'platform', org: 'my-org' })

      expect(platformFetch).toHaveBeenCalledWith(
        '/skills/@my-org/test-skill/publish',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            version: '1.0.0',
          }),
        })
      )
      expect(updateManifestAndLockfile).toHaveBeenCalled()
    })

    it('errors when --org is not provided', async () => {
      asMock(readManifest).mockReturnValue(
        createManifest({
          packages: {
            'local:/project/skills/test-skill': Object.assign(
              createManifestPackage({ source: LOCAL_SOURCE }),
              { name: 'test-skill' }
            ),
          },
        })
      )

      captureOutput()
      await promoteSkills('test-skill', { to: 'platform' })

      const spinner = asMock(outputModule.createSpinner).mock.results[0]?.value
      expect(spinner?.fail).toHaveBeenCalledWith(expect.stringContaining('--org flag is required'))
      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('runs security audit before publishing', async () => {
      asMock(readManifest).mockReturnValue(
        createManifest({
          packages: {
            'local:/project/skills/test-skill': Object.assign(
              createManifestPackage({ source: LOCAL_SOURCE }),
              { name: 'test-skill' }
            ),
          },
        })
      )
      asMock(existsSync).mockReturnValue(true)
      asMock(readFileSync).mockReturnValue(VALID_SKILL_MD)
      asMock(readFilesFromDirectory).mockResolvedValue([
        { path: 'SKILL.md', content: VALID_SKILL_MD, size: VALID_SKILL_MD.length },
      ])
      asMock(scanFiles).mockResolvedValue(createAuditScanResult('BLOCK'))

      captureOutput()
      await promoteSkills('test-skill', { to: 'platform', org: 'my-org' })

      expect(scanFiles).toHaveBeenCalled()
      const spinner = asMock(outputModule.createSpinner).mock.results[0]?.value
      expect(spinner?.fail).toHaveBeenCalledWith(expect.stringContaining('Security audit failed'))
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -------------------------------------------------------------------------
  // 3. Error: already remote
  // -------------------------------------------------------------------------

  describe('already remote', () => {
    it('errors when package already has a git source', async () => {
      asMock(readManifest).mockReturnValue(
        createManifest({
          packages: {
            'git:github.com/test-org/test-repo': Object.assign(createManifestPackage(), {
              name: 'test-skill',
            }),
          },
        })
      )

      captureOutput()
      await promoteSkills('test-skill', { to: 'git' })

      const spinner = asMock(outputModule.createSpinner).mock.results[0]?.value
      expect(spinner?.fail).toHaveBeenCalledWith(
        expect.stringContaining('already has a git source')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('errors when package already has a platform source', async () => {
      const platformSource = {
        type: 'platform' as const,
        uri: 'agentver://my-org',
        path: 'skills/test-skill',
        ref: 'main',
        commit: 'abc1234567',
      }

      asMock(readManifest).mockReturnValue(
        createManifest({
          packages: {
            'platform:agentver-skill': Object.assign(
              createManifestPackage({ source: platformSource }),
              { name: 'test-skill' }
            ),
          },
        })
      )

      captureOutput()
      await promoteSkills('test-skill', { to: 'git' })

      const spinner = asMock(outputModule.createSpinner).mock.results[0]?.value
      expect(spinner?.fail).toHaveBeenCalledWith(
        expect.stringContaining('already has a platform source')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -------------------------------------------------------------------------
  // 4. Error: package not found
  // -------------------------------------------------------------------------

  describe('not found', () => {
    it('errors when package is not in manifest', async () => {
      asMock(readManifest).mockReturnValue(createManifest())

      captureOutput()
      await promoteSkills('nonexistent-skill', { to: 'git' })

      const spinner = asMock(outputModule.createSpinner).mock.results[0]?.value
      expect(spinner?.fail).toHaveBeenCalledWith(expect.stringContaining('not found in manifest'))
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -------------------------------------------------------------------------
  // 5. --dry-run
  // -------------------------------------------------------------------------

  describe('--dry-run', () => {
    it('shows what would happen without making changes', async () => {
      asMock(readManifest).mockReturnValue(
        createManifest({
          packages: {
            'local:/project/skills/test-skill': Object.assign(
              createManifestPackage({ source: LOCAL_SOURCE }),
              { name: 'test-skill' }
            ),
          },
        })
      )
      asMock(localContextModule.resolveLocalGitContext).mockResolvedValue(createMockGitContext())

      const { stdout } = captureOutput()
      await promoteSkills('test-skill', { to: 'git', dryRun: true })

      expect(updateManifestAndLockfile).not.toHaveBeenCalled()
      const combinedOutput = stdout.join('')
      expect(combinedOutput).toContain('Would promote')
    })

    it('does not call platform API in dry-run for platform target', async () => {
      asMock(readManifest).mockReturnValue(
        createManifest({
          packages: {
            'local:/project/skills/test-skill': Object.assign(
              createManifestPackage({ source: LOCAL_SOURCE }),
              { name: 'test-skill' }
            ),
          },
        })
      )
      asMock(existsSync).mockReturnValue(true)
      asMock(readFileSync).mockReturnValue(VALID_SKILL_MD)
      asMock(readFilesFromDirectory).mockResolvedValue([
        { path: 'SKILL.md', content: VALID_SKILL_MD, size: VALID_SKILL_MD.length },
      ])
      asMock(scanFiles).mockResolvedValue(createAuditScanResult('PASS'))

      captureOutput()
      await promoteSkills('test-skill', {
        to: 'platform',
        org: 'my-org',
        dryRun: true,
      })

      expect(platformFetch).not.toHaveBeenCalled()
      expect(updateManifestAndLockfile).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 6. --all flag
  // -------------------------------------------------------------------------

  describe('--all', () => {
    it('promotes all local packages to git', async () => {
      const localSource1: LocalSource = { type: 'local', path: '/project/skills/skill-one' }
      const localSource2: LocalSource = { type: 'local', path: '/project/skills/skill-two' }

      asMock(readManifest).mockReturnValue(
        createManifest({
          packages: {
            'local:/project/skills/skill-one': Object.assign(
              createManifestPackage({ source: localSource1 }),
              { name: 'skill-one' }
            ),
            'local:/project/skills/skill-two': Object.assign(
              createManifestPackage({ source: localSource2 }),
              { name: 'skill-two' }
            ),
          },
        })
      )

      asMock(localContextModule.resolveLocalGitContext)
        .mockResolvedValueOnce(createMockGitContext({ relativePath: 'skills/skill-one' }))
        .mockResolvedValueOnce(createMockGitContext({ relativePath: 'skills/skill-two' }))

      let capturedManifest: Record<string, unknown> = {}
      asMock(updateManifestAndLockfile).mockImplementation((_root, _scope, updater) => {
        const manifest = {
          version: 2 as const,
          packages: {
            'local:/project/skills/skill-one': {
              source: localSource1,
              agents: ['claude-code'],
              installedAt: '2025-01-15T10:30:00.000Z',
              modified: false,
              name: 'skill-one',
            },
            'local:/project/skills/skill-two': {
              source: localSource2,
              agents: ['claude-code'],
              installedAt: '2025-01-15T10:30:00.000Z',
              modified: false,
              name: 'skill-two',
            },
          },
        }
        const lockfile = {
          version: 2 as const,
          packages: {
            'local:/project/skills/skill-one': {
              source: localSource1,
              integrity: 'sha256-hash1',
              agents: ['claude-code'],
            },
            'local:/project/skills/skill-two': {
              source: localSource2,
              integrity: 'sha256-hash2',
              agents: ['claude-code'],
            },
          },
        }
        const result = updater(manifest, lockfile)
        capturedManifest = result.manifest.packages
        return result
      })

      captureOutput()
      await promoteSkills(undefined, { to: 'git', all: true })

      expect(localContextModule.resolveLocalGitContext).toHaveBeenCalledTimes(2)
      expect(updateManifestAndLockfile).toHaveBeenCalled()

      const keys = Object.keys(capturedManifest)
      expect(keys.length).toBe(2)
      for (const key of keys) {
        const pkg = capturedManifest[key] as { source: { type: string } }
        expect(pkg.source.type).toBe('git')
      }
    })

    it('errors when --all is used with --to platform', async () => {
      captureOutput()
      await promoteSkills(undefined, { to: 'platform', all: true, org: 'my-org' })

      const spinner = asMock(outputModule.createSpinner).mock.results[0]?.value
      expect(spinner?.fail).toHaveBeenCalledWith(
        expect.stringContaining('--all flag can only be used with --to git')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('reports when no promotable packages exist', async () => {
      asMock(readManifest).mockReturnValue(
        createManifest({
          packages: {
            'git:github.com/test-org/test-repo': Object.assign(createManifestPackage(), {
              name: 'already-git',
            }),
          },
        })
      )

      captureOutput()
      await promoteSkills(undefined, { to: 'git', all: true })

      const spinner = asMock(outputModule.createSpinner).mock.results[0]?.value
      expect(spinner?.warn).toHaveBeenCalledWith(
        expect.stringContaining('No local or unknown packages found')
      )
    })
  })

  // -------------------------------------------------------------------------
  // 7. JSON output
  // -------------------------------------------------------------------------

  describe('JSON output', () => {
    it('outputs structured JSON on success', async () => {
      asMock(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'promote', '--json']

      asMock(readManifest).mockReturnValue(
        createManifest({
          packages: {
            'local:/project/skills/test-skill': Object.assign(
              createManifestPackage({ source: LOCAL_SOURCE }),
              { name: 'test-skill' }
            ),
          },
        })
      )
      asMock(localContextModule.resolveLocalGitContext).mockResolvedValue(createMockGitContext())

      captureOutput()
      await promoteSkills('test-skill', { to: 'git' })

      expect(outputModule.outputSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'PROMOTE_SUCCESS',
          packageKey: 'local:/project/skills/test-skill',
          displayName: 'test-skill',
          previousSource: LOCAL_SOURCE,
          newSource: expect.objectContaining({
            type: 'git',
            uri: 'github.com/test-org/test-repo',
          }),
        })
      )
    })

    it('outputs error JSON when package not found', async () => {
      asMock(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'promote', '--json']
      asMock(readManifest).mockReturnValue(createManifest())

      captureOutput()
      await promoteSkills('nonexistent', { to: 'git' })

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'PROMOTE_FAILED',
        expect.stringContaining('not found in manifest')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -------------------------------------------------------------------------
  // 8. --canonicalise
  // -------------------------------------------------------------------------

  describe('--canonicalise', () => {
    it('canonicalises files into canonical storage after promote', async () => {
      asMock(readManifest).mockReturnValue(
        createManifest({
          packages: {
            'local:/project/skills/test-skill': Object.assign(
              createManifestPackage({ source: LOCAL_SOURCE }),
              { name: 'test-skill' }
            ),
          },
        })
      )
      asMock(localContextModule.resolveLocalGitContext).mockResolvedValue(createMockGitContext())
      asMock(readFilesFromDirectory).mockResolvedValue([
        { path: 'SKILL.md', content: '# Test', size: 6 },
      ])

      captureOutput()
      await promoteSkills('test-skill', { to: 'git', canonicalise: true })

      const { planInstall: mockPlanInstall } = await import('@agentver/installer')
      expect(mockPlanInstall).toHaveBeenCalled()

      const { executeInstall: mockExecuteInstall } = await import('@agentver/installer')
      expect(mockExecuteInstall).toHaveBeenCalled()
    })

    it('skips canonicalise in dry-run mode', async () => {
      asMock(readManifest).mockReturnValue(
        createManifest({
          packages: {
            'local:/project/skills/test-skill': Object.assign(
              createManifestPackage({ source: LOCAL_SOURCE }),
              { name: 'test-skill' }
            ),
          },
        })
      )
      asMock(localContextModule.resolveLocalGitContext).mockResolvedValue(createMockGitContext())

      captureOutput()
      await promoteSkills('test-skill', { to: 'git', canonicalise: true, dryRun: true })

      const { planInstall: mockPlanInstall } = await import('@agentver/installer')
      expect(mockPlanInstall).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 9. Unknown source promotion
  // -------------------------------------------------------------------------

  describe('unknown source', () => {
    it('can promote unknown source packages to git', async () => {
      asMock(readManifest).mockReturnValue(
        createManifest({
          packages: {
            'unknown:test-skill': Object.assign(createManifestPackage({ source: UNKNOWN_SOURCE }), {
              name: 'test-skill',
            }),
          },
        })
      )
      asMock(localContextModule.resolveLocalGitContext).mockResolvedValue(createMockGitContext())

      captureOutput()
      await promoteSkills('test-skill', { to: 'git' })

      expect(updateManifestAndLockfile).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 10. No name arg without --all
  // -------------------------------------------------------------------------

  describe('missing name', () => {
    it('errors when no name and no --all flag', async () => {
      captureOutput()
      await promoteSkills(undefined, { to: 'git' })

      const spinner = asMock(outputModule.createSpinner).mock.results[0]?.value
      expect(spinner?.fail).toHaveBeenCalledWith(
        expect.stringContaining('Package name is required')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })
})
