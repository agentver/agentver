import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDownloadResponse,
  createInstallerConfig,
  createInstallResult,
  createLockfile,
  createManifest,
} from './helpers/fixtures'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
  debug: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
  summary: { addRaw: vi.fn().mockReturnThis(), write: vi.fn() },
}))

vi.mock('@agentver/agent-definitions', () => ({
  detectInstalledAgents: vi.fn(),
  getSkillPlacementPath: vi.fn(),
  resolveAgentId: vi.fn(),
}))

vi.mock('@agentver/shared', () => ({}))

describe('installer', () => {
  let fs: typeof import('node:fs')
  let core: typeof import('@actions/core')
  let agentDefs: typeof import('@agentver/agent-definitions')
  let installer: typeof import('../installer')

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    fs = await import('node:fs')
    core = await import('@actions/core')
    agentDefs = await import('@agentver/agent-definitions')
    installer = await import('../installer')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('readManifestFile', () => {
    it('returns parsed manifest when file exists', () => {
      const manifest = createManifest()
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(manifest))

      expect(installer.readManifestFile('/path/manifest.json')).toEqual(manifest)
    })

    it('throws ManifestNotFoundError when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      expect(() => installer.readManifestFile('/path/manifest.json')).toThrow(
        installer.ManifestNotFoundError
      )
    })

    it('throws Error when file contains invalid JSON', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('not-json')

      expect(() => installer.readManifestFile('/path/manifest.json')).toThrow('invalid JSON')
    })
  })

  describe('readLockfileFile', () => {
    it('returns parsed lockfile when file exists', () => {
      const lockfile = createLockfile()
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(lockfile))

      expect(installer.readLockfileFile('/path/lockfile.json')).toEqual(lockfile)
    })

    it('returns null when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      expect(installer.readLockfileFile('/path/lockfile.json')).toBeNull()
    })

    it('returns null when file contains invalid JSON', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('not-json')

      expect(installer.readLockfileFile('/path/lockfile.json')).toBeNull()
    })
  })

  describe('writeLockfileFile', () => {
    it('creates parent directory if it does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      installer.writeLockfileFile('/path/to/lockfile.json', createLockfile())
      expect(fs.mkdirSync).toHaveBeenCalledWith('/path/to', { recursive: true })
    })

    it('does not create directory if it already exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      installer.writeLockfileFile('/path/to/lockfile.json', createLockfile())
      expect(fs.mkdirSync).not.toHaveBeenCalled()
    })

    it('writes formatted JSON', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      const lockfile = createLockfile()

      installer.writeLockfileFile('/path/lockfile.json', lockfile)
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/path/lockfile.json',
        JSON.stringify(lockfile, null, 2),
        'utf-8'
      )
    })
  })

  describe('extractFilesFromManifest', () => {
    it('extracts files from array format', () => {
      const manifest = [
        { path: 'SKILL.md', content: '# Skill' },
        { path: 'lib.ts', content: 'export {}' },
      ] as unknown as Record<string, unknown>

      expect(installer.extractFilesFromManifest(manifest)).toEqual([
        { path: 'SKILL.md', content: '# Skill' },
        { path: 'lib.ts', content: 'export {}' },
      ])
    })

    it('extracts files from flat map format', () => {
      const manifest = {
        'SKILL.md': '# Skill',
        'lib.ts': 'export {}',
      }

      expect(installer.extractFilesFromManifest(manifest)).toEqual([
        { path: 'SKILL.md', content: '# Skill' },
        { path: 'lib.ts', content: 'export {}' },
      ])
    })

    it('filters out entries missing path or content in array format', () => {
      const manifest = [
        { path: 'SKILL.md', content: '# Skill' },
        { path: 'bad-entry' },
        { content: 'no-path' },
        null,
      ] as unknown as Record<string, unknown>

      expect(installer.extractFilesFromManifest(manifest)).toEqual([
        { path: 'SKILL.md', content: '# Skill' },
      ])
    })

    it('filters out non-string values in flat map format', () => {
      const manifest = {
        'SKILL.md': '# Skill',
        nested: { key: 'value' },
        number: 42,
      } as unknown as Record<string, unknown>

      expect(installer.extractFilesFromManifest(manifest)).toEqual([
        { path: 'SKILL.md', content: '# Skill' },
      ])
    })

    it('returns empty array for empty object', () => {
      expect(installer.extractFilesFromManifest({})).toEqual([])
    })
  })

  describe('computeIntegrity', () => {
    it('returns sha256-{base64hash} string', () => {
      const files = [{ path: 'a.md', content: 'hello' }]
      const result = installer.computeIntegrity(files)
      expect(result).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/)
    })

    it('sorts files by path before hashing', () => {
      const filesA = [
        { path: 'b.md', content: 'B' },
        { path: 'a.md', content: 'A' },
      ]
      const filesB = [
        { path: 'a.md', content: 'A' },
        { path: 'b.md', content: 'B' },
      ]

      expect(installer.computeIntegrity(filesA)).toBe(installer.computeIntegrity(filesB))
    })

    it('different content produces different hash', () => {
      const filesA = [{ path: 'a.md', content: 'hello' }]
      const filesB = [{ path: 'a.md', content: 'world' }]

      expect(installer.computeIntegrity(filesA)).not.toBe(installer.computeIntegrity(filesB))
    })

    it('empty file list produces consistent hash', () => {
      expect(installer.computeIntegrity([])).toBe(installer.computeIntegrity([]))
    })
  })

  describe('verifyIntegrity', () => {
    it('does nothing when lockfileIntegrity is undefined', () => {
      expect(() => {
        installer.verifyIntegrity([{ path: 'a', content: 'b' }], undefined, 'pkg')
      }).not.toThrow()
    })

    it('does nothing when integrity matches', () => {
      const files = [{ path: 'a.md', content: 'hello' }]
      const integrity = installer.computeIntegrity(files)

      expect(() => {
        installer.verifyIntegrity(files, integrity, 'pkg')
      }).not.toThrow()
    })

    it('throws IntegrityError when integrity does not match', () => {
      const files = [{ path: 'a.md', content: 'hello' }]

      expect(() => {
        installer.verifyIntegrity(files, 'sha256-wrong', 'pkg')
      }).toThrow(installer.IntegrityError)
    })
  })

  describe('detectAgents', () => {
    it('returns specified agents when non-empty array provided', () => {
      expect(installer.detectAgents('/dir', ['claude-code', 'cursor'])).toEqual([
        'claude-code',
        'cursor',
      ])
    })

    it('calls detectInstalledAgents and returns IDs when no agents specified', () => {
      vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([
        { id: 'claude-code', name: 'Claude Code', configDir: '.claude' },
      ] as ReturnType<typeof agentDefs.detectInstalledAgents>)

      expect(installer.detectAgents('/dir', [])).toEqual(['claude-code'])
    })
  })

  describe('placeFiles', () => {
    it('writes files to correct agent placement paths', () => {
      const files = [{ path: 'SKILL.md', content: '# Skill' }]
      vi.mocked(agentDefs.resolveAgentId).mockReturnValue(
        'claude-code' as ReturnType<typeof agentDefs.resolveAgentId>
      )
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/my-skill')
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const count = installer.placeFiles(files, 'org/my-skill', ['claude-code'], '/project')

      expect(count).toBe(1)
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        resolve('/project/.claude/skills/my-skill/SKILL.md'),
        '# Skill',
        'utf-8'
      )
    })

    it('skips files with .. in path', () => {
      const files = [{ path: '../../../etc/passwd', content: 'malicious' }]
      vi.mocked(agentDefs.resolveAgentId).mockReturnValue(
        'claude-code' as ReturnType<typeof agentDefs.resolveAgentId>
      )
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/my-skill')
      vi.mocked(fs.existsSync).mockReturnValue(true)

      const count = installer.placeFiles(files, 'org/my-skill', ['claude-code'], '/project')

      expect(count).toBe(0)
      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('path traversal'))
    })

    it('skips unrecognised agent IDs', () => {
      const files = [{ path: 'SKILL.md', content: '# Skill' }]
      vi.mocked(agentDefs.resolveAgentId).mockReturnValue(
        null as unknown as ReturnType<typeof agentDefs.resolveAgentId>
      )

      const count = installer.placeFiles(files, 'org/my-skill', ['unknown-agent'], '/project')

      expect(count).toBe(0)
      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Unrecognised'))
    })

    it('skips agents with no placement path', () => {
      const files = [{ path: 'SKILL.md', content: '# Skill' }]
      vi.mocked(agentDefs.resolveAgentId).mockReturnValue(
        'claude-code' as ReturnType<typeof agentDefs.resolveAgentId>
      )
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue(null)

      const count = installer.placeFiles(files, 'org/my-skill', ['claude-code'], '/project')

      expect(count).toBe(0)
      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('No placement path'))
    })

    it('creates directories recursively when missing', () => {
      const files = [{ path: 'sub/dir/SKILL.md', content: '# Skill' }]
      vi.mocked(agentDefs.resolveAgentId).mockReturnValue(
        'claude-code' as ReturnType<typeof agentDefs.resolveAgentId>
      )
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/my-skill')
      vi.mocked(fs.existsSync).mockReturnValue(false)

      installer.placeFiles(files, 'org/my-skill', ['claude-code'], '/project')

      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true })
    })
  })

  describe('updateLockfile', () => {
    it('adds successful results to lockfile with computed integrity', () => {
      const results = [
        createInstallResult({
          name: 'org/skill',
          version: '1.0.0',
          success: true,
          agents: ['claude-code'],
        }),
      ]
      const files = [{ path: 'SKILL.md', content: '# Skill' }]
      const response = createDownloadResponse({ version: '1.0.0' })
      const resolvedData = new Map([['org/skill', { response, files }]])

      const updated = installer.updateLockfile(
        createLockfile(),
        results,
        resolvedData,
        'https://reg.com/api/v1'
      )

      expect(updated.packages['org/skill']).toBeDefined()
      expect(updated.packages['org/skill']!.version).toBe('1.0.0')
      expect(updated.packages['org/skill']!.integrity).toMatch(/^sha256-/)
      expect(updated.packages['org/skill']!.resolved).toContain('/download')
    })

    it('skips failed results', () => {
      const results = [createInstallResult({ name: 'org/skill', success: false })]
      const resolvedData = new Map<
        string,
        {
          response: ReturnType<typeof createDownloadResponse>
          files: Array<{ path: string; content: string }>
        }
      >()

      const updated = installer.updateLockfile(
        createLockfile(),
        results,
        resolvedData,
        'https://reg.com/api/v1'
      )

      expect(updated.packages['org/skill']).toBeUndefined()
    })

    it('skips results with no resolved data', () => {
      const results = [createInstallResult({ name: 'org/skill', success: true })]
      const resolvedData = new Map<
        string,
        {
          response: ReturnType<typeof createDownloadResponse>
          files: Array<{ path: string; content: string }>
        }
      >()

      const updated = installer.updateLockfile(
        createLockfile(),
        results,
        resolvedData,
        'https://reg.com/api/v1'
      )

      expect(updated.packages['org/skill']).toBeUndefined()
    })

    it('preserves existing lockfile entries not in results', () => {
      const lockfile = createLockfile({
        packages: {
          'org/other': {
            version: '2.0.0',
            resolved: 'https://reg.com/api/v1/skills/org/other/2.0.0/download',
            integrity: 'sha256-existing',
            agents: ['cursor'],
          },
        },
      })
      const results = [
        createInstallResult({ name: 'org/skill', success: true, agents: ['claude-code'] }),
      ]
      const response = createDownloadResponse({ version: '1.0.0' })
      const files = [{ path: 'SKILL.md', content: '# Skill' }]
      const resolvedData = new Map([['org/skill', { response, files }]])

      const updated = installer.updateLockfile(
        lockfile,
        results,
        resolvedData,
        'https://reg.com/api/v1'
      )

      expect(updated.packages['org/other']).toBeDefined()
      expect(updated.packages['org/skill']).toBeDefined()
    })
  })

  describe('installAllPackages', () => {
    function mockFetchResponse(body: unknown, status = 200): void {
      vi.mocked(fetch).mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      } as Response)
    }

    it('installs all packages from manifest and returns results', async () => {
      const manifest = createManifest({
        packages: {
          'test-org/test-skill': {
            name: 'test-org/test-skill',
            version: '1.0.0',
            agents: ['claude-code'],
            installedAt: '2024-01-01T00:00:00.000Z',
          },
        },
      })
      const config = createInstallerConfig({ agents: ['claude-code'] })
      mockFetchResponse(createDownloadResponse())
      vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([])
      vi.mocked(agentDefs.resolveAgentId).mockReturnValue(
        'claude-code' as ReturnType<typeof agentDefs.resolveAgentId>
      )
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/test-skill')
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const { results } = await installer.installAllPackages(manifest, config, null)

      expect(results).toHaveLength(1)
      expect(results[0]!.success).toBe(true)
      expect(results[0]!.name).toBe('test-org/test-skill')
    })

    it('returns failed result when registry fetch fails', async () => {
      const manifest = createManifest({
        packages: {
          'test-org/test-skill': {
            name: 'test-org/test-skill',
            version: '1.0.0',
            agents: ['claude-code'],
            installedAt: '2024-01-01T00:00:00.000Z',
          },
        },
      })
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'))

      const { results } = await installer.installAllPackages(
        manifest,
        createInstallerConfig(),
        null
      )

      expect(results).toHaveLength(1)
      expect(results[0]!.success).toBe(false)
      expect(results[0]!.error).toContain('Network error')
    })

    it('returns failed result when package has no files', async () => {
      const manifest = createManifest({
        packages: {
          'test-org/test-skill': {
            name: 'test-org/test-skill',
            version: '1.0.0',
            agents: ['claude-code'],
            installedAt: '2024-01-01T00:00:00.000Z',
          },
        },
      })
      mockFetchResponse(createDownloadResponse({ fileManifest: {} }))

      const { results } = await installer.installAllPackages(
        manifest,
        createInstallerConfig(),
        null
      )

      expect(results).toHaveLength(1)
      expect(results[0]!.success).toBe(false)
      expect(results[0]!.error).toContain('no files')
    })

    it('continues installing remaining packages when one fails', async () => {
      const manifest = createManifest({
        packages: {
          'test-org/fail-skill': {
            name: 'test-org/fail-skill',
            version: '1.0.0',
            agents: ['claude-code'],
            installedAt: '2024-01-01T00:00:00.000Z',
          },
          'test-org/good-skill': {
            name: 'test-org/good-skill',
            version: '1.0.0',
            agents: ['claude-code'],
            installedAt: '2024-01-01T00:00:00.000Z',
          },
        },
      })
      const config = createInstallerConfig({ agents: ['claude-code'] })

      vi.mocked(fetch)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(createDownloadResponse()),
          text: () => Promise.resolve(''),
        } as Response)

      vi.mocked(agentDefs.resolveAgentId).mockReturnValue(
        'claude-code' as ReturnType<typeof agentDefs.resolveAgentId>
      )
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/good-skill')
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const { results } = await installer.installAllPackages(manifest, config, null)

      expect(results).toHaveLength(2)
      const failResult = results.find((r) => r.name === 'test-org/fail-skill')
      const goodResult = results.find((r) => r.name === 'test-org/good-skill')
      expect(failResult?.success).toBe(false)
      expect(goodResult?.success).toBe(true)
    })
  })
})
