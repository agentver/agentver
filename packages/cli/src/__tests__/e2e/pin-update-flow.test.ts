/**
 * E2E test for the pin → update interaction.
 *
 * Verifies that pinned packages are skipped during update and that
 * unpinning allows them to be updated on the next run.
 */

import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ManifestV2, ManifestV2Package } from '@agentver/shared'
import { manifestV2Schema } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSkillMd } from '../helpers/fixtures'
import { cleanupTempDir, createTempDir, readProjectState } from '../helpers/mock-fs'
import { createNoopSpinner } from '../helpers/mock-spinner.js'

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

vi.mock('../../output.js', () => ({
  isJSONMode: vi.fn().mockReturnValue(false),
  isQuiet: vi.fn().mockReturnValue(false),
  isVerbose: vi.fn().mockReturnValue(false),
  getLogLevel: vi.fn().mockReturnValue(4),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
  createSpinner: vi.fn(),
}))

vi.mock('prompts', () => ({
  default: vi.fn().mockResolvedValue({ confirmed: true, proceed: true, action: 'replace' }),
}))

import { installPackage } from '../../commands/install'
import { registerPinCommand, registerUnpinCommand } from '../../commands/pin'
import { registerUpdateCommand } from '../../commands/update'
import * as gitIndex from '../../git/index.js'
import type { FetchResult } from '../../git/types'
import * as outputModule from '../../output.js'
import * as securityModule from '../../security/index.js'

// ---------------------------------------------------------------------------
// Action extractors
// ---------------------------------------------------------------------------

type UpdateAction = (
  name: string | undefined,
  options: { dryRun?: boolean; global?: boolean; yes?: boolean }
) => Promise<void>

type PinAction = (name: string, options: { global?: boolean }) => void

function getUpdateAction(): UpdateAction {
  const program = {
    command: vi.fn().mockReturnThis(),
    description: vi.fn().mockReturnThis(),
    option: vi.fn().mockReturnThis(),
    action: vi.fn().mockReturnThis(),
  }
  registerUpdateCommand(program as never)
  return program.action.mock.calls[0]![0] as UpdateAction
}

function getPinAction(): PinAction {
  const program = {
    command: vi.fn().mockReturnThis(),
    description: vi.fn().mockReturnThis(),
    option: vi.fn().mockReturnThis(),
    action: vi.fn().mockReturnThis(),
  }
  registerPinCommand(program as never)
  return program.action.mock.calls[0]![0] as PinAction
}

function getUnpinAction(): PinAction {
  const program = {
    command: vi.fn().mockReturnThis(),
    description: vi.fn().mockReturnThis(),
    option: vi.fn().mockReturnThis(),
    action: vi.fn().mockReturnThis(),
  }
  registerUnpinCommand(program as never)
  return program.action.mock.calls[0]![0] as PinAction
}

// ---------------------------------------------------------------------------
// Manifest lookup helpers — keys are opaque hashes, not display names
// ---------------------------------------------------------------------------

type ManifestEntry = [string, ManifestV2Package]

function findByName(manifest: ManifestV2, name: string): ManifestEntry {
  const entry = Object.entries(manifest.packages).find(([, pkg]) => pkg.name === name)
  if (!entry) throw new Error(`Package "${name}" not found in manifest`)
  return entry
}

function findLockEntryByManifestName(
  lockPackages: Record<string, { source: { type: string; commit?: string }; integrity?: string }>,
  manifestPackages: ManifestV2['packages'],
  name: string
): { source: { type: string; commit?: string }; integrity?: string } {
  const manifestEntry = Object.entries(manifestPackages).find(([, pkg]) => pkg.name === name)
  if (!manifestEntry) throw new Error(`Package "${name}" not found in manifest for lockfile lookup`)
  const lockEntry = lockPackages[manifestEntry[0]]
  if (!lockEntry) throw new Error(`Package "${name}" not found in lockfile`)
  return lockEntry
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_SHA = 'aaaa111111111111111111111111111111111111'
const UPDATED_SHA = 'bbbb222222222222222222222222222222222222'

// ---------------------------------------------------------------------------
// Git mock helpers
// ---------------------------------------------------------------------------

function mockGitForSkill(repoName: string, commitSha: string, content: string): void {
  vi.mocked(gitIndex.parseGitSource).mockReturnValue({
    host: 'github.com',
    owner: 'test-owner',
    repo: repoName,
    path: '',
    ref: 'main',
  })
  vi.mocked(gitIndex.resolveRef).mockResolvedValue({
    source: {
      host: 'github.com',
      owner: 'test-owner',
      repo: repoName,
      path: '',
      ref: 'main',
    },
    commitSha,
  })
  vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
    files: [{ path: 'SKILL.md', content, size: content.length }],
    commitSha,
    source: {
      host: 'github.com',
      owner: 'test-owner',
      repo: repoName,
      path: '',
      ref: 'main',
    },
  })
}

