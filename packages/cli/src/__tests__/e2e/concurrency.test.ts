/**
 * E2E concurrency tests — verifies that concurrent CLI operations on the
 * same project produce correct, uncorrupted results via file locking and
 * transactional writes.
 *
 * Uses mocked git layer (no network) but real filesystem I/O and real
 * file locking.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AgentverError, lockfileV2Schema, manifestV2Schema } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGitSource, createSkillMd } from '../helpers/fixtures'
import { cleanupTempDir, createTempDir } from '../helpers/mock-fs'

// ---------------------------------------------------------------------------
// Mock only git/network layer — keep real filesystem and real file locking
// ---------------------------------------------------------------------------

vi.mock('../../git/index.js', () => ({
  parseGitSource: vi.fn(),
  resolveRef: vi.fn(),
  fetchFiles: vi.fn(),
}))

vi.mock('../../security/index.js', () => ({
  scanFiles: vi.fn(),
  renderScanResult: vi.fn(),
  SCAN_RULES: [],
}))

vi.mock('../../registry/auth.js', () => ({
  getCredentials: vi.fn().mockResolvedValue(null),
  isAuthenticated: vi.fn().mockReturnValue(false),
}))

vi.mock('../../registry/config.js', () => ({
  readConfig: vi.fn().mockReturnValue({}),
  getPlatformUrl: vi.fn().mockReturnValue(null),
}))

vi.mock('../../registry/reporter.js', () => ({
  reportInstallation: vi.fn(),
  reportRemoval: vi.fn(),
}))

vi.mock('../../wellknown/index.js', () => ({
  looksLikeWellKnownUrl: vi.fn().mockReturnValue(false),
  parseWellKnownSource: vi.fn(),
  fetchWellKnownIndex: vi.fn(),
  fetchWellKnownSkill: vi.fn(),
}))

vi.mock('prompts', () => ({
  default: vi.fn().mockResolvedValue({ proceed: true, confirmed: true, action: 'replace' }),
}))

// ---------------------------------------------------------------------------
// SUT imports (after mocks)
// ---------------------------------------------------------------------------

import { installPackage } from '../../commands/install'
import * as gitIndex from '../../git/index.js'
import type { ResolvedRef } from '../../git/types'
import * as securityModule from '../../security/index.js'
import { acquireLock } from '../../storage/file-lock'
import { readLockfile } from '../../storage/lockfile'
import { readManifest } from '../../storage/manifest'
import { updateManifestAndLockfile } from '../../storage/pair'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COMMIT_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

function makeSkillContent(name: string): string {
  return createSkillMd({ name, description: `Test skill: ${name}`, version: '1.0.0' })
}

/**
 * Configures git mocks to return different results based on the repo name
 * in the source URL. Handles the full install pipeline: parseGitSource ->
 * resolveRef -> fetchFiles -> scanFiles.
 *
 * fetchFiles receives a ResolvedRef (not GitSource), so we access
 * resolved.source.repo to identify the package.
 */
function setupGitMocksForMultiplePackages(
  packages: Array<{ owner: string; repo: string; skillName: string }>
): void {
  vi.mocked(gitIndex.parseGitSource).mockImplementation((source: string) => {
    const pkg = packages.find((p) => source.includes(p.repo))
    if (!pkg) throw new Error(`Unexpected source: ${source}`)
    return createGitSource({
      host: 'github.com',
      owner: pkg.owner,
      repo: pkg.repo,
      path: '',
      ref: 'main',
    })
  })

  vi.mocked(gitIndex.resolveRef).mockImplementation(async (gitSource) => ({
    source: gitSource,
    commitSha: COMMIT_SHA,
  }))

  vi.mocked(gitIndex.fetchFiles).mockImplementation(async (resolved: ResolvedRef) => {
    const pkg = packages.find((p) => resolved.source.repo === p.repo)
    if (!pkg) throw new Error(`Unexpected repo in fetchFiles: ${resolved.source.repo}`)
    const content = makeSkillContent(pkg.skillName)
    return {
      files: [{ path: 'SKILL.md', content, size: content.length }],
      commitSha: COMMIT_SHA,
      source: resolved.source,
    }
  })

  vi.mocked(securityModule.scanFiles).mockResolvedValue({
    verdict: 'PASS',
    findings: [],
    scannedAt: new Date().toISOString(),
    duration: 1,
    provider: 'built-in',
  })
}

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let tempDir: string

