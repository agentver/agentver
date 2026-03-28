/**
 * E2E install integration tests — exercises the install command's filesystem
 * effects with mocked git layer but real disk I/O.
 *
 * The install command requires network (GitHub/GitLab APIs, git ls-remote),
 * so we mock only the git resolution/fetch layer. All filesystem operations
 * (canonical dir, symlinks, manifest, lockfile) are real.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'
import { lockfileV2Schema, manifestV2Schema } from '@agentver/shared'
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

vi.mock('prompts', () => ({ default: vi.fn() }))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import type { FetchResult, ResolvedRef } from '../../git/types'
import * as gitIndex from '../../git/index.js'
import * as securityModule from '../../security/index.js'
import { installPackage } from '../../commands/install'

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

const COMMIT_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const skillContent = createSkillMd()

let tempDir: string
let originalCwd: string

beforeEach(() => {
  tempDir = createTempDir()
  originalCwd = process.cwd()
  process.chdir(tempDir)

  // Create .claude/ so detectInstalledAgents finds claude-code
  mkdirSync(join(tempDir, '.claude'), { recursive: true })

  const gitSource = createGitSource({
    host: 'github.com',
    owner: 'test-owner',
    repo: 'test-repo',
    path: '',
    ref: 'main',
  })

  const resolved: ResolvedRef = { source: gitSource, commitSha: COMMIT_SHA }
  const fetchResult: FetchResult = {
    files: [{ path: 'SKILL.md', content: skillContent, size: skillContent.length }],
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
})

afterEach(() => {
  process.chdir(originalCwd)
  cleanupTempDir(tempDir)
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E: install (in-process, real filesystem)', () => {
  it('creates correct disk state for a standard skill', async () => {
    const result = await installPackage('github.com/test-owner/test-repo', {
      skipAudit: true,
    })

    expect(result.name).toBe('test-repo')
    expect(result.agents).toContain('claude-code')

    // Verify canonical directory
    const canonicalPath = join(tempDir, '.agents/skills/test-repo')
    expect(existsSync(canonicalPath)).toBe(true)

    const skillMdPath = join(canonicalPath, 'SKILL.md')
    expect(existsSync(skillMdPath)).toBe(true)
    expect(readFileSync(skillMdPath, 'utf-8')).toBe(skillContent)

    // Verify symlink
    const symlinkPath = join(tempDir, '.claude/skills/test-repo')
    expect(existsSync(symlinkPath)).toBe(true)
    expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true)

    // Symlink should be relative
    const target = readlinkSync(symlinkPath)
    expect(target.startsWith('/')).toBe(false)
    expect(target).toContain('.agents/skills/test-repo')

    // Verify manifest
    const manifestPath = join(tempDir, '.agentver/manifest.json')
    expect(existsSync(manifestPath)).toBe(true)
    const manifestRaw = readFileSync(manifestPath, 'utf-8')
    const manifest = JSON.parse(manifestRaw) as unknown
    const manifestResult = manifestV2Schema.safeParse(manifest)
    expect(manifestResult.success).toBe(true)
    if (manifestResult.success) {
      expect(manifestResult.data.packages['test-repo']).toBeDefined()
      expect(manifestResult.data.packages['test-repo']!.agents).toContain('claude-code')
    }

    // Verify lockfile
    const lockfilePath = join(tempDir, '.agentver/lockfile.json')
    expect(existsSync(lockfilePath)).toBe(true)
    const lockfileRaw = readFileSync(lockfilePath, 'utf-8')
    const lockfile = JSON.parse(lockfileRaw) as unknown
    const lockfileResult = lockfileV2Schema.safeParse(lockfile)
    expect(lockfileResult.success).toBe(true)
    if (lockfileResult.success) {
      expect(lockfileResult.data.packages['test-repo']).toBeDefined()
      expect(lockfileResult.data.packages['test-repo']!.integrity).toMatch(/^sha256-/)
    }
  })

  it('respects --dry-run and does not write to disk', async () => {
    const result = await installPackage('github.com/test-owner/test-repo', {
      skipAudit: true,
      dryRun: true,
    })

    expect(result.name).toBe('test-repo')

    // Nothing should be written
    expect(existsSync(join(tempDir, '.agents/skills/test-repo'))).toBe(false)
    expect(existsSync(join(tempDir, '.agentver/manifest.json'))).toBe(false)
    expect(existsSync(join(tempDir, '.agentver/lockfile.json'))).toBe(false)
  })
})
