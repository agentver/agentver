import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readLockfile, readManifest, writeLockfile, writeManifest } from '../storage'

describe('storage', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `agentver-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  // ---------------------------------------------------------------------------
  // readManifest
  // ---------------------------------------------------------------------------

  describe('readManifest', () => {
    it('returns an empty v2 manifest when no file exists', () => {
      const manifest = readManifest(tempDir)
      expect(manifest).toEqual({ version: 2, packages: {} })
    })

    it('returns an empty v2 manifest when the file contains invalid JSON', () => {
      const dir = join(tempDir, '.agentver')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'manifest.json'), '{not valid json}', 'utf-8')

      const manifest = readManifest(tempDir)
      expect(manifest).toEqual({ version: 2, packages: {} })
    })

    it('returns an empty v2 manifest when schema validation fails', () => {
      const dir = join(tempDir, '.agentver')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ foo: 'bar' }), 'utf-8')

      const manifest = readManifest(tempDir)
      expect(manifest).toEqual({ version: 2, packages: {} })
    })

    it('reads a valid v2 manifest', () => {
      const dir = join(tempDir, '.agentver')
      mkdirSync(dir, { recursive: true })

      const expected = {
        version: 2 as const,
        packages: {
          'org/skill': {
            source: {
              type: 'git' as const,
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

      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(expected), 'utf-8')

      const manifest = readManifest(tempDir)
      expect(manifest.version).toBe(2)
      expect(
        manifest.packages['git:https%3A%2F%2Fgithub.com%2Forg%2Frepo%23skills%2Fskill']
      ).toBeDefined()
      expect(
        manifest.packages['git:https%3A%2F%2Fgithub.com%2Forg%2Frepo%23skills%2Fskill']!.source.type
      ).toBe('git')
    })

    it('treats a legacy manifest schema as invalid local state', () => {
      const dir = join(tempDir, '.agentver')
      mkdirSync(dir, { recursive: true })

      const legacyManifest = {
        version: 1 as const,
        packages: {
          'org/skill': {
            name: 'org/skill',
            version: '1.0.0',
            agents: ['claude-code'],
            installedAt: new Date().toISOString(),
          },
        },
      }

      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(legacyManifest), 'utf-8')

      const manifest = readManifest(tempDir)
      expect(manifest).toEqual({ version: 2, packages: {} })

      const persisted = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'))
      expect(persisted).toEqual(legacyManifest)
    })
  })

  // ---------------------------------------------------------------------------
  // writeManifest
  // ---------------------------------------------------------------------------

  describe('writeManifest', () => {
    it('creates the .agentver directory if it does not exist', () => {
      const manifest = { version: 2 as const, packages: {} }
      writeManifest(tempDir, manifest)

      expect(existsSync(join(tempDir, '.agentver', 'manifest.json'))).toBe(true)
    })

    it('writes valid JSON that can be read back', () => {
      const manifest = { version: 2 as const, packages: {} }
      writeManifest(tempDir, manifest)

      const raw = readFileSync(join(tempDir, '.agentver', 'manifest.json'), 'utf-8')
      expect(JSON.parse(raw)).toEqual(manifest)
    })
  })

  // ---------------------------------------------------------------------------
  // readLockfile
  // ---------------------------------------------------------------------------

  describe('readLockfile', () => {
    it('returns an empty v2 lockfile when no file exists', () => {
      const lockfile = readLockfile(tempDir)
      expect(lockfile).toEqual({ version: 2, packages: {} })
    })

    it('returns an empty v2 lockfile when the file contains invalid JSON', () => {
      const dir = join(tempDir, '.agentver')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'lockfile.json'), 'broken', 'utf-8')

      const lockfile = readLockfile(tempDir)
      expect(lockfile).toEqual({ version: 2, packages: {} })
    })

    it('returns an empty v2 lockfile when schema validation fails', () => {
      const dir = join(tempDir, '.agentver')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'lockfile.json'), JSON.stringify({ invalid: true }), 'utf-8')

      const lockfile = readLockfile(tempDir)
      expect(lockfile).toEqual({ version: 2, packages: {} })
    })

    it('reads a valid v2 lockfile', () => {
      const dir = join(tempDir, '.agentver')
      mkdirSync(dir, { recursive: true })

      const expected = {
        version: 2 as const,
        packages: {
          'org/skill': {
            source: {
              type: 'git' as const,
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

      writeFileSync(join(dir, 'lockfile.json'), JSON.stringify(expected), 'utf-8')

      const lockfile = readLockfile(tempDir)
      expect(lockfile.version).toBe(2)
      expect(
        lockfile.packages['git:https%3A%2F%2Fgithub.com%2Forg%2Frepo%23skills%2Fskill']
      ).toBeDefined()
    })

    it('treats a legacy lockfile schema as invalid local state', () => {
      const dir = join(tempDir, '.agentver')
      mkdirSync(dir, { recursive: true })

      const legacyLockfile = {
        version: 1 as const,
        packages: {
          'org/skill': {
            version: '1.0.0',
            resolved: 'https://example.com/package.tar.gz',
            integrity: 'sha256-abc',
            agents: ['claude-code'],
          },
        },
      }

      writeFileSync(join(dir, 'lockfile.json'), JSON.stringify(legacyLockfile), 'utf-8')

      const lockfile = readLockfile(tempDir)
      expect(lockfile).toEqual({ version: 2, packages: {} })

      const persisted = JSON.parse(readFileSync(join(dir, 'lockfile.json'), 'utf-8'))
      expect(persisted).toEqual(legacyLockfile)
    })
  })

  // ---------------------------------------------------------------------------
  // writeLockfile
  // ---------------------------------------------------------------------------

  describe('writeLockfile', () => {
    it('creates the .agentver directory if it does not exist', () => {
      const lockfile = { version: 2 as const, packages: {} }
      writeLockfile(tempDir, lockfile)

      expect(existsSync(join(tempDir, '.agentver', 'lockfile.json'))).toBe(true)
    })

    it('writes valid JSON that can be read back', () => {
      const lockfile = { version: 2 as const, packages: {} }
      writeLockfile(tempDir, lockfile)

      const raw = readFileSync(join(tempDir, '.agentver', 'lockfile.json'), 'utf-8')
      expect(JSON.parse(raw)).toEqual(lockfile)
    })
  })
})
