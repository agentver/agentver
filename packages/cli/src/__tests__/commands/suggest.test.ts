import { createCLIOutputSchema, proposalsResultSchema, proposeResultSchema } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createCredentials,
  createLockfile,
  createLockfilePackage,
  createManifest,
  createManifestPackage,
  createSharedGitSource,
  createWellKnownSource,
} from '../helpers/fixtures'
import type { PlatformMockHandle } from '../helpers/mock-platform'
import { mockFetchResponse, setupPlatformMock } from '../helpers/mock-platform'

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../../storage/manifest.js', () => ({
  readManifest: vi.fn(),
}))

vi.mock('../../storage/lockfile.js', () => ({
  readLockfile: vi.fn(),
}))

vi.mock('../../storage/integrity.js', () => ({
  computeSha256FromFiles: vi.fn(),
}))

vi.mock('../../registry/auth.js', () => ({
  getCredentials: vi.fn(),
  isAuthenticated: vi.fn(),
}))

vi.mock('../../registry/config.js', () => ({
  getPlatformUrl: vi.fn(),
  readConfig: vi.fn(),
}))

vi.mock('../../git/fetcher.js', () => ({
  readFilesFromDirectory: vi.fn(),
}))

vi.mock('@agentver/agent-definitions', () => ({
  getSkillPlacementPath: vi.fn(),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}))

vi.mock('../../output.js', () => ({
  isJSONMode: vi.fn().mockReturnValue(false),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
  createSpinner: vi.fn(),
}))

// ---------------------------------------------------------------------------
// SUT imports (after mocks)
// ---------------------------------------------------------------------------

import { existsSync } from 'node:fs'
import * as agentDefs from '@agentver/agent-definitions'
import { Command } from 'commander'
import { registerSuggestCommand } from '../../commands/suggest'
import { registerSuggestionsCommand } from '../../commands/suggestions'
import * as fetcherModule from '../../git/fetcher.js'
import * as outputModule from '../../output.js'
import * as authModule from '../../registry/auth.js'
import * as configModule from '../../registry/config.js'
import * as integrityModule from '../../storage/integrity.js'
import * as lockfileModule from '../../storage/lockfile.js'
import * as manifestModule from '../../storage/manifest.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createNoopSpinner() {
  return {
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    text: '',
  }
}

function createSuggestProgram(): Command {
  const program = new Command()
  program.exitOverride()
  registerSuggestCommand(program)
  return program
}

function createSuggestionsProgram(): Command {
  const program = new Command()
  program.exitOverride()
  registerSuggestionsCommand(program)
  return program
}

async function runSuggest(args: string[]): Promise<void> {
  const program = createSuggestProgram()
  await program.parseAsync(['node', 'agentver', ...args])
}

async function runSuggestions(args: string[]): Promise<void> {
  const program = createSuggestionsProgram()
  await program.parseAsync(['node', 'agentver', ...args])
}

function setupSuggestMocks() {
  const source = createSharedGitSource({ uri: 'github.com/test-org/skills' })
  vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
  vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())
  vi.mocked(manifestModule.readManifest).mockReturnValue(
    createManifest({
      packages: {
        'my-skill': createManifestPackage({ source }),
      },
    })
  )
  vi.mocked(lockfileModule.readLockfile).mockReturnValue(
    createLockfile({
      packages: {
        'my-skill': createLockfilePackage({
          source,
          integrity: 'sha256-originalHash',
        }),
      },
    })
  )
  // Return different hash to simulate modification
  vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue('sha256-modifiedHash')

  vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/my-skill')
  vi.mocked(existsSync).mockReturnValue(true)
  vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue([
    { path: 'SKILL.md', content: '# Modified skill content', size: 25 },
  ])
}

// ---------------------------------------------------------------------------
// Tests — suggest (create)
// ---------------------------------------------------------------------------