beforeEach(() => {
  tempDir = createTempDir()
  vi.spyOn(process, 'cwd').mockReturnValue(tempDir)
  mkdirSync(join(tempDir, '.claude'), { recursive: true })
})

afterEach(() => {
  vi.restoreAllMocks()
  cleanupTempDir(tempDir)
})

// ---------------------------------------------------------------------------
// 1. Two installs on same project simultaneously
// ---------------------------------------------------------------------------

describe('E2E: concurrent installs on same project', () => {
  it('both packages end up in the manifest when installed in parallel', async () => {
    setupGitMocksForMultiplePackages([
      { owner: 'org-a', repo: 'skill-alpha', skillName: 'skill-alpha' },
      { owner: 'org-b', repo: 'skill-beta', skillName: 'skill-beta' },
    ])

    const [resultA, resultB] = await Promise.all([
      installPackage('github.com/org-a/skill-alpha', { skipAudit: true }),
      installPackage('github.com/org-b/skill-beta', { skipAudit: true }),
    ])

    expect(resultA.name).toBe('skill-alpha')
    expect(resultB.name).toBe('skill-beta')

    // Read back manifest and lockfile from disk
    const manifest = readManifest(tempDir, 'project')
    const lockfile = readLockfile(tempDir, 'project')

    // Both packages must be present (2 entries total)
    const manifestPackages = Object.values(manifest.packages)
    const lockfilePackages = Object.values(lockfile.packages)
    expect(manifestPackages).toHaveLength(2)
    expect(lockfilePackages).toHaveLength(2)

    // Verify both names appear in the manifest agents lists
    const manifestAgentSets = manifestPackages.map((p) => p.agents)
    expect(manifestAgentSets.every((agents) => agents.length > 0)).toBe(true)
  })

  it('manifest and lockfile are valid JSON after parallel installs', async () => {
    setupGitMocksForMultiplePackages([
      { owner: 'org-a', repo: 'skill-one', skillName: 'skill-one' },
      { owner: 'org-b', repo: 'skill-two', skillName: 'skill-two' },
    ])

    await Promise.all([
      installPackage('github.com/org-a/skill-one', { skipAudit: true }),
      installPackage('github.com/org-b/skill-two', { skipAudit: true }),
    ])

    // Validate raw JSON is parseable and matches schema
    const manifestPath = join(tempDir, '.agentver', 'manifest.json')
    const lockfilePath = join(tempDir, '.agentver', 'lockfile.json')

    expect(existsSync(manifestPath)).toBe(true)
    expect(existsSync(lockfilePath)).toBe(true)

    const manifestRaw = readFileSync(manifestPath, 'utf-8')
    const lockfileRaw = readFileSync(lockfilePath, 'utf-8')

    // Must not throw — valid JSON
    const manifestParsed = JSON.parse(manifestRaw) as unknown
    const lockfileParsed = JSON.parse(lockfileRaw) as unknown

    // Must conform to v2 schemas
    const manifestResult = manifestV2Schema.safeParse(manifestParsed)
    const lockfileResult = lockfileV2Schema.safeParse(lockfileParsed)

    expect(manifestResult.success).toBe(true)
    expect(lockfileResult.success).toBe(true)
  })

  it('no partial writes — manifest and lockfile package counts match', async () => {
    setupGitMocksForMultiplePackages([
      { owner: 'org-a', repo: 'pkg-x', skillName: 'pkg-x' },
      { owner: 'org-b', repo: 'pkg-y', skillName: 'pkg-y' },
    ])

    await Promise.all([
      installPackage('github.com/org-a/pkg-x', { skipAudit: true }),
      installPackage('github.com/org-b/pkg-y', { skipAudit: true }),
    ])

    const manifest = readManifest(tempDir, 'project')
    const lockfile = readLockfile(tempDir, 'project')

    // Manifest and lockfile must have the same set of package keys
    const manifestKeys = Object.keys(manifest.packages).sort()
    const lockfileKeys = Object.keys(lockfile.packages).sort()
    expect(manifestKeys).toEqual(lockfileKeys)

    // Both should have exactly 2 entries
    expect(manifestKeys).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// 2. Install while remove runs
// ---------------------------------------------------------------------------

describe('E2E: install while remove runs', () => {
  it('manifest is consistent when install and remove happen in parallel', async () => {
    // First, install a seed package sequentially
    setupGitMocksForMultiplePackages([
      { owner: 'org-seed', repo: 'seed-pkg', skillName: 'seed-pkg' },
    ])

    const seedResult = await installPackage('github.com/org-seed/seed-pkg', {
      skipAudit: true,
    })
    expect(seedResult.name).toBe('seed-pkg')

    // Verify seed is installed and find its composite key
    const manifestBefore = readManifest(tempDir, 'project')
    expect(Object.values(manifestBefore.packages)).toHaveLength(1)

    const seedKey = Object.keys(manifestBefore.packages)[0]!

    // Now set up mocks for the new package install
    setupGitMocksForMultiplePackages([{ owner: 'org-new', repo: 'new-pkg', skillName: 'new-pkg' }])

    // Run remove (via updateManifestAndLockfile directly, since the remove
    // command is tightly coupled to Commander/prompts) and install in parallel
    const removePromise = new Promise<void>((resolve) => {
      updateManifestAndLockfile(tempDir, 'project', (manifest, lockfile) => {
        delete manifest.packages[seedKey]
        delete lockfile.packages[seedKey]
        return { manifest, lockfile }
      })
      resolve()
    })

    const installPromise = installPackage('github.com/org-new/new-pkg', {
      skipAudit: true,
    })

    await Promise.all([removePromise, installPromise])

    // Read final state
    const manifestAfter = readManifest(tempDir, 'project')
    const lockfileAfter = readLockfile(tempDir, 'project')

    // The seed package should be removed
    expect(manifestAfter.packages[seedKey]).toBeUndefined()

    // The new package should be present (exactly 1 remaining)
    const afterValues = Object.values(manifestAfter.packages)
    expect(afterValues).toHaveLength(1)

    // Manifest and lockfile must stay in sync
    const manifestKeys = Object.keys(manifestAfter.packages).sort()
    const lockfileKeys = Object.keys(lockfileAfter.packages).sort()
    expect(manifestKeys).toEqual(lockfileKeys)

    // Validate schemas
    expect(manifestV2Schema.safeParse(manifestAfter).success).toBe(true)
    expect(lockfileV2Schema.safeParse(lockfileAfter).success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3. File lock contention — updateManifestAndLockfile serialisation
// ---------------------------------------------------------------------------

describe('E2E: file lock contention', () => {
  it('both updates are applied when updateManifestAndLockfile is called in parallel', async () => {
    // Seed an empty manifest/lockfile
    mkdirSync(join(tempDir, '.agentver'), { recursive: true })

    const updateA = new Promise<void>((resolve) => {
      updateManifestAndLockfile(tempDir, 'project', (manifest, lockfile) => {
        manifest.packages['pkg-alpha'] = {
          source: {
            type: 'git',
            uri: 'github.com/test/pkg-alpha',
            path: '',
            ref: 'main',
            commit: 'aaa1111bbb2222',
          },
          agents: ['claude-code'],
          installedAt: new Date().toISOString(),
          modified: false,
        }
        lockfile.packages['pkg-alpha'] = {
          source: {
            type: 'git',
            uri: 'github.com/test/pkg-alpha',
            path: '',
            ref: 'main',
            commit: 'aaa1111bbb2222',
          },
          integrity: 'sha256-alpha123',
          agents: ['claude-code'],
        }
        return { manifest, lockfile }
      })
      resolve()
    })

    const updateB = new Promise<void>((resolve) => {
      updateManifestAndLockfile(tempDir, 'project', (manifest, lockfile) => {
        manifest.packages['pkg-beta'] = {
          source: {
            type: 'git',
            uri: 'github.com/test/pkg-beta',
            path: '',
            ref: 'main',
            commit: 'bbb2222ccc3333',
          },
          agents: ['claude-code'],
          installedAt: new Date().toISOString(),
          modified: false,
        }
        lockfile.packages['pkg-beta'] = {
          source: {
            type: 'git',
            uri: 'github.com/test/pkg-beta',
            path: '',
            ref: 'main',
            commit: 'bbb2222ccc3333',
          },
          integrity: 'sha256-beta456',
          agents: ['claude-code'],
        }
        return { manifest, lockfile }
      })
      resolve()
    })

    await Promise.all([updateA, updateB])

    const manifest = readManifest(tempDir, 'project')
    const lockfile = readLockfile(tempDir, 'project')

    // Both updates must be present — the lock serialises them
    expect(Object.keys(manifest.packages).sort()).toEqual(['pkg-alpha', 'pkg-beta'])
    expect(Object.keys(lockfile.packages).sort()).toEqual(['pkg-alpha', 'pkg-beta'])

    // Validate schema compliance
    expect(manifestV2Schema.safeParse(manifest).success).toBe(true)
    expect(lockfileV2Schema.safeParse(lockfile).success).toBe(true)
  })

  it('final manifest has entries from both updates applied serially under the lock', () => {
    mkdirSync(join(tempDir, '.agentver'), { recursive: true })

    // First update
    updateManifestAndLockfile(tempDir, 'project', (manifest, lockfile) => {
      manifest.packages['first-skill'] = {
        source: {
          type: 'git',
          uri: 'github.com/test/first-skill',
          path: '',
          ref: 'main',
          commit: 'aaa1111bbb2222',
        },
        agents: ['claude-code'],
        installedAt: new Date().toISOString(),
        modified: false,
      }
      lockfile.packages['first-skill'] = {
        source: {
          type: 'git',
          uri: 'github.com/test/first-skill',
          path: '',
          ref: 'main',
          commit: 'aaa1111bbb2222',
        },
        integrity: 'sha256-first123',
        agents: ['claude-code'],
      }
      return { manifest, lockfile }
    })

    // Second update — must see the first's changes
    updateManifestAndLockfile(tempDir, 'project', (manifest, lockfile) => {
      // Verify we can see the first update's data
      expect(manifest.packages['first-skill']).toBeDefined()

      manifest.packages['second-skill'] = {
        source: {
          type: 'git',
          uri: 'github.com/test/second-skill',
          path: '',
          ref: 'main',
          commit: 'bbb2222ccc3333',
        },
        agents: ['claude-code'],
        installedAt: new Date().toISOString(),
        modified: false,
      }
      lockfile.packages['second-skill'] = {
        source: {
          type: 'git',
          uri: 'github.com/test/second-skill',
          path: '',
          ref: 'main',
          commit: 'bbb2222ccc3333',
        },
        integrity: 'sha256-second456',
        agents: ['claude-code'],
      }
      return { manifest, lockfile }
    })

    const manifest = readManifest(tempDir, 'project')
    expect(Object.keys(manifest.packages).sort()).toEqual(['first-skill', 'second-skill'])
  })
})

// ---------------------------------------------------------------------------
// 4. Lock timeout — CONFLICT error, not corruption
// ---------------------------------------------------------------------------

describe('E2E: lock timeout produces CONFLICT error', () => {
  it('throws AgentverError with CONFLICT code when lock is held', () => {
    mkdirSync(join(tempDir, '.agentver'), { recursive: true })

    // Manually acquire the lock
    const release = acquireLock(tempDir, 'project')

    try {
      let caughtError: unknown
      try {
        updateManifestAndLockfile(
          tempDir,
          'project',
          (manifest, lockfile) => ({ manifest, lockfile }),
          { acquireTimeoutMs: 200, retryIntervalMs: 50 }
        )
      } catch (error) {
        caughtError = error
      }

      expect(caughtError).toBeDefined()
      expect(caughtError).toBeInstanceOf(AgentverError)
      expect((caughtError as AgentverError).code).toBe('CONFLICT')
      expect((caughtError as AgentverError).message).toContain('Could not acquire storage lock')
    } finally {
      release()
    }
  })

  it('does not corrupt existing manifest/lockfile on lock timeout', () => {
    mkdirSync(join(tempDir, '.agentver'), { recursive: true })

    // Write a known-good manifest and lockfile
    const existingManifest = {
      version: 2,
      packages: {
        'existing-skill': {
          source: {
            type: 'git',
            uri: 'github.com/test/existing',
            path: '',
            ref: 'main',
            commit: 'existing1234567',
          },
          agents: ['claude-code'],
          installedAt: '2025-01-01T00:00:00.000Z',
          modified: false,
        },
      },
    }
    const existingLockfile = {
      version: 2,
      packages: {
        'existing-skill': {
          source: {
            type: 'git',
            uri: 'github.com/test/existing',
            path: '',
            ref: 'main',
            commit: 'existing1234567',
          },
          integrity: 'sha256-existing789',
          agents: ['claude-code'],
        },
      },
    }

    writeFileSync(
      join(tempDir, '.agentver', 'manifest.json'),
      JSON.stringify(existingManifest, null, 2)
    )
    writeFileSync(
      join(tempDir, '.agentver', 'lockfile.json'),
      JSON.stringify(existingLockfile, null, 2)
    )

    // Hold the lock so the update times out
    const release = acquireLock(tempDir, 'project')

    try {
      try {
        updateManifestAndLockfile(
          tempDir,
          'project',
          (manifest, lockfile) => {
            manifest.packages['should-not-appear'] = {
              source: {
                type: 'git',
                uri: 'github.com/test/phantom',
                path: '',
                ref: 'main',
                commit: 'phantom1234567',
              },
              agents: ['claude-code'],
              installedAt: new Date().toISOString(),
              modified: false,
            }
            return { manifest, lockfile }
          },
          { acquireTimeoutMs: 200, retryIntervalMs: 50 }
        )
      } catch {
        // Expected — CONFLICT
      }

      // Verify the original data is intact — no corruption
      const manifestRaw = readFileSync(join(tempDir, '.agentver', 'manifest.json'), 'utf-8')
      const lockfileRaw = readFileSync(join(tempDir, '.agentver', 'lockfile.json'), 'utf-8')

      const manifest = JSON.parse(manifestRaw) as Record<string, unknown>
      const lockfile = JSON.parse(lockfileRaw) as Record<string, unknown>

      // Must still have original data
      expect(manifest).toEqual(existingManifest)
      expect(lockfile).toEqual(existingLockfile)

      // 'should-not-appear' must not be present
      const packages = (manifest as { packages: Record<string, unknown> }).packages
      expect(Object.keys(packages)).not.toContain('should-not-appear')
    } finally {
      release()
    }
  })

  it('lock can be acquired again after timeout error', () => {
    mkdirSync(join(tempDir, '.agentver'), { recursive: true })

    const release = acquireLock(tempDir, 'project')

    // First attempt should time out
    try {
      updateManifestAndLockfile(
        tempDir,
        'project',
        (manifest, lockfile) => ({ manifest, lockfile }),
        { acquireTimeoutMs: 200, retryIntervalMs: 50 }
      )
    } catch {
      // Expected
    }

    // Release the original lock
    release()

    // Should now succeed without error
    const result = updateManifestAndLockfile(tempDir, 'project', (manifest, lockfile) => {
      manifest.packages['post-timeout-skill'] = {
        source: {
          type: 'git',
          uri: 'github.com/test/post-timeout',
          path: '',
          ref: 'main',
          commit: 'post1234567',
        },
        agents: ['claude-code'],
        installedAt: new Date().toISOString(),
        modified: false,
      }
      lockfile.packages['post-timeout-skill'] = {
        source: {
          type: 'git',
          uri: 'github.com/test/post-timeout',
          path: '',
          ref: 'main',
          commit: 'post1234567',
        },
        integrity: 'sha256-post789',
        agents: ['claude-code'],
      }
      return { manifest, lockfile }
    })

    expect(Object.keys(result.manifest.packages)).toContain('post-timeout-skill')
  })

  it('manually written stale lock file is reclaimed', () => {
    const lockPath = join(tempDir, '.agentver', '.lock')
    mkdirSync(join(tempDir, '.agentver'), { recursive: true })

    // Write a lock file from a dead process
    writeFileSync(lockPath, JSON.stringify({ pid: 999999999, createdAt: Date.now() }))

    // updateManifestAndLockfile should reclaim the stale lock and succeed
    const result = updateManifestAndLockfile(tempDir, 'project', (manifest, lockfile) => {
      manifest.packages['reclaimed-skill'] = {
        source: {
          type: 'git',
          uri: 'github.com/test/reclaimed',
          path: '',
          ref: 'main',
          commit: 'reclaim1234567',
        },
        agents: ['claude-code'],
        installedAt: new Date().toISOString(),
        modified: false,
      }
      lockfile.packages['reclaimed-skill'] = {
        source: {
          type: 'git',
          uri: 'github.com/test/reclaimed',
          path: '',
          ref: 'main',
          commit: 'reclaim1234567',
        },
        integrity: 'sha256-reclaimed789',
        agents: ['claude-code'],
      }
      return { manifest, lockfile }
    })

    expect(Object.keys(result.manifest.packages)).toContain('reclaimed-skill')

    // Lock file should be cleaned up
    expect(existsSync(lockPath)).toBe(false)
  })
})
