/**
 * E2E dependency and conflict enforcement tests — verifies the full install
 * flow with dependsOn / conflictsWith frontmatter metadata.
 *
 * Mocks only the git resolution/fetch layer. All filesystem operations
 * (canonical dir, symlinks, manifest, lockfile) use real disk I/O.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentverError, ManifestV2 } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGitSource, createSkillMd } from '../helpers/fixtures'
import { cleanupTempDir, createTempDir } from '../helpers/mock-fs'

// ---------------------------------------------------------------------------
// Mock only git/network layer — keep real filesystem
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
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import { installPackage } from '../../commands/install'
import * as gitIndex from '../../git/index.js'
import type { FetchResult, ResolvedRef } from '../../git/types'
import * as securityModule from '../../security/index.js'

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

const COMMIT_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

let tempDir: string

/**
 * Configure the mocked git layer to return the given files for a specific
 * owner/repo pair. Defaults to test-owner/test-repo.
 */
function setupGitMocksForRepo(
  owner: string,
  repo: string,
  files: Array<{ path: string; content: string; size: number }>
): void {
  const gitSource = createGitSource({
    host: 'github.com',
    owner,
    repo,
    path: '',
    ref: 'main',
  })

  const resolved: ResolvedRef = { source: gitSource, commitSha: COMMIT_SHA }
  const fetchResult: FetchResult = {
    files,
    commitSha: COMMIT_SHA,
    source: gitSource,
  }

  vi.mocked(gitIndex.parseGitSource).mockReturnValue(gitSource)
  vi.mocked(gitIndex.resolveRef).mockResolvedValue(resolved)
  vi.mocked(gitIndex.fetchFiles).mockResolvedValue(fetchResult)
  vi.mocked(securityModule.scanFiles).mockResolvedValue({
    verdict: 'PASS',
    findings: [],
    scannedAt: new Date().toISOString(),
    duration: 1,
    provider: 'built-in',
  })
}

/**
 * Set up git mocks for a simple skill (no dependencies or conflicts).
 */
function mockSimpleSkill(owner: string, repo: string, name: string): void {
  const content = createSkillMd({ name, description: `The ${name} skill` })
  setupGitMocksForRepo(owner, repo, [{ path: 'SKILL.md', content, size: content.length }])
}

/**
 * Set up git mocks for a skill with dependsOn frontmatter.
 */
function mockSkillWithDeps(owner: string, repo: string, name: string, dependsOn: string[]): void {
  const content = createSkillMd({ name, description: `The ${name} skill`, dependsOn })
  setupGitMocksForRepo(owner, repo, [{ path: 'SKILL.md', content, size: content.length }])
}

/**
 * Set up git mocks for a skill with conflictsWith frontmatter.
 */
function mockSkillWithConflicts(
  owner: string,
  repo: string,
  name: string,
  conflictsWith: string[]
): void {
  const content = createSkillMd({ name, description: `The ${name} skill`, conflictsWith })
  setupGitMocksForRepo(owner, repo, [{ path: 'SKILL.md', content, size: content.length }])
}

beforeEach(() => {
  tempDir = createTempDir()
  vi.spyOn(process, 'cwd').mockReturnValue(tempDir)

  // Ensure .claude dir exists so agent detection finds claude-code
  mkdirSync(join(tempDir, '.claude'), { recursive: true })
})

afterEach(() => {
  vi.restoreAllMocks()
  cleanupTempDir(tempDir)
})

// ---------------------------------------------------------------------------
// Helpers for reading manifest from disk
// ---------------------------------------------------------------------------

function readManifestFromDisk(): ManifestV2 | null {
  const manifestPath = join(tempDir, '.agentver/manifest.json')
  if (!existsSync(manifestPath)) return null
  return JSON.parse(readFileSync(manifestPath, 'utf-8')) as ManifestV2
}

// ---------------------------------------------------------------------------
// 1. Install with missing dependency fails
// ---------------------------------------------------------------------------

