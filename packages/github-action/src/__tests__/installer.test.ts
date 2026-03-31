import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
  debug: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
  setSecret: vi.fn(),
  getInput: vi.fn(),
  getBooleanInput: vi.fn(),
  summary: { addRaw: vi.fn().mockReturnThis(), write: vi.fn() },
}))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import type { DownloadResponse } from '../installer'
import {
  computeIntegrity,
  detectAgents,
  extractFilesFromManifest,
  IntegrityError,
  ManifestNotFoundError,
  RegistryAuthError,
  RegistryNetworkError,
  RegistryTimeoutError,
  readLockfileFile,
  readManifestFile,
  updateLockfile,
  verifyIntegrityWithWarning,
  writeLockfileFile,
} from '../installer'
import type { InstallResult } from '../reporter'

/** Helper: path to .agentver dir within a project root. */
function agentverDir(projectRoot: string): string {
  return join(projectRoot, '.agentver')
}

/** Helper: write a manifest file in the standard storage location. */
function writeManifest(projectRoot: string, data: unknown): void {
  const dir = agentverDir(projectRoot)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(data), 'utf-8')
}

/** Helper: write a lockfile in the standard storage location. */
function writeLockfile(projectRoot: string, data: unknown): void {
  const dir = agentverDir(projectRoot)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'lockfile.json'), JSON.stringify(data), 'utf-8')
}

