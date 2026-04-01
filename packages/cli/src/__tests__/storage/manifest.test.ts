import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  rmSync: vi.fn(),
}))

vi.mock('@agentver/shared', async () => {
  const actual = await vi.importActual<typeof import('@agentver/shared')>('@agentver/shared')
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }
})

vi.mock('../../storage/file-lock', () => ({
  withStorageLock: <T>(_projectRoot: string, _scope: string, callback: () => T) => callback(),
}))

describe('storage/manifest', () => {
  const CURRENT_VERSION = 2
  let fs: typeof import('node:fs')
  let manifestModule: typeof import('../../storage/manifest')

  beforeEach(async () => {
    vi.clearAllMocks()
    fs = await import('node:fs')
    manifestModule = await import('../../storage/manifest')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('readManifest', () => {
    it('returns empty manifest when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = manifestModule.readManifest('/project')
      expect(result).toEqual({ version: CURRENT_VERSION, packages: {} })
    })

    it('returns empty manifest when file contains invalid JSON', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('not-json')

      const result = manifestModule.readManifest('/project')
      expect(result).toEqual({ version: CURRENT_VERSION, packages: {} })
    })

    it('reads a valid v2 manifest', () => {
      const stableKey = `git:${encodeURIComponent('https://github.com/org/repo#skills/my-skill#main')}`
      const validManifest = {
        version: 2,
        packages: {
          [stableKey]: {
            name: 'my-skill',
            source: {
              type: 'git',
              uri: 'https://github.com/org/repo',
              path: 'skills/my-skill',
              ref: 'main',
              commit: 'abc1234567',
            },
            agents: ['claude'],
            installedAt: '2024-01-01T00:00:00.000Z',
            modified: false,
          },
        },
      }

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(validManifest))

      const result = manifestModule.readManifest('/project')
      expect(result.version).toBe(CURRENT_VERSION)
      expect(result.packages[stableKey]).toBeDefined()
    })

    it('returns empty manifest when schema validation fails', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: 99, invalid: true }))

      const result = manifestModule.readManifest('/project')
      expect(result).toEqual({ version: CURRENT_VERSION, packages: {} })
    })

    it('reads a manifest with multiple source types', () => {
      const gitKey = `git:${encodeURIComponent('github.com/a/b##main')}`
      const wkKey = `well-known:${encodeURIComponent('https://example.com#skill-b')}`
      const manifest = {
        version: 2,
        packages: {
          [gitKey]: {
            name: 'skill-a',
            source: {
              type: 'git',
              uri: 'github.com/a/b',
              path: '',
              ref: 'main',
              commit: 'abc1234567890abcdef1234567890abcdef123456',
            },
            agents: ['claude-code'],
            installedAt: '2025-06-01T00:00:00.000Z',
            modified: false,
          },
          [wkKey]: {
            name: 'skill-b',
            source: {
              type: 'well-known',
              baseUrl: 'https://example.com',
              hostname: 'example.com',
              skillName: 'skill-b',
            },
            agents: ['cursor'],
            installedAt: '2025-06-02T00:00:00.000Z',
            modified: false,
          },
        },
      }

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(manifest))

      const result = manifestModule.readManifest('/project')

      expect(result.version).toBe(CURRENT_VERSION)
      expect(Object.keys(result.packages)).toHaveLength(2)
      expect(result.packages[gitKey]).toBeDefined()
      expect(result.packages[wkKey]).toBeDefined()
    })
  })

  describe('writeManifest', () => {
    it('creates directory if it does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      manifestModule.writeManifest('/project', { version: CURRENT_VERSION, packages: {} })

      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('.agentver'), {
        recursive: true,
      })
    })

    it('writes to a temp file then renames atomically', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      manifestModule.writeManifest('/project', { version: CURRENT_VERSION, packages: {} })

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('.tmp'),
        expect.any(String)
      )
      expect(fs.renameSync).toHaveBeenCalledWith(
        expect.stringContaining('.tmp'),
        expect.stringContaining('manifest.json')
      )
    })

    it('writes deterministically sorted JSON', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      const manifest = {
        version: 2 as const,
        packages: {
          'z-skill': {
            source: {
              type: 'git' as const,
              uri: 'https://github.com/org/repo',
              path: '',
              ref: 'main',
              commit: 'abc1234567',
            },
            agents: ['claude'],
            installedAt: '2024-01-01T00:00:00.000Z',
            modified: false,
          },
          'a-skill': {
            source: {
              type: 'git' as const,
              uri: 'https://github.com/org/repo2',
              path: '',
              ref: 'main',
              commit: 'def1234567',
            },
            agents: ['cursor'],
            installedAt: '2024-01-01T00:00:00.000Z',
            modified: false,
          },
        },
      }

      manifestModule.writeManifest('/project', manifest)

      const written = vi.mocked(fs.writeFileSync).mock.calls[0]![1] as string
      // Keys should be sorted — a-skill before z-skill
      const aIdx = written.indexOf('a-skill')
      const zIdx = written.indexOf('z-skill')
      expect(aIdx).toBeLessThan(zIdx)
    })

    it('crash during write does not corrupt the manifest — rename never fires', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      vi.mocked(fs.writeFileSync).mockImplementationOnce(() => {
        throw new Error('disk full')
      })

      expect(() =>
        manifestModule.writeManifest('/project', { version: CURRENT_VERSION, packages: {} })
      ).toThrow('disk full')

      // The rename should never execute, so the original manifest is preserved
      expect(fs.renameSync).not.toHaveBeenCalled()
    })

    it('rename target is manifest.json, not the tmp file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      manifestModule.writeManifest('/project', { version: CURRENT_VERSION, packages: {} })

      const renameCall = vi.mocked(fs.renameSync).mock.calls[0]!
      const sourcePath = renameCall[0] as string
      const targetPath = renameCall[1] as string

      expect(sourcePath).toContain('.tmp')
      expect(targetPath).toContain('manifest.json')
      expect(targetPath).not.toContain('.tmp')
    })
  })

  describe('updateManifest', () => {
    it('updates the current manifest and returns the written value', () => {
      const existingKey = `git:${encodeURIComponent('github.com/org/repo##main')}`
      const existingManifest = {
        version: 2 as const,
        packages: {
          [existingKey]: {
            name: 'existing',
            source: {
              type: 'git' as const,
              uri: 'github.com/org/repo',
              path: '',
              ref: 'main',
              commit: 'abc1234567890abcdef1234567890abcdef123456',
            },
            agents: ['claude-code'],
            installedAt: '2025-01-01T00:00:00.000Z',
            modified: false,
          },
        },
      }

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingManifest))

      const addedKey = `git:${encodeURIComponent('github.com/org/repo#skills/added#main')}`
      const result = manifestModule.updateManifest('/project', 'project', (manifest) => ({
        ...manifest,
        packages: {
          ...manifest.packages,
          [addedKey]: {
            name: 'added',
            source: {
              type: 'git',
              uri: 'github.com/org/repo',
              path: 'skills/added',
              ref: 'main',
              commit: 'def1234567890abcdef1234567890abcdef123456',
            },
            agents: ['cursor'],
            installedAt: '2025-01-02T00:00:00.000Z',
            modified: false,
          },
        },
      }))

      expect(result.packages[addedKey]).toBeDefined()

      const written = vi.mocked(fs.writeFileSync).mock.calls.at(-1)![1] as string
      expect(JSON.parse(written)).toEqual(result)
    })
  })

  describe('scope-aware paths', () => {
    it('writes to project .agentver/ when scope is project', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      manifestModule.writeManifest(
        '/my-project',
        { version: CURRENT_VERSION, packages: {} },
        'project'
      )

      expect(fs.mkdirSync).toHaveBeenCalledWith(join('/my-project', '.agentver'), {
        recursive: true,
      })
    })

    it('writes to ~/.agentver/ when scope is global', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      manifestModule.writeManifest(
        '/my-project',
        { version: CURRENT_VERSION, packages: {} },
        'global'
      )

      expect(fs.mkdirSync).toHaveBeenCalledWith(join(homedir(), '.agentver'), { recursive: true })
    })

    it('reads from ~/.agentver/ when scope is global', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      manifestModule.readManifest('/my-project', 'global')

      expect(fs.existsSync).toHaveBeenCalledWith(join(homedir(), '.agentver', 'manifest.json'))
    })

    it('defaults to project scope when scope parameter is omitted', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      manifestModule.readManifest('/my-project')

      expect(fs.existsSync).toHaveBeenCalledWith(join('/my-project', '.agentver', 'manifest.json'))
    })
  })
})