describe('commands/suggest', () => {
  const originalCwd = process.cwd
  const originalArgv = process.argv
  const originalExit = process.exit
  let platformMock: PlatformMockHandle

  beforeEach(() => {
    vi.clearAllMocks()
    process.cwd = vi.fn().mockReturnValue('/project')
    process.argv = ['node', 'agentver', 'suggest']
    process.exit = vi.fn() as never

    vi.mocked(outputModule.createSpinner).mockReturnValue(createNoopSpinner() as never)
    vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

    platformMock = setupPlatformMock()
  })

  afterEach(() => {
    process.cwd = originalCwd
    process.argv = originalArgv
    process.exit = originalExit
    vi.unstubAllGlobals()
  })

  // -----------------------------------------------------------------------
  // suggest create — happy path
  // -----------------------------------------------------------------------

  describe('suggest create', () => {
    it('reads local files and POSTs suggestion to platform', async () => {
      setupSuggestMocks()

      platformMock.addRoute({
        method: 'POST',
        path: /\/suggestions$/,
        handler: () =>
          mockFetchResponse(200, {
            id: 'sug-123',
            title: 'Fix typo',
            url: 'https://app.agentver.com/suggestions/sug-123',
          }),
      })

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'suggest', '--json']

      await runSuggest(['suggest', 'Fix typo'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.proposalId).toBe('sug-123')
      expect(typed.title).toBe('Fix typo')
    })
  })

  // -----------------------------------------------------------------------
  // suggest --description flag
  // -----------------------------------------------------------------------

  describe('suggest --description flag', () => {
    it('includes description in the suggestion request', async () => {
      setupSuggestMocks()
      let capturedBody: Record<string, unknown> | undefined

      platformMock.addRoute({
        method: 'POST',
        path: /\/suggestions$/,
        handler: (_url, init) => {
          capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>
          return mockFetchResponse(200, {
            id: 'sug-456',
            title: 'Fix typo',
          })
        },
      })

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'suggest', '--json']

      await runSuggest(['suggest', 'Fix typo', '--description', 'Corrected a spelling mistake'])

      expect(capturedBody).toBeDefined()
      expect(capturedBody!.description).toBe('Corrected a spelling mistake')
    })
  })

  // -----------------------------------------------------------------------
  // suggest --dry-run
  // -----------------------------------------------------------------------

  describe('suggest --dry-run', () => {
    it('shows what would be sent without submitting', async () => {
      setupSuggestMocks()

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'suggest', '--json']

      await runSuggest(['suggest', 'Fix typo', '--dry-run'])

      // Should not call fetch for the submission
      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Array<Record<string, unknown>>
      expect(typed).toHaveLength(1)
      expect(typed[0]!.package).toBe('my-skill')
      expect(typed[0]!.title).toBe('Fix typo')
    })
  })

  // -----------------------------------------------------------------------
  // suggest --json output
  // -----------------------------------------------------------------------

  describe('suggest --json output', () => {
    it('validates against proposeResultSchema', async () => {
      setupSuggestMocks()

      platformMock.addRoute({
        method: 'POST',
        path: /\/suggestions$/,
        handler: () =>
          mockFetchResponse(200, {
            id: 'sug-789',
            title: 'Fix typo',
            url: 'https://app.agentver.com/suggestions/sug-789',
          }),
      })

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'suggest', '--json']

      await runSuggest(['suggest', 'Fix typo'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const envelope = { success: true, data }
      const outputSchema = createCLIOutputSchema(proposeResultSchema)
      const result = outputSchema.safeParse(envelope)
      expect(result.success).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // suggest — not authenticated
  // -----------------------------------------------------------------------

  describe('suggest not authenticated', () => {
    it('outputs AUTH_REQUIRED error when not connected', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue(null)
      vi.mocked(authModule.getCredentials).mockResolvedValue(null)
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())
      vi.mocked(lockfileModule.readLockfile).mockReturnValue(createLockfile())

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'suggest', '--json']

      await runSuggest(['suggest', 'Fix typo'])

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'AUTH_REQUIRED',
        expect.stringContaining('Not connected')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -----------------------------------------------------------------------
  // suggest — no modified packages
  // -----------------------------------------------------------------------

  describe('suggest no changes', () => {
    it('outputs NO_CHANGES error when no packages are modified', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: { 'my-skill': createManifestPackage() },
        })
      )
      vi.mocked(lockfileModule.readLockfile).mockReturnValue(
        createLockfile({
          packages: {
            'my-skill': createLockfilePackage({ integrity: 'sha256-same' }),
          },
        })
      )
      // Return the same hash — not modified
      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue('sha256-same')
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/my-skill')
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue([
        { path: 'SKILL.md', content: '# Unchanged', size: 12 },
      ])

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'suggest', '--json']

      await runSuggest(['suggest', 'No change'])

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'NO_CHANGES',
        expect.stringContaining('No modified')
      )
    })
  })

  // -----------------------------------------------------------------------
  // suggest --name flag
  // -----------------------------------------------------------------------

  describe('suggest --name flag', () => {
    it('only submits the named package when --name is specified', async () => {
      const sourceA = createSharedGitSource({ uri: 'github.com/org/repo-a' })
      const sourceB = createSharedGitSource({ uri: 'github.com/org/repo-b' })

      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'skill-a': createManifestPackage({ source: sourceA }),
            'skill-b': createManifestPackage({ source: sourceB }),
          },
        })
      )
      vi.mocked(lockfileModule.readLockfile).mockReturnValue(
        createLockfile({
          packages: {
            'skill-a': createLockfilePackage({ source: sourceA, integrity: 'sha256-originalA' }),
            'skill-b': createLockfilePackage({ source: sourceB, integrity: 'sha256-originalB' }),
          },
        })
      )
      // Both packages are modified
      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue('sha256-modifiedHash')
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/test')
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue([
        { path: 'SKILL.md', content: '# Modified', size: 10 },
      ])

      const postedPackages: string[] = []
      platformMock.addRoute({
        method: 'POST',
        path: /\/suggestions$/,
        handler: (url) => {
          // Extract package name from URL: /skills/@org/<package>/suggestions
          const match = url.match(/\/skills\/@[^/]+\/([^/]+)\/suggestions/)
          if (match) postedPackages.push(match[1]!)
          return mockFetchResponse(200, { id: 'sug-a', title: 'Fix typo' })
        },
      })

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'suggest', '--json']

      await runSuggest(['suggest', 'Fix typo', '--name', 'skill-a'])

      expect(postedPackages).toEqual(['skill-a'])
    })

    it('outputs NOT_FOUND when --name does not match any modified package', async () => {
      setupSuggestMocks()

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'suggest', '--json']

      await runSuggest(['suggest', 'Fix typo', '--name', 'nonexistent'])

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'NOT_FOUND',
        expect.stringContaining('nonexistent')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -----------------------------------------------------------------------
  // suggest — well-known source rejection
  // -----------------------------------------------------------------------

  describe('suggest well-known source rejection', () => {
    it('rejects well-known source packages as unsupported', async () => {
      const wkSource = createWellKnownSource()

      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'wk-skill': createManifestPackage({ source: wkSource }),
          },
        })
      )
      vi.mocked(lockfileModule.readLockfile).mockReturnValue(
        createLockfile({
          packages: {
            'wk-skill': createLockfilePackage({
              source: wkSource,
              integrity: 'sha256-originalHash',
            }),
          },
        })
      )
      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue('sha256-modifiedHash')
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/wk-skill')
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue([
        { path: 'SKILL.md', content: '# Modified well-known skill', size: 28 },
      ])

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'suggest', '--json']

      await runSuggest(['suggest', 'Improve docs'])

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'UNSUPPORTED_SOURCE',
        expect.stringContaining('well-known source')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -----------------------------------------------------------------------
  // suggest — multiple modified packages
  // -----------------------------------------------------------------------

  describe('suggest multiple modified packages', () => {
    function setupMultiPackageMocks() {
      const sourceA = createSharedGitSource({ uri: 'github.com/org/repo-a' })
      const sourceB = createSharedGitSource({ uri: 'github.com/org/repo-b' })

      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'skill-a': createManifestPackage({ source: sourceA }),
            'skill-b': createManifestPackage({ source: sourceB }),
          },
        })
      )
      vi.mocked(lockfileModule.readLockfile).mockReturnValue(
        createLockfile({
          packages: {
            'skill-a': createLockfilePackage({ source: sourceA, integrity: 'sha256-originalA' }),
            'skill-b': createLockfilePackage({ source: sourceB, integrity: 'sha256-originalB' }),
          },
        })
      )
      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue('sha256-modifiedHash')
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/test')
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue([
        { path: 'SKILL.md', content: '# Modified', size: 10 },
      ])
    }

    it('submits suggestions for all modified packages', async () => {
      setupMultiPackageMocks()

      platformMock.addRoute({
        method: 'POST',
        path: /\/suggestions$/,
        handler: (url) => {
          const match = url.match(/\/skills\/@[^/]+\/([^/]+)\/suggestions/)
          const pkg = match?.[1] ?? 'unknown'
          return mockFetchResponse(200, {
            id: `sug-${pkg}`,
            title: 'Fix typo',
            url: `https://app.agentver.com/suggestions/sug-${pkg}`,
          })
        },
      })

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'suggest', '--json']

      await runSuggest(['suggest', 'Fix typo'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Array<{ package: string; success: boolean }>
      expect(typed).toHaveLength(2)
      expect(typed.every((o) => o.success)).toBe(true)
      const packageNames = typed.map((o) => o.package).sort()
      expect(packageNames).toEqual(['skill-a', 'skill-b'])
    })

    it('reports mixed outcomes when some submissions fail', async () => {
      setupMultiPackageMocks()

      platformMock.addRoute({
        method: 'POST',
        path: /\/suggestions$/,
        handler: (url) => {
          if (url.includes('skill-a')) {
            return mockFetchResponse(200, {
              id: 'sug-a',
              title: 'Fix typo',
              url: 'https://app.agentver.com/suggestions/sug-a',
            })
          }
          // skill-b fails
          return mockFetchResponse(500, 'Internal server error')
        },
      })

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'suggest', '--json']

      await runSuggest(['suggest', 'Fix typo'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Array<{ package: string; success: boolean; error?: string }>
      expect(typed).toHaveLength(2)

      const succeeded = typed.filter((o) => o.success)
      const failed = typed.filter((o) => !o.success)
      expect(succeeded).toHaveLength(1)
      expect(failed).toHaveLength(1)
      expect(failed[0]!.error).toBeDefined()
    })
  })

  // -----------------------------------------------------------------------
  // suggest — platform POST failure (single target)
  // -----------------------------------------------------------------------

  describe('suggest platform POST failure', () => {
    it('reports SUGGEST_FAILED when platform POST throws', async () => {
      setupSuggestMocks()

      platformMock.addRoute({
        method: 'POST',
        path: /\/suggestions$/,
        handler: () => mockFetchResponse(500, 'Internal server error'),
      })

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'suggest', '--json']

      await runSuggest(['suggest', 'Fix typo'])

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'SUGGEST_FAILED',
        expect.stringContaining('500')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })
})