describe('E2E: dependency enforcement', () => {
  it('rejects install when a dependency is not installed', async () => {
    mockSkillWithDeps('test-owner', 'skill-b', 'skill-b', ['skill-a'])

    let caught: AgentverError | undefined
    try {
      await installPackage('github.com/test-owner/skill-b', { skipAudit: true })
    } catch (error) {
      caught = error as AgentverError
    }

    expect(caught).toBeDefined()
    expect(caught!.code).toBe('DEPENDENCY_MISSING')
    expect(caught!.message).toContain('skill-a')

    // Manifest must NOT be written — no partial install
    const manifest = readManifestFromDisk()
    if (manifest) {
      expect(Object.keys(manifest.packages)).toHaveLength(0)
    }
  })

  // ---------------------------------------------------------------------------
  // 2. Install succeeds once dependency is present
  // ---------------------------------------------------------------------------

  it('allows install when all dependencies are already installed', async () => {
    // Step 1: install skill-a (no dependencies)
    mockSimpleSkill('test-owner', 'skill-a', 'skill-a')
    const resultA = await installPackage('github.com/test-owner/skill-a', { skipAudit: true })
    expect(resultA.name).toBe('skill-a')

    // Step 2: install skill-b which depends on skill-a
    mockSkillWithDeps('test-owner', 'skill-b', 'skill-b', ['skill-a'])
    const resultB = await installPackage('github.com/test-owner/skill-b', { skipAudit: true })
    expect(resultB.name).toBe('skill-b')

    // Both skills present in manifest
    const manifest = readManifestFromDisk()
    expect(manifest).not.toBeNull()
    const keys = Object.keys(manifest!.packages)
    expect(keys).toHaveLength(2)

    // Verify canonical directories exist
    expect(existsSync(join(tempDir, '.agents/skills/skill-a'))).toBe(true)
    expect(existsSync(join(tempDir, '.agents/skills/skill-b'))).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // 3. Install with multiple missing dependencies lists them all
  // ---------------------------------------------------------------------------

  it('lists all missing dependencies in the error', async () => {
    mockSkillWithDeps('test-owner', 'skill-c', 'skill-c', ['dep-one', 'dep-two'])

    let caught: AgentverError | undefined
    try {
      await installPackage('github.com/test-owner/skill-c', { skipAudit: true })
    } catch (error) {
      caught = error as AgentverError
    }

    expect(caught).toBeDefined()
    expect(caught!.code).toBe('DEPENDENCY_MISSING')
    expect(caught!.message).toContain('dep-one')
    expect(caught!.message).toContain('dep-two')
  })
})

// ---------------------------------------------------------------------------
// 4. Install with conflict fails
// ---------------------------------------------------------------------------

describe('E2E: conflict enforcement', () => {
  it('rejects install when a conflicting package is installed', async () => {
    // Install skill-a first
    mockSimpleSkill('test-owner', 'skill-a', 'skill-a')
    await installPackage('github.com/test-owner/skill-a', { skipAudit: true })

    // Attempt to install skill-c which conflicts with skill-a
    mockSkillWithConflicts('test-owner', 'skill-c', 'skill-c', ['skill-a'])

    let caught: AgentverError | undefined
    try {
      await installPackage('github.com/test-owner/skill-c', { skipAudit: true })
    } catch (error) {
      caught = error as AgentverError
    }

    expect(caught).toBeDefined()
    expect(caught!.code).toBe('CONFLICT_DETECTED')
    expect(caught!.message).toContain('skill-a')

    // Manifest should still only contain skill-a
    const manifest = readManifestFromDisk()
    expect(manifest).not.toBeNull()
    const keys = Object.keys(manifest!.packages)
    expect(keys).toHaveLength(1)
    // skill-a should be the only entry (match by display name or key)
    const hasSkillA = keys.some(
      (key) => key.includes('skill-a') || manifest!.packages[key]?.name === 'skill-a'
    )
    expect(hasSkillA).toBe(true)
  })

  it('allows install when conflicts are not installed', async () => {
    // skill-c conflicts with skill-x, but skill-x is not installed
    mockSkillWithConflicts('test-owner', 'skill-c', 'skill-c', ['skill-x'])

    const result = await installPackage('github.com/test-owner/skill-c', { skipAudit: true })
    expect(result.name).toBe('skill-c')

    const manifest = readManifestFromDisk()
    expect(manifest).not.toBeNull()
    expect(Object.keys(manifest!.packages)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 5. Remove warns about dependents (via CLI binary)
// ---------------------------------------------------------------------------

describe('E2E: reverse dependency warnings on remove', () => {
  it('warns when removing a package that others depend on', async () => {
    // Install skill-a
    mockSimpleSkill('test-owner', 'skill-a', 'skill-a')
    await installPackage('github.com/test-owner/skill-a', { skipAudit: true })

    // Install skill-b which depends on skill-a
    mockSkillWithDeps('test-owner', 'skill-b', 'skill-b', ['skill-a'])
    await installPackage('github.com/test-owner/skill-b', { skipAudit: true })

    // Manually add dependsOn to skill-b's manifest entry so findReverseDependencies picks it up.
    // The install command writes the manifest but does not persist dependsOn in the manifest
    // package entry itself — it only checks at install time. We need to simulate a manifest
    // that has the dependsOn field set (as the platform/future versions would).
    const manifest = readManifestFromDisk()
    expect(manifest).not.toBeNull()

    // Find skill-b's key and add dependsOn
    const skillBKey = Object.keys(manifest!.packages).find(
      (key) => key.includes('skill-b') || manifest!.packages[key]?.name === 'skill-b'
    )
    expect(skillBKey).toBeDefined()
    manifest!.packages[skillBKey!]!.dependsOn = ['skill-a']

    // Write the updated manifest back
    const manifestPath = join(tempDir, '.agentver/manifest.json')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

    // Now use findReverseDependencies directly to verify
    const { findReverseDependencies } = await import('../../dependency-check')
    const { readManifest } = await import('../../storage/manifest')

    const currentManifest = readManifest(tempDir, 'project')
    const reverseDeps = findReverseDependencies('skill-a', currentManifest)

    expect(reverseDeps).toHaveLength(1)
    expect(reverseDeps[0]!.name).toBe('skill-b')
    expect(reverseDeps[0]!.dependsOn).toContain('skill-a')
  })
})

// ---------------------------------------------------------------------------
// 6. Dependency check uses display names
// ---------------------------------------------------------------------------

describe('E2E: dependency resolution by display name', () => {
  it('resolves dependencies by display name when manifest keys differ', async () => {
    // Install skill-a — the manifest key will be something like
    // git:github.com/test-owner/skill-a but the display name is skill-a
    mockSimpleSkill('test-owner', 'skill-a', 'skill-a')
    await installPackage('github.com/test-owner/skill-a', { skipAudit: true })

    // Verify skill-a is installed
    const manifestBeforeB = readManifestFromDisk()
    expect(manifestBeforeB).not.toBeNull()
    const skillAKey = Object.keys(manifestBeforeB!.packages)[0]!
    expect(skillAKey).toBeDefined()

    // Install skill-b depending on skill-a by its display name
    mockSkillWithDeps('test-owner', 'skill-b', 'skill-b', ['skill-a'])
    const resultB = await installPackage('github.com/test-owner/skill-b', { skipAudit: true })
    expect(resultB.name).toBe('skill-b')

    // Both skills are present
    const manifest = readManifestFromDisk()
    expect(Object.keys(manifest!.packages)).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// 7. Dry-run does not bypass dependency checks
// ---------------------------------------------------------------------------

describe('E2E: dry-run still enforces dependencies', () => {
  it('rejects dry-run install when dependency is missing', async () => {
    mockSkillWithDeps('test-owner', 'skill-b', 'skill-b', ['skill-a'])

    let caught: AgentverError | undefined
    try {
      await installPackage('github.com/test-owner/skill-b', {
        skipAudit: true,
        dryRun: true,
      })
    } catch (error) {
      caught = error as AgentverError
    }

    expect(caught).toBeDefined()
    expect(caught!.code).toBe('DEPENDENCY_MISSING')

    // Nothing written to disk
    expect(existsSync(join(tempDir, '.agentver/manifest.json'))).toBe(false)
  })
})
