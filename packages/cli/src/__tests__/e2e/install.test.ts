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

// Used to override homedir for global install tests
let fakeHomePath: string | null = null
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return {
    ...actual,
    homedir: () => fakeHomePath ?? actual.homedir(),
  }
})

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

function setupGitMocks(files: Array<{ path: string; content: string; size: number }>): void {
  const gitSource = createGitSource({
    host: 'github.com',
    owner: 'test-owner',
    repo: 'test-repo',
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

// NOTE: process.chdir is required because installPackage reads process.cwd()
// internally and does not accept a cwd parameter. Vitest 4.x uses the forks
// pool by default, so each test file runs in its own process — no cross-file
// race condition. Tests within this file run sequentially.
beforeEach(() => {
  tempDir = createTempDir()
  originalCwd = process.cwd()
  process.chdir(tempDir)

  // Create .claude/ so detectInstalledAgents finds claude-code
  mkdirSync(join(tempDir, '.claude'), { recursive: true })

  setupGitMocks([{ path: 'SKILL.md', content: skillContent, size: skillContent.length }])
})

afterEach(() => {
  process.chdir(originalCwd)
  cleanupTempDir(tempDir)
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Standard install
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

    // Verify symlink is relative
    const symlinkPath = join(tempDir, '.claude/skills/test-repo')
    expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true)
    const target = readlinkSync(symlinkPath)
    expect(target.startsWith('/')).toBe(false)
    expect(target).toContain('.agents/skills/test-repo')

    // Verify manifest schema
    const manifestPath = join(tempDir, '.agentver/manifest.json')
    const manifestRaw = readFileSync(manifestPath, 'utf-8')
    const manifestResult = manifestV2Schema.safeParse(JSON.parse(manifestRaw) as unknown)
    expect(manifestResult.success).toBe(true)
    if (manifestResult.success) {
      expect(manifestResult.data.packages['test-repo']).toBeDefined()
      expect(manifestResult.data.packages['test-repo']!.agents).toContain('claude-code')
    }

    // Verify lockfile schema
    const lockfilePath = join(tempDir, '.agentver/lockfile.json')
    const lockfileRaw = readFileSync(lockfilePath, 'utf-8')
    const lockfileResult = lockfileV2Schema.safeParse(JSON.parse(lockfileRaw) as unknown)
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

    expect(existsSync(join(tempDir, '.agents/skills/test-repo'))).toBe(false)
    expect(existsSync(join(tempDir, '.agentver/manifest.json'))).toBe(false)
    expect(existsSync(join(tempDir, '.agentver/lockfile.json'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Global install
// ---------------------------------------------------------------------------

describe('E2E: install --global (in-process, real filesystem)', () => {
  it('creates files under home directory paths', async () => {
    const fakeHome = createTempDir()

    try {
      fakeHomePath = fakeHome

      const result = await installPackage('github.com/test-owner/test-repo', {
        skipAudit: true,
        global: true,
        agent: 'claude-code',
      })

      expect(result.name).toBe('test-repo')

      // Verify files created under fake home
      expect(existsSync(join(fakeHome, '.agents/skills/test-repo/SKILL.md'))).toBe(true)
      expect(existsSync(join(fakeHome, '.agentver/manifest.json'))).toBe(true)
      expect(existsSync(join(fakeHome, '.agentver/lockfile.json'))).toBe(true)

      // Symlink should exist under home
      const symlinkPath = join(fakeHome, '.claude/skills/test-repo')
      expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true)

      // Verify schema
      const manifestRaw = readFileSync(join(fakeHome, '.agentver/manifest.json'), 'utf-8')
      expect(manifestV2Schema.safeParse(JSON.parse(manifestRaw) as unknown).success).toBe(true)
    } finally {
      fakeHomePath = null
      cleanupTempDir(fakeHome)
    }
  })
})

// ---------------------------------------------------------------------------
// AGENT_CONFIG install
// ---------------------------------------------------------------------------

describe('E2E: install AGENT_CONFIG (in-process, real filesystem)', () => {
  it('installs CLAUDE.md config file to project root', async () => {
    const configContent = '# My project rules\n\nAlways use TypeScript.\n'

    // Re-mock with CLAUDE.md as the fetched file (triggers AGENT_CONFIG detection)
    setupGitMocks([{ path: 'CLAUDE.md', content: configContent, size: configContent.length }])

    const result = await installPackage('github.com/test-owner/test-repo', {
      skipAudit: true,
    })

    expect(result.name).toBe('test-repo')

    // AGENT_CONFIG installs write directly to config file path, not canonical dir
    const configFilePath = join(tempDir, 'CLAUDE.md')
    expect(existsSync(configFilePath)).toBe(true)
    const written = readFileSync(configFilePath, 'utf-8')
    expect(written).toContain('Always use TypeScript')

    // Manifest and lockfile should still be created
    const manifestPath = join(tempDir, '.agentver/manifest.json')
    expect(existsSync(manifestPath)).toBe(true)
    const manifestRaw = readFileSync(manifestPath, 'utf-8')
    const manifestResult = manifestV2Schema.safeParse(JSON.parse(manifestRaw) as unknown)
    expect(manifestResult.success).toBe(true)

    const lockfilePath = join(tempDir, '.agentver/lockfile.json')
    expect(existsSync(lockfilePath)).toBe(true)
    const lockfileRaw = readFileSync(lockfilePath, 'utf-8')
    const lockfileResult = lockfileV2Schema.safeParse(JSON.parse(lockfileRaw) as unknown)
    expect(lockfileResult.success).toBe(true)
  })

  it('writes to agent-specific config paths when multiple agents detected', async () => {
    const configContent = '# Shared coding standards\n\nUse strict mode.\n'

    // Create config dirs for cursor and copilot so detectInstalledAgents picks them up
    mkdirSync(join(tempDir, '.cursor'), { recursive: true })
    mkdirSync(join(tempDir, '.github'), { recursive: true })

    setupGitMocks([{ path: 'CLAUDE.md', content: configContent, size: configContent.length }])

    const result = await installPackage('github.com/test-owner/test-repo', {
      skipAudit: true,
    })

    expect(result.name).toBe('test-repo')

    // Claude writes to CLAUDE.md (getConfigFilePath returns 'CLAUDE.md')
    const claudePath = join(tempDir, 'CLAUDE.md')
    expect(existsSync(claudePath)).toBe(true)
    expect(readFileSync(claudePath, 'utf-8')).toContain('Use strict mode')

    // Cursor writes to .cursorrules (getConfigFilePath returns '.cursorrules')
    const cursorPath = join(tempDir, '.cursorrules')
    expect(existsSync(cursorPath)).toBe(true)
    expect(readFileSync(cursorPath, 'utf-8')).toContain('Use strict mode')

    // Copilot writes to .github/copilot-instructions.md
    const copilotPath = join(tempDir, '.github/copilot-instructions.md')
    expect(existsSync(copilotPath)).toBe(true)
    expect(readFileSync(copilotPath, 'utf-8')).toContain('Use strict mode')

    // All three should have the same content (markdown passthrough)
    const claudeContent = readFileSync(claudePath, 'utf-8')
    const cursorContent = readFileSync(cursorPath, 'utf-8')
    expect(cursorContent).toBe(claudeContent)
  })
})