function mockGitForUpdate(commitSha: string, contentByRepo: Record<string, string>): void {
  vi.mocked(gitIndex.resolveRef).mockImplementation(async (source) => ({
    source,
    commitSha,
  }))

  vi.mocked(gitIndex.fetchFiles).mockImplementation(async (resolved) => {
    const repoName = resolved.source.repo
    const content = contentByRepo[repoName] ?? createSkillMd()
    return {
      files: [{ path: 'SKILL.md', content, size: content.length }],
      commitSha,
      source: resolved.source,
    } satisfies FetchResult
  })

  vi.mocked(gitIndex.parseGitSource).mockImplementation((uri: string) => {
    // URI may contain @ref suffix e.g. "github.com/test-owner/skill-b@main"
    const withoutRef = uri.split('@')[0]!
    const parts = withoutRef.split('/')
    return {
      host: 'github.com',
      owner: parts[1] ?? 'test-owner',
      repo: parts[2] ?? 'unknown',
      path: '',
      ref: 'main',
    }
  })
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tempDir: string

beforeEach(() => {
  tempDir = createTempDir()
  vi.spyOn(process, 'cwd').mockReturnValue(tempDir)

  mkdirSync(join(tempDir, '.claude'), { recursive: true })

  vi.mocked(outputModule.createSpinner).mockReturnValue(
    createNoopSpinner() as unknown as ReturnType<typeof outputModule.createSpinner>
  )
  vi.mocked(securityModule.scanFiles).mockResolvedValue({
    verdict: 'PASS',
    findings: [],
    scannedAt: new Date().toISOString(),
    duration: 1,
    provider: 'built-in',
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  cleanupTempDir(tempDir)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E: pin → update flow', () => {
  it('skips pinned packages during update and updates them after unpinning', async () => {
    const skillAv1 = createSkillMd({ name: 'skill-a', version: '1.0.0' })
    const skillBv1 = createSkillMd({ name: 'skill-b', version: '1.0.0' })
    const skillAv2 = createSkillMd({
      name: 'skill-a',
      version: '2.0.0',
      description: 'Updated skill A',
    })
    const skillBv2 = createSkillMd({
      name: 'skill-b',
      version: '2.0.0',
      description: 'Updated skill B',
    })

    // ------------------------------------------------------------------
    // Step 1: Install skill-a and skill-b at INITIAL_SHA
    // ------------------------------------------------------------------

    mockGitForSkill('skill-a', INITIAL_SHA, skillAv1)
    await installPackage('github.com/test-owner/skill-a', { skipAudit: true })

    mockGitForSkill('skill-b', INITIAL_SHA, skillBv1)
    await installPackage('github.com/test-owner/skill-b', { skipAudit: true })

    // ------------------------------------------------------------------
    // Step 2: Verify both installed, neither pinned
    // ------------------------------------------------------------------

    const stateAfterInstall = readProjectState(tempDir)
    expect(stateAfterInstall.manifest).not.toBeNull()
    const manifest = stateAfterInstall.manifest!

    expect(Object.keys(manifest.packages)).toHaveLength(2)

    const [, pkgA] = findByName(manifest, 'skill-a')
    const [, pkgB] = findByName(manifest, 'skill-b')

    expect(pkgA.pinned).toBeUndefined()
    expect(pkgB.pinned).toBeUndefined()

    expect(pkgA.source.type).toBe('git')
    expect(pkgB.source.type).toBe('git')
    if (pkgA.source.type === 'git') expect(pkgA.source.commit).toBe(INITIAL_SHA)
    if (pkgB.source.type === 'git') expect(pkgB.source.commit).toBe(INITIAL_SHA)

    // ------------------------------------------------------------------
    // Step 3: Pin skill-a
    // ------------------------------------------------------------------

    const pinAction = getPinAction()
    pinAction('skill-a', {})

    const stateAfterPin = readProjectState(tempDir)
    const [, pinnedA] = findByName(stateAfterPin.manifest!, 'skill-a')
    const [, unpinnedB] = findByName(stateAfterPin.manifest!, 'skill-b')
    expect(pinnedA.pinned).toBe(true)
    expect(unpinnedB.pinned).toBeUndefined()

    // ------------------------------------------------------------------
    // Step 4: Verify pinned status via manifest schema compliance
    // ------------------------------------------------------------------

    const rawManifest = JSON.parse(
      readFileSync(join(tempDir, '.agentver/manifest.json'), 'utf-8')
    ) as unknown
    const parsedManifest = manifestV2Schema.parse(rawManifest)
    const [, parsedA] = findByName(parsedManifest, 'skill-a')
    const [, parsedB] = findByName(parsedManifest, 'skill-b')
    expect(parsedA.pinned).toBe(true)
    expect(parsedB.pinned).toBeUndefined()

    // ------------------------------------------------------------------
    // Step 5: Mock git to return UPDATED_SHA for both skills
    // ------------------------------------------------------------------

    mockGitForUpdate(UPDATED_SHA, {
      'skill-a': skillAv2,
      'skill-b': skillBv2,
    })

    // ------------------------------------------------------------------
    // Step 6: Run update → skill-b updated, skill-a skipped (pinned)
    // Non-JSON mode — the prompts mock handles any overwrite confirmations.
    // ------------------------------------------------------------------

    const updateAction = getUpdateAction()
    await updateAction(undefined, { yes: true })

    // Verify disk state: skill-b updated, skill-a unchanged
    const stateAfterUpdate1 = readProjectState(tempDir)
    const [, afterUpdate1A] = findByName(stateAfterUpdate1.manifest!, 'skill-a')
    const [, afterUpdate1B] = findByName(stateAfterUpdate1.manifest!, 'skill-b')

    // skill-a still pinned at initial commit
    expect(afterUpdate1A.pinned).toBe(true)
    if (afterUpdate1A.source.type === 'git') {
      expect(afterUpdate1A.source.commit).toBe(INITIAL_SHA)
    }

    // skill-b updated to new commit
    if (afterUpdate1B.source.type === 'git') {
      expect(afterUpdate1B.source.commit).toBe(UPDATED_SHA)
    }

    // skill-a file content unchanged
    expect(readFileSync(join(tempDir, '.agents/skills/skill-a/SKILL.md'), 'utf-8')).toBe(skillAv1)

    // skill-b file content updated
    expect(readFileSync(join(tempDir, '.agents/skills/skill-b/SKILL.md'), 'utf-8')).toBe(skillBv2)

    // Lockfile: skill-a at old commit, skill-b at new commit
    const lockA1 = findLockEntryByManifestName(
      stateAfterUpdate1.lockfile!.packages,
      stateAfterUpdate1.manifest!.packages,
      'skill-a'
    )
    const lockB1 = findLockEntryByManifestName(
      stateAfterUpdate1.lockfile!.packages,
      stateAfterUpdate1.manifest!.packages,
      'skill-b'
    )
    if (lockA1.source.type === 'git') expect(lockA1.source.commit).toBe(INITIAL_SHA)
    if (lockB1.source.type === 'git') expect(lockB1.source.commit).toBe(UPDATED_SHA)

    // ------------------------------------------------------------------
    // Step 7: Unpin skill-a
    // ------------------------------------------------------------------

    const unpinAction = getUnpinAction()
    unpinAction('skill-a', {})

    const stateAfterUnpin = readProjectState(tempDir)
    const [, unpinnedAfter] = findByName(stateAfterUnpin.manifest!, 'skill-a')
    expect(unpinnedAfter.pinned).toBeUndefined()

    // ------------------------------------------------------------------
    // Step 8: Run update again → skill-a now updates
    // ------------------------------------------------------------------

    await updateAction(undefined, { yes: true })

    const stateAfterUpdate2 = readProjectState(tempDir)
    const [, afterUpdate2A] = findByName(stateAfterUpdate2.manifest!, 'skill-a')

    // skill-a should now be at the new commit
    if (afterUpdate2A.source.type === 'git') {
      expect(afterUpdate2A.source.commit).toBe(UPDATED_SHA)
    }

    // skill-a file content is now updated
    expect(readFileSync(join(tempDir, '.agents/skills/skill-a/SKILL.md'), 'utf-8')).toBe(skillAv2)

    // ------------------------------------------------------------------
    // Step 9: Final validation — both at latest, manifest/lockfile valid
    // ------------------------------------------------------------------

    const finalState = readProjectState(tempDir)

    const [, finalA] = findByName(finalState.manifest!, 'skill-a')
    const [, finalB] = findByName(finalState.manifest!, 'skill-b')
    if (finalA.source.type === 'git') expect(finalA.source.commit).toBe(UPDATED_SHA)
    if (finalB.source.type === 'git') expect(finalB.source.commit).toBe(UPDATED_SHA)

    // Manifest schema compliance
    const finalRawManifest = JSON.parse(
      readFileSync(join(tempDir, '.agentver/manifest.json'), 'utf-8')
    ) as unknown
    const finalParsedManifest = manifestV2Schema.parse(finalRawManifest)
    expect(Object.keys(finalParsedManifest.packages)).toHaveLength(2)

    // Lockfile integrity for both
    const finalLockA = findLockEntryByManifestName(
      finalState.lockfile!.packages,
      finalState.manifest!.packages,
      'skill-a'
    )
    const finalLockB = findLockEntryByManifestName(
      finalState.lockfile!.packages,
      finalState.manifest!.packages,
      'skill-b'
    )
    expect(finalLockA.integrity).toMatch(/^sha256-/)
    expect(finalLockB.integrity).toMatch(/^sha256-/)
  })

  it('update JSON output includes pinned packages in skipped array', async () => {
    const skillContent = createSkillMd({ name: 'my-skill', version: '1.0.0' })

    mockGitForSkill('my-skill', INITIAL_SHA, skillContent)
    await installPackage('github.com/test-owner/my-skill', { skipAudit: true })

    // Pin it
    const pinAction = getPinAction()
    pinAction('my-skill', {})

    // Mock new upstream commit — resolveRef returns UPDATED_SHA
    vi.mocked(gitIndex.resolveRef).mockResolvedValue({
      source: {
        host: 'github.com',
        owner: 'test-owner',
        repo: 'my-skill',
        path: '',
        ref: 'main',
      },
      commitSha: UPDATED_SHA,
    })

    // Enable JSON mode — the update command will not call installPackage
    // since the only package is pinned, so no overwrite conflict occurs.
    vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
    const outputSuccessMock = vi.mocked(outputModule.outputSuccess)
    outputSuccessMock.mockClear()

    const updateAction = getUpdateAction()
    await updateAction(undefined, { yes: true })

    const lastCall = outputSuccessMock.mock.calls[outputSuccessMock.mock.calls.length - 1]
    expect(lastCall).toBeDefined()

    const result = lastCall![0] as {
      updated: Array<{ name: string }>
      skipped: Array<{ name: string; reason: string }>
    }

    // Nothing updated — the only package is pinned
    expect(result.updated).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]!.name).toBe('my-skill')
    expect(result.skipped[0]!.reason).toBe('pinned')

    // Disk state unchanged — still at initial commit
    const state = readProjectState(tempDir)
    const [, pkg] = findByName(state.manifest!, 'my-skill')
    if (pkg.source.type === 'git') {
      expect(pkg.source.commit).toBe(INITIAL_SHA)
    }
  })

  it('pinning all packages results in zero updates', async () => {
    const skillAContent = createSkillMd({ name: 'skill-a', version: '1.0.0' })
    const skillBContent = createSkillMd({ name: 'skill-b', version: '1.0.0' })

    mockGitForSkill('skill-a', INITIAL_SHA, skillAContent)
    await installPackage('github.com/test-owner/skill-a', { skipAudit: true })

    mockGitForSkill('skill-b', INITIAL_SHA, skillBContent)
    await installPackage('github.com/test-owner/skill-b', { skipAudit: true })

    // Pin both
    const pinAction = getPinAction()
    pinAction('skill-a', {})
    pinAction('skill-b', {})

    // Mock new upstream for both
    mockGitForUpdate(UPDATED_SHA, {
      'skill-a': createSkillMd({ name: 'skill-a', version: '2.0.0' }),
      'skill-b': createSkillMd({ name: 'skill-b', version: '2.0.0' }),
    })

    // Enable JSON mode — all packages are pinned so no installPackage call
    vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
    const outputSuccessMock = vi.mocked(outputModule.outputSuccess)
    outputSuccessMock.mockClear()

    const updateAction = getUpdateAction()
    await updateAction(undefined, { yes: true })

    const lastCall = outputSuccessMock.mock.calls[outputSuccessMock.mock.calls.length - 1]
    expect(lastCall).toBeDefined()

    const result = lastCall![0] as {
      updated: Array<{ name: string }>
      skipped: Array<{ name: string; reason: string }>
    }

    expect(result.updated).toHaveLength(0)
    expect(result.skipped).toHaveLength(2)

    const pinnedReasons = result.skipped.filter((s) => s.reason === 'pinned')
    expect(pinnedReasons).toHaveLength(2)

    const skippedNames = pinnedReasons.map((s) => s.name).sort()
    expect(skippedNames).toEqual(['skill-a', 'skill-b'])

    // Both still at initial commit
    const state = readProjectState(tempDir)
    const [, stateA] = findByName(state.manifest!, 'skill-a')
    const [, stateB] = findByName(state.manifest!, 'skill-b')
    if (stateA.source.type === 'git') expect(stateA.source.commit).toBe(INITIAL_SHA)
    if (stateB.source.type === 'git') expect(stateB.source.commit).toBe(INITIAL_SHA)
  })
})