// ---------------------------------------------------------------------------
// Tests — suggestions (list)
// ---------------------------------------------------------------------------

describe('commands/suggestions', () => {
  const originalCwd = process.cwd
  const originalArgv = process.argv
  const originalExit = process.exit
  let platformMock: PlatformMockHandle

  beforeEach(() => {
    vi.clearAllMocks()
    process.cwd = vi.fn().mockReturnValue('/project')
    process.argv = ['node', 'agentver', 'suggestions']
    process.exit = vi.fn() as never

    vi.mocked(outputModule.createSpinner).mockReturnValue(createNoopSpinner() as never)
    vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

    platformMock = setupPlatformMock()
  })

  afterEach(() => {
    process.cwd = originalCwd
    process.argv = originalArgv
    process.exit = originalExit
    vi.unstubAllGlobals()
  })

  // -----------------------------------------------------------------------
  // suggestions list — happy path
  // -----------------------------------------------------------------------

  describe('suggestions list happy path', () => {
    it('lists suggestions with status from platform', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())

      platformMock.addRoute({
        method: 'GET',
        path: /\/proposals/,
        handler: () =>
          mockFetchResponse(200, {
            suggestions: [
              {
                id: 'sug-1',
                title: 'Fix typo',
                packageSlug: 'my-skill',
                status: 'OPEN',
                author: 'testuser',
                createdAt: '2025-01-15T10:30:00.000Z',
              },
            ],
          }),
      })

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'suggestions', '--json']

      await runSuggestions(['suggestions'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as { proposals: Array<Record<string, unknown>> }
      expect(typed.proposals).toHaveLength(1)
      expect(typed.proposals[0]!.id).toBe('sug-1')
      expect(typed.proposals[0]!.status).toBe('OPEN')
    })
  })

  // -----------------------------------------------------------------------
  // suggestions --status filter
  // -----------------------------------------------------------------------

  describe('suggestions --status filter', () => {
    it('passes status filter to platform query', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())

      let capturedUrl = ''
      platformMock.addRoute({
        method: 'GET',
        path: /\/proposals/,
        handler: (url) => {
          capturedUrl = url
          return mockFetchResponse(200, { suggestions: [] })
        },
      })

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'suggestions', '--json']

      await runSuggestions(['suggestions', '--status', 'merged'])

      expect(capturedUrl).toContain('status=MERGED')
    })
  })

  // -----------------------------------------------------------------------
  // suggestions — empty
  // -----------------------------------------------------------------------

  describe('suggestions empty list', () => {
    it('returns empty proposals array when no suggestions found', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())

      platformMock.addRoute({
        method: 'GET',
        path: /\/proposals/,
        handler: () => mockFetchResponse(200, { suggestions: [] }),
      })

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'suggestions', '--json']

      await runSuggestions(['suggestions'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as { proposals: unknown[] }
      expect(typed.proposals).toHaveLength(0)
    })
  })

  // -----------------------------------------------------------------------
  // suggestions --json output validates against proposalsResultSchema
  // -----------------------------------------------------------------------

  describe('suggestions --json output', () => {
    it('validates against proposalsResultSchema', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())

      platformMock.addRoute({
        method: 'GET',
        path: /\/proposals/,
        handler: () =>
          mockFetchResponse(200, {
            suggestions: [
              {
                id: 'sug-2',
                title: 'Add example',
                packageSlug: 'other-skill',
                status: 'MERGED',
                author: 'testuser',
                createdAt: '2025-02-01T12:00:00.000Z',
              },
            ],
          }),
      })

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'suggestions', '--json']

      await runSuggestions(['suggestions'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const envelope = { success: true, data }
      const outputSchema = createCLIOutputSchema(proposalsResultSchema)
      const result = outputSchema.safeParse(envelope)
      expect(result.success).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // suggestions — not authenticated
  // -----------------------------------------------------------------------

  describe('suggestions not authenticated', () => {
    it('outputs AUTH_REQUIRED error when not connected', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue(null)
      vi.mocked(authModule.getCredentials).mockResolvedValue(null)

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'suggestions', '--json']

      await runSuggestions(['suggestions'])

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'AUTH_REQUIRED',
        expect.stringContaining('Not connected')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -----------------------------------------------------------------------
  // suggestions — platform fetch error
  // -----------------------------------------------------------------------

  describe('suggestions platform fetch error', () => {
    it('outputs FETCH_FAILED when platform request fails', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())

      platformMock.addRoute({
        method: 'GET',
        path: /\/proposals/,
        handler: () => mockFetchResponse(500, 'Internal server error'),
      })

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'suggestions', '--json']

      await runSuggestions(['suggestions'])

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'FETCH_FAILED',
        expect.stringContaining('500')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -----------------------------------------------------------------------
  // suggestions --status all filter
  // -----------------------------------------------------------------------

  describe('suggestions --status all filter', () => {
    it('does not send status filter when --status is all', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())

      let capturedUrl = ''
      platformMock.addRoute({
        method: 'GET',
        path: /\/proposals/,
        handler: (url) => {
          capturedUrl = url
          return mockFetchResponse(200, { suggestions: [] })
        },
      })

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'suggestions', '--json']

      await runSuggestions(['suggestions', '--status', 'all'])

      expect(capturedUrl).not.toContain('status=')
    })
  })

  // -----------------------------------------------------------------------
  // suggestions — package name filter
  // -----------------------------------------------------------------------

  describe('suggestions package name filter', () => {
    it('sends package filter when name argument is provided', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())

      let capturedUrl = ''
      platformMock.addRoute({
        method: 'GET',
        path: /\/proposals/,
        handler: (url) => {
          capturedUrl = url
          return mockFetchResponse(200, { suggestions: [] })
        },
      })

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'suggestions', '--json']

      await runSuggestions(['suggestions', 'my-skill'])

      expect(capturedUrl).toContain('package=my-skill')
    })
  })
})