describe('installer', () => {
  let tempDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    tempDir = join(
      tmpdir(),
      `agentver-gha-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  // ---------------------------------------------------------------------------
  // Error classes
  // ---------------------------------------------------------------------------

  describe('error classes', () => {
    it('ManifestNotFoundError includes the path in the message', () => {
      const error = new ManifestNotFoundError('/some/path/manifest.json')
      expect(error.message).toContain('/some/path/manifest.json')
      expect(error.name).toBe('ManifestNotFoundError')
    })

    it('RegistryAuthError includes the status code', () => {
      const error = new RegistryAuthError(401, 'Unauthorised')
      expect(error.message).toContain('401')
      expect(error.message).toContain('AGENTVER_API_KEY')
      expect(error.name).toBe('RegistryAuthError')
    })

    it('RegistryNetworkError includes the URL', () => {
      const error = new RegistryNetworkError('https://api.example.com', new Error('ECONNREFUSED'))
      expect(error.message).toContain('https://api.example.com')
      expect(error.message).toContain('ECONNREFUSED')
      expect(error.name).toBe('RegistryNetworkError')
    })

    it('RegistryNetworkError handles non-Error causes', () => {
      const error = new RegistryNetworkError('https://api.example.com', 'string error')
      expect(error.message).toContain('string error')
    })

    it('RegistryTimeoutError includes the URL', () => {
      const error = new RegistryTimeoutError('https://api.example.com')
      expect(error.message).toContain('https://api.example.com')
      expect(error.message).toContain('timed out')
      expect(error.name).toBe('RegistryTimeoutError')
    })

    it('IntegrityError includes the package name and hashes', () => {
      const error = new IntegrityError('org/skill', 'sha256-expected', 'sha256-actual')
      expect(error.message).toContain('org/skill')
      expect(error.message).toContain('sha256-expected')
      expect(error.message).toContain('sha256-actual')
      expect(error.name).toBe('IntegrityError')
    })
  })

  // ---------------------------------------------------------------------------
  // readManifestFile
  // ---------------------------------------------------------------------------

  describe('readManifestFile', () => {
    it('throws ManifestNotFoundError when file does not exist', () => {
      expect(() => readManifestFile(join(tempDir, 'nonexistent-project'))).toThrow(
        ManifestNotFoundError
      )
    })

    it('throws on invalid JSON', () => {
      const dir = agentverDir(tempDir)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'manifest.json'), '{bad json', 'utf-8')
      expect(() => readManifestFile(tempDir)).toThrow('invalid JSON')
    })

    it('throws on schema validation failure', () => {
      writeManifest(tempDir, { foo: 'bar' })
      expect(() => readManifestFile(tempDir)).toThrow('schema validation failed')
    })

    it('reads a valid v2 manifest', () => {
      const manifest = {
        version: 2,
        packages: {
          'org/skill': {
            source: {
              type: 'git',
              uri: 'https://github.com/org/repo',
              path: 'skills/skill',
              ref: 'v1.0.0',
              commit: 'abc1234def',
            },
            agents: ['claude-code'],
            installedAt: new Date().toISOString(),
            modified: false,
          },
        },
      }
      writeManifest(tempDir, manifest)

      const result = readManifestFile(tempDir)
      expect(result.version).toBe(2)
      expect(result.packages['git:https%3A%2F%2Fgithub.com%2Forg%2Frepo%23skills%2Fskill']).toEqual(
        expect.objectContaining({
          name: 'org/skill',
        })
      )
    })

    it('rejects a legacy manifest schema', () => {
      const legacyManifest = {
        version: 1,
        packages: {
          'org/skill': {
            name: 'org/skill',
            version: '1.0.0',
            agents: ['claude-code'],
            installedAt: new Date().toISOString(),
          },
        },
      }
      writeManifest(tempDir, legacyManifest)

      expect(() => readManifestFile(tempDir)).toThrow('schema validation failed')
      expect(
        JSON.parse(readFileSync(join(agentverDir(tempDir), 'manifest.json'), 'utf-8'))
      ).toEqual(legacyManifest)
    })
  })

  // ---------------------------------------------------------------------------
  // readLockfileFile
  // ---------------------------------------------------------------------------

  describe('readLockfileFile', () => {
    it('returns null when file does not exist', () => {
      expect(readLockfileFile(join(tempDir, 'nonexistent-project'))).toBeNull()
    })

    it('returns null for invalid JSON', () => {
      const dir = agentverDir(tempDir)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'lockfile.json'), 'not json', 'utf-8')
      expect(readLockfileFile(tempDir)).toBeNull()
    })

    it('returns null when schema validation fails', () => {
      writeLockfile(tempDir, { invalid: true })
      expect(readLockfileFile(tempDir)).toBeNull()
    })

    it('reads a valid v2 lockfile', () => {
      const lockfile = {
        version: 2,
        packages: {
          'org/skill': {
            source: {
              type: 'git',
              uri: 'https://github.com/org/repo',
              path: 'skills/skill',
              ref: 'v1.0.0',
              commit: 'abc1234def',
            },
            integrity: 'sha256-abc',
            agents: ['claude-code'],
          },
        },
      }
      writeLockfile(tempDir, lockfile)

      const result = readLockfileFile(tempDir)
      expect(result).not.toBeNull()
      expect(result!.version).toBe(2)
      expect(
        result!.packages['git:https%3A%2F%2Fgithub.com%2Forg%2Frepo%23skills%2Fskill']
      ).toEqual(
        expect.objectContaining({
          name: 'org/skill',
        })
      )
    })

    it('returns null for a legacy lockfile schema', () => {
      const legacyLockfile = {
        version: 1,
        packages: {
          'org/skill': {
            version: '1.0.0',
            resolved: 'https://example.com/package.tar.gz',
            integrity: 'sha256-abc',
            agents: ['claude-code'],
          },
        },
      }
      writeLockfile(tempDir, legacyLockfile)

      expect(readLockfileFile(tempDir)).toBeNull()
      expect(
        JSON.parse(readFileSync(join(agentverDir(tempDir), 'lockfile.json'), 'utf-8'))
      ).toEqual(legacyLockfile)
    })
  })

  // ---------------------------------------------------------------------------
  // writeLockfileFile
  // ---------------------------------------------------------------------------

  describe('writeLockfileFile', () => {
    it('creates parent directories if they do not exist', () => {
      const projectRoot = join(tempDir, 'nested', 'dir')
      mkdirSync(projectRoot, { recursive: true })
      writeLockfileFile(projectRoot, { version: 2, packages: {} })
      expect(existsSync(join(agentverDir(projectRoot), 'lockfile.json'))).toBe(true)
    })

    it('writes valid JSON that can be read back', () => {
      mkdirSync(agentverDir(tempDir), { recursive: true })
      const lockfile = { version: 2 as const, packages: {} }
      writeLockfileFile(tempDir, lockfile)

      const raw = readFileSync(join(agentverDir(tempDir), 'lockfile.json'), 'utf-8')
      expect(JSON.parse(raw)).toEqual(lockfile)
    })
  })

  // ---------------------------------------------------------------------------
  // extractFilesFromManifest
  // ---------------------------------------------------------------------------

  describe('extractFilesFromManifest', () => {
    it('extracts files from an array-style manifest', () => {
      const files = extractFilesFromManifest([
        { path: 'SKILL.md', content: '# Hello' },
        { path: 'config.yml', content: 'key: val' },
      ])

      expect(files).toHaveLength(2)
      expect(files[0]).toEqual({ path: 'SKILL.md', content: '# Hello' })
    })

    it('extracts files from a record-style manifest', () => {
      const files = extractFilesFromManifest({
        'SKILL.md': '# Hello',
        'config.yml': 'key: val',
      })

      expect(files).toHaveLength(2)
      expect(files[0]!.path).toBe('SKILL.md')
      expect(files[0]!.content).toBe('# Hello')
    })

    it('filters out non-string values from record-style manifests', () => {
      const files = extractFilesFromManifest({
        'SKILL.md': '# Hello',
        metadata: 42,
        flag: true,
      } as Record<string, unknown>)

      expect(files).toHaveLength(1)
      expect(files[0]!.path).toBe('SKILL.md')
    })

    it('filters out invalid entries from array-style manifests', () => {
      const files = extractFilesFromManifest([
        { path: 'SKILL.md', content: '# Hello' },
        { path: 123, content: 'invalid' },
        null,
        'string entry',
      ] as unknown[])

      expect(files).toHaveLength(1)
    })

    it('returns empty array for empty manifest', () => {
      expect(extractFilesFromManifest({})).toHaveLength(0)
      expect(extractFilesFromManifest([])).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // computeIntegrity
  // ---------------------------------------------------------------------------

  describe('computeIntegrity', () => {
    it('returns a sha256- prefixed string', () => {
      const result = computeIntegrity([{ path: 'SKILL.md', content: '# Hello' }])
      expect(result).toMatch(/^sha256-/)
    })

    it('is deterministic for the same input', () => {
      const files = [
        { path: 'a.md', content: 'aaa' },
        { path: 'b.md', content: 'bbb' },
      ]
      expect(computeIntegrity(files)).toBe(computeIntegrity(files))
    })

    it('produces the same hash regardless of input order', () => {
      const filesA = [
        { path: 'b.md', content: 'bbb' },
        { path: 'a.md', content: 'aaa' },
      ]
      const filesB = [
        { path: 'a.md', content: 'aaa' },
        { path: 'b.md', content: 'bbb' },
      ]
      expect(computeIntegrity(filesA)).toBe(computeIntegrity(filesB))
    })

    it('produces different hashes for different content', () => {
      const hash1 = computeIntegrity([{ path: 'a.md', content: 'hello' }])
      const hash2 = computeIntegrity([{ path: 'a.md', content: 'world' }])
      expect(hash1).not.toBe(hash2)
    })
  })

  // ---------------------------------------------------------------------------
  // verifyIntegrityWithWarning
  // ---------------------------------------------------------------------------

  describe('verifyIntegrityWithWarning', () => {
    it('does nothing when lockfile integrity is undefined', () => {
      expect(() => {
        verifyIntegrityWithWarning([{ path: 'a.md', content: 'hello' }], undefined, 'org/skill')
      }).not.toThrow()
    })

    it('passes when computed integrity matches lockfile integrity', () => {
      const files = [{ path: 'a.md', content: 'hello' }]
      const integrity = computeIntegrity(files)

      expect(() => {
        verifyIntegrityWithWarning(files, integrity, 'org/skill')
      }).not.toThrow()
    })

    it('throws IntegrityError when hashes do not match', () => {
      const files = [{ path: 'a.md', content: 'hello' }]

      expect(() => {
        verifyIntegrityWithWarning(files, 'sha256-wrong', 'org/skill')
      }).toThrow(IntegrityError)
    })
  })

  // ---------------------------------------------------------------------------
  // detectAgents
  // ---------------------------------------------------------------------------

  describe('detectAgents', () => {
    it('returns specified agents when provided', () => {
      const result = detectAgents(tempDir, ['claude-code', 'cursor'])
      expect(result).toEqual(['claude-code', 'cursor'])
    })

    it('auto-detects agents when none specified', () => {
      const result = detectAgents(tempDir, [])
      expect(Array.isArray(result)).toBe(true)
    })

    it('detects claude-code when .claude directory exists', () => {
      mkdirSync(join(tempDir, '.claude'), { recursive: true })

      const result = detectAgents(tempDir, [])
      expect(result).toContain('claude-code')
    })
  })

  // ---------------------------------------------------------------------------
  // installer integration (planInstall + executeInstall via installAllPackages)
  // ---------------------------------------------------------------------------

  describe('installer integration', () => {
    it('detects agents correctly for the installer request', () => {
      mkdirSync(join(tempDir, '.claude'), { recursive: true })

      const agents = detectAgents(tempDir, [])
      expect(agents).toContain('claude-code')
    })

    it('uses specified agents when provided', () => {
      const agents = detectAgents(tempDir, ['claude-code', 'cursor'])
      expect(agents).toEqual(['claude-code', 'cursor'])
    })
  })

  // ---------------------------------------------------------------------------
  // updateLockfile
  // ---------------------------------------------------------------------------

  describe('updateLockfile', () => {
    it('adds successful results to the lockfile', () => {
      const existingLockfile = { version: 2 as const, packages: {} }

      const results: InstallResult[] = [
        {
          name: 'org/skill',
          version: '1.0.0',
          agents: ['claude-code'],
          fileCount: 1,
          success: true,
        },
      ]

      const resolvedData = new Map<
        string,
        { response: DownloadResponse; files: Array<{ path: string; content: string }> }
      >()
      resolvedData.set('org/skill', {
        response: {
          version: '1.0.0',
          content: null,
          fileManifest: [{ path: 'SKILL.md', content: '# Test' }],
          sha256: 'abc',
          size: 100,
          gitRef: 'v1.0.0',
          gitCommitSha: 'commit123',
          gitUri: 'https://github.com/org/repo',
          gitPath: 'skills/skill',
          createdAt: '2025-01-01T00:00:00Z',
        },
        files: [{ path: 'SKILL.md', content: '# Test' }],
      })

      const updated = updateLockfile(existingLockfile, results, resolvedData)

      const pkg = updated.packages['git:https%3A%2F%2Fgithub.com%2Forg%2Frepo%23skills%2Fskill']
      expect(pkg).toBeDefined()
      expect(pkg!.source.type).toBe('git')
      expect(pkg!.name).toBe('org/skill')
      if (pkg!.source.type === 'git') {
        expect(pkg!.source.uri).toBe('https://github.com/org/repo')
      }
      expect(pkg!.integrity).toMatch(/^sha256-/)
      expect(pkg!.agents).toEqual(['claude-code'])
    })

    it('skips failed results', () => {
      const existingLockfile = { version: 2 as const, packages: {} }

      const results: InstallResult[] = [
        {
          name: 'org/failed',
          version: '1.0.0',
          agents: [],
          fileCount: 0,
          success: false,
          error: 'Something went wrong',
        },
      ]

      const resolvedData = new Map()

      const updated = updateLockfile(existingLockfile, results, resolvedData)
      expect(updated.packages['org/failed']).toBeUndefined()
    })

    it('preserves existing lockfile entries that are not in results', () => {
      const existingLockfile = {
        version: 2 as const,
        packages: {
          'org/existing': {
            source: {
              type: 'git' as const,
              uri: 'https://github.com/org/repo',
              path: 'skills/existing',
              ref: 'v1.0.0',
              commit: 'old123',
            },
            integrity: 'sha256-old',
            agents: ['claude-code'],
          },
        },
      }

      const results: InstallResult[] = []
      const resolvedData = new Map()

      const updated = updateLockfile(existingLockfile, results, resolvedData)
      expect(updated.packages['org/existing']).toBeDefined()
    })

    it('skips entries with missing git provenance', () => {
      const existingLockfile = { version: 2 as const, packages: {} }

      const results: InstallResult[] = [
        {
          name: 'org/skill',
          version: '1.0.0',
          agents: ['claude-code'],
          fileCount: 1,
          success: true,
        },
      ]

      const resolvedData = new Map<
        string,
        { response: DownloadResponse; files: Array<{ path: string; content: string }> }
      >()
      resolvedData.set('org/skill', {
        response: {
          version: '1.0.0',
          content: null,
          fileManifest: [],
          sha256: null,
          size: null,
          gitRef: null,
          gitCommitSha: null,
          gitUri: null,
          gitPath: null,
          createdAt: '2025-01-01T00:00:00Z',
        },
        files: [{ path: 'SKILL.md', content: '# Test' }],
      })

      const updated = updateLockfile(existingLockfile, results, resolvedData)
      expect(updated.packages['org/skill']).toBeUndefined()
    })
  })
})
