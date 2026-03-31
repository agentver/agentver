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
  placeFiles,
  RegistryAuthError,
  RegistryNetworkError,
  RegistryTimeoutError,
  readLockfileFile,
  readManifestFile,
  updateLockfile,
  verifyIntegrity,
  writeLockfileFile,
} from '../installer'
import type { InstallResult } from '../reporter'

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
      expect(() => readManifestFile(join(tempDir, 'nonexistent.json'))).toThrow(
        ManifestNotFoundError
      )
    })

    it('throws on invalid JSON', () => {
      const path = join(tempDir, 'manifest.json')
      writeFileSync(path, '{bad json', 'utf-8')
      expect(() => readManifestFile(path)).toThrow('invalid JSON')
    })

    it('throws on schema validation failure', () => {
      const path = join(tempDir, 'manifest.json')
      writeFileSync(path, JSON.stringify({ foo: 'bar' }), 'utf-8')
      expect(() => readManifestFile(path)).toThrow('schema validation failed')
    })

    it('reads a valid v2 manifest', () => {
      const path = join(tempDir, 'manifest.json')
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
      writeFileSync(path, JSON.stringify(manifest), 'utf-8')

      const result = readManifestFile(path)
      expect(result.version).toBe(2)
      expect(result.packages['git:https%3A%2F%2Fgithub.com%2Forg%2Frepo%23skills%2Fskill']).toEqual(
        expect.objectContaining({
          name: 'org/skill',
        })
      )
    })

    it('rejects a legacy manifest schema', () => {
      const path = join(tempDir, 'manifest.json')
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
      writeFileSync(path, JSON.stringify(legacyManifest), 'utf-8')

      expect(() => readManifestFile(path)).toThrow('schema validation failed')
      expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(legacyManifest)
    })
  })

  // ---------------------------------------------------------------------------
  // readLockfileFile
  // ---------------------------------------------------------------------------

  describe('readLockfileFile', () => {
    it('returns null when file does not exist', () => {
      expect(readLockfileFile(join(tempDir, 'nonexistent.json'))).toBeNull()
    })

    it('returns null for invalid JSON', () => {
      const path = join(tempDir, 'lockfile.json')
      writeFileSync(path, 'not json', 'utf-8')
      expect(readLockfileFile(path)).toBeNull()
    })

    it('returns null when schema validation fails', () => {
      const path = join(tempDir, 'lockfile.json')
      writeFileSync(path, JSON.stringify({ invalid: true }), 'utf-8')
      expect(readLockfileFile(path)).toBeNull()
    })

    it('reads a valid v2 lockfile', () => {
      const path = join(tempDir, 'lockfile.json')
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
      writeFileSync(path, JSON.stringify(lockfile), 'utf-8')

      const result = readLockfileFile(path)
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
      const path = join(tempDir, 'lockfile.json')
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
      writeFileSync(path, JSON.stringify(legacyLockfile), 'utf-8')

      expect(readLockfileFile(path)).toBeNull()
      expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(legacyLockfile)
    })
  })

  // ---------------------------------------------------------------------------
  // writeLockfileFile
  // ---------------------------------------------------------------------------

  describe('writeLockfileFile', () => {
    it('creates parent directories if they do not exist', () => {
      const path = join(tempDir, 'nested', 'dir', 'lockfile.json')
      writeLockfileFile(path, { version: 2, packages: {} })
      expect(existsSync(path)).toBe(true)
    })

    it('writes valid JSON that can be read back', () => {
      const path = join(tempDir, 'lockfile.json')
      const lockfile = { version: 2 as const, packages: {} }
      writeLockfileFile(path, lockfile)

      const raw = readFileSync(path, 'utf-8')
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
  // verifyIntegrity
  // ---------------------------------------------------------------------------

  describe('verifyIntegrity', () => {
    it('does nothing when lockfile integrity is undefined', () => {
      expect(() => {
        verifyIntegrity([{ path: 'a.md', content: 'hello' }], undefined, 'org/skill')
      }).not.toThrow()
    })

    it('passes when computed integrity matches lockfile integrity', () => {
      const files = [{ path: 'a.md', content: 'hello' }]
      const integrity = computeIntegrity(files)

      expect(() => {
        verifyIntegrity(files, integrity, 'org/skill')
      }).not.toThrow()
    })

    it('throws IntegrityError when hashes do not match', () => {
      const files = [{ path: 'a.md', content: 'hello' }]

      expect(() => {
        verifyIntegrity(files, 'sha256-wrong', 'org/skill')
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
  // placeFiles
  // ---------------------------------------------------------------------------

  describe('placeFiles', () => {
    it('writes files to the correct agent skill directory', () => {
      mkdirSync(join(tempDir, '.claude'), { recursive: true })

      const files = [{ path: 'SKILL.md', content: '# Test Skill' }]
      const count = placeFiles(files, 'org/my-skill', ['claude-code'], tempDir)

      expect(count).toBe(1)

      const skillDir = join(tempDir, '.claude', 'skills', 'my-skill')
      expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true)
      expect(readFileSync(join(skillDir, 'SKILL.md'), 'utf-8')).toBe('# Test Skill')
    })

    it('writes files to multiple agents', () => {
      mkdirSync(join(tempDir, '.claude'), { recursive: true })
      mkdirSync(join(tempDir, '.cursor'), { recursive: true })

      const files = [{ path: 'SKILL.md', content: '# Test' }]
      const count = placeFiles(files, 'org/skill', ['claude-code', 'cursor'], tempDir)

      expect(count).toBe(2) // 1 file x 2 agents
    })

    it('skips unrecognised agent IDs', () => {
      const files = [{ path: 'SKILL.md', content: '# Test' }]
      const count = placeFiles(files, 'org/skill', ['nonexistent-agent-xyz'], tempDir)

      expect(count).toBe(0)
    })

    it('skips files that escape the target directory', () => {
      mkdirSync(join(tempDir, '.claude'), { recursive: true })

      const files = [
        { path: 'SKILL.md', content: '# Good' },
        { path: '../../../etc/passwd', content: 'evil' },
      ]
      const count = placeFiles(files, 'org/skill', ['claude-code'], tempDir)

      expect(count).toBe(1)
    })

    it('creates nested directories for files with subdirectories', () => {
      mkdirSync(join(tempDir, '.claude'), { recursive: true })

      const files = [{ path: 'sub/dir/file.md', content: '# Nested' }]
      const count = placeFiles(files, 'org/skill', ['claude-code'], tempDir)

      expect(count).toBe(1)
      const nestedPath = join(tempDir, '.claude', 'skills', 'skill', 'sub', 'dir', 'file.md')
      expect(existsSync(nestedPath)).toBe(true)
    })

    it('returns 0 when files array is empty', () => {
      mkdirSync(join(tempDir, '.claude'), { recursive: true })
      const count = placeFiles([], 'org/skill', ['claude-code'], tempDir)
      expect(count).toBe(0)
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
