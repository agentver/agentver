import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module-level mocks — must be declared before any import of the SUT
// ---------------------------------------------------------------------------

vi.mock('../../registry/client', () => ({
  registryFetch: vi.fn(),
}))

vi.mock('../../registry/config', () => ({
  isConnected: vi.fn(),
  getPlatformUrl: vi.fn(),
  readConfig: vi.fn(),
}))

vi.mock('../../registry/skills-sh', () => ({
  searchSkillsSh: vi.fn(),
  toGitInstallSource: vi.fn(),
}))

vi.mock('../../wellknown/index.js', () => ({
  fetchWellKnownIndex: vi.fn(),
}))

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    text: '',
  })),
}))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import { registerSearchCommand } from '../../commands/search'

// ---------------------------------------------------------------------------
// Mock module imports (typed references)
// ---------------------------------------------------------------------------

import * as clientModule from '../../registry/client'
import * as configModule from '../../registry/config'
import * as skillsShModule from '../../registry/skills-sh'
import * as wellKnownModule from '../../wellknown/index.js'

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

describe('search command', () => {
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()

    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function createProgram(): InstanceType<typeof Command> {
    const program = new Command()
    program.exitOverride()
    registerSearchCommand(program)
    return program
  }

  async function runSearch(...args: string[]): Promise<void> {
    const program = createProgram()
    await program.parseAsync(['node', 'agentver', 'search', ...args])
  }

  // ---------------------------------------------------------------------------
  // Happy path: combined results from platform + skills.sh
  // ---------------------------------------------------------------------------

  describe('happy path', () => {
    it('returns combined results from platform and skills.sh when source is all', async () => {
      vi.mocked(configModule.isConnected).mockResolvedValue(true)

      vi.mocked(clientModule.registryFetch).mockResolvedValue({
        results: [
          {
            id: 'p1',
            name: 'platform-skill',
            slug: 'platform-skill',
            description: 'A platform skill',
            type: 'SKILL',
            tags: [],
            compatibilityAgents: [],
            starCount: 5,
            installCount: 100,
            organisation: { slug: 'org', name: 'Org' },
            categories: [],
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      })

      vi.mocked(skillsShModule.searchSkillsSh).mockResolvedValue([
        {
          id: 'c1',
          name: 'community-skill',
          description: 'A community skill',
          installCount: 50,
          source: 'owner/repo',
          url: 'https://skills.sh/c1',
        },
      ])

      vi.mocked(skillsShModule.toGitInstallSource).mockReturnValue(
        'github.com/owner/repo/community-skill'
      )

      await runSearch('testing', '--source', 'all')

      const output = stdoutWriteSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
      expect(output).toContain('platform-skill')
      expect(output).toContain('community-skill')
    })
  })

  // ---------------------------------------------------------------------------
  // Default source behaviour
  // ---------------------------------------------------------------------------

  describe('default source', () => {
    it('searches both platform and community by default when connected', async () => {
      vi.mocked(configModule.isConnected).mockResolvedValue(true)

      vi.mocked(clientModule.registryFetch).mockResolvedValue({
        results: [
          {
            id: 'p1',
            name: 'platform-skill',
            slug: 'platform-skill',
            description: 'A platform skill',
            type: 'SKILL',
            tags: [],
            compatibilityAgents: [],
            starCount: 3,
            installCount: 200,
            organisation: { slug: 'org', name: 'Org' },
            categories: [{ id: 'cat1', name: 'Testing', slug: 'testing', icon: null }],
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      })

      vi.mocked(skillsShModule.searchSkillsSh).mockResolvedValue([])

      await runSearch('testing')

      const output = stdoutWriteSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
      expect(output).toContain('platform-skill')
      expect(clientModule.registryFetch).toHaveBeenCalledOnce()
      expect(skillsShModule.searchSkillsSh).toHaveBeenCalledOnce()
    })

    it('searches only community by default when disconnected', async () => {
      vi.mocked(configModule.isConnected).mockResolvedValue(false)

      vi.mocked(skillsShModule.searchSkillsSh).mockResolvedValue([
        {
          id: 'c1',
          name: 'community-skill',
          description: 'A community skill',
          installCount: 40,
          source: 'owner/repo',
          url: 'https://skills.sh/c1',
        },
      ])

      vi.mocked(skillsShModule.toGitInstallSource).mockReturnValue(
        'github.com/owner/repo/community-skill'
      )

      await runSearch('test')

      const output = stdoutWriteSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
      expect(output).toContain('community-skill')
      expect(clientModule.registryFetch).not.toHaveBeenCalled()
      expect(skillsShModule.searchSkillsSh).toHaveBeenCalledOnce()
    })
  })

  // ---------------------------------------------------------------------------
  // No results
  // ---------------------------------------------------------------------------

  describe('no results', () => {
    it('displays a no-results message when both sources return empty', async () => {
      vi.mocked(configModule.isConnected).mockResolvedValue(true)

      vi.mocked(clientModule.registryFetch).mockResolvedValue({
        results: [],
        total: 0,
        limit: 20,
        offset: 0,
      })

      vi.mocked(skillsShModule.searchSkillsSh).mockResolvedValue([])

      await runSearch('nonexistent', '--source', 'all')

      const output = stdoutWriteSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
      expect(output).toContain('No results')
    })
  })

  // ---------------------------------------------------------------------------
  // --type filter
  // ---------------------------------------------------------------------------

  describe('--type filter', () => {
    it('passes the type filter as an uppercase query parameter to the platform', async () => {
      vi.mocked(configModule.isConnected).mockResolvedValue(true)

      vi.mocked(clientModule.registryFetch).mockResolvedValue({
        results: [],
        total: 0,
        limit: 20,
        offset: 0,
      })

      vi.mocked(skillsShModule.searchSkillsSh).mockResolvedValue([])

      await runSearch('testing', '--type', 'skill')

      expect(clientModule.registryFetch).toHaveBeenCalledOnce()
      const callUrl = vi.mocked(clientModule.registryFetch).mock.calls[0]![0] as string
      expect(callUrl).toContain('type=SKILL')
    })
  })

  // ---------------------------------------------------------------------------
  // --source filter
  // ---------------------------------------------------------------------------

  describe('--source filter', () => {
    it('only searches community when --source community is specified', async () => {
      vi.mocked(configModule.isConnected).mockResolvedValue(true)
      vi.mocked(skillsShModule.searchSkillsSh).mockResolvedValue([])

      await runSearch('testing', '--source', 'community')

      expect(clientModule.registryFetch).not.toHaveBeenCalled()
      expect(skillsShModule.searchSkillsSh).toHaveBeenCalledOnce()
    })

    it('only searches platform when --source platform is specified', async () => {
      vi.mocked(configModule.isConnected).mockResolvedValue(true)
      vi.mocked(clientModule.registryFetch).mockResolvedValue({
        results: [],
        total: 0,
        limit: 20,
        offset: 0,
      })

      await runSearch('testing', '--source', 'platform')

      expect(clientModule.registryFetch).toHaveBeenCalledOnce()
      expect(skillsShModule.searchSkillsSh).not.toHaveBeenCalled()
    })

    it('rejects invalid source values', async () => {
      vi.mocked(configModule.isConnected).mockResolvedValue(true)

      await expect(runSearch('testing', '--source', 'banana')).rejects.toThrow()
      expect(exitSpy).toHaveBeenCalledWith(1)
    })

    it('errors when --source platform is used without a connection', async () => {
      vi.mocked(configModule.isConnected).mockResolvedValue(false)

      await expect(runSearch('testing', '--source', 'platform')).rejects.toThrow()
      expect(exitSpy).toHaveBeenCalledWith(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Skills.sh returns empty
  // ---------------------------------------------------------------------------

  describe('skills.sh returns empty', () => {
    it('gracefully returns platform results when skills.sh returns no matches', async () => {
      vi.mocked(configModule.isConnected).mockResolvedValue(true)

      vi.mocked(clientModule.registryFetch).mockResolvedValue({
        results: [
          {
            id: 'p1',
            name: 'platform-skill',
            slug: 'platform-skill',
            description: 'Works fine',
            type: 'SKILL',
            tags: [],
            compatibilityAgents: [],
            starCount: 0,
            installCount: 10,
            organisation: { slug: 'org', name: 'Org' },
            categories: [],
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      })

      // searchSkillsSh never throws — it returns empty on failure
      vi.mocked(skillsShModule.searchSkillsSh).mockResolvedValue([])

      await runSearch('testing', '--source', 'all')

      const output = stdoutWriteSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
      expect(output).toContain('platform-skill')
    })
  })

  // ---------------------------------------------------------------------------
  // Platform error
  // ---------------------------------------------------------------------------

  describe('platform error', () => {
    it('gracefully returns skills.sh results when platform request fails', async () => {
      vi.mocked(configModule.isConnected).mockResolvedValue(true)

      vi.mocked(clientModule.registryFetch).mockRejectedValue(new Error('Network failure'))

      vi.mocked(skillsShModule.searchSkillsSh).mockResolvedValue([
        {
          id: 'c1',
          name: 'community-skill',
          description: 'Still works',
          installCount: 30,
          source: 'owner/repo',
          url: 'https://skills.sh/c1',
        },
      ])

      vi.mocked(skillsShModule.toGitInstallSource).mockReturnValue(
        'github.com/owner/repo/community-skill'
      )

      await runSearch('testing', '--source', 'all')

      const output = stdoutWriteSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
      expect(output).toContain('community-skill')
    })

    it('shows no results when platform fails and skills.sh returns empty', async () => {
      vi.mocked(configModule.isConnected).mockResolvedValue(true)

      vi.mocked(clientModule.registryFetch).mockRejectedValue(new Error('Platform down'))
      // searchSkillsSh never rejects — returns [] on failure
      vi.mocked(skillsShModule.searchSkillsSh).mockResolvedValue([])

      await runSearch('testing', '--source', 'all')

      const output = stdoutWriteSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
      expect(output).toContain('No results')
    })

    it('fails when only platform is searched and it errors', async () => {
      vi.mocked(configModule.isConnected).mockResolvedValue(true)

      vi.mocked(clientModule.registryFetch).mockRejectedValue(new Error('Platform down'))

      await expect(runSearch('testing', '--source', 'platform')).rejects.toThrow()
      expect(exitSpy).toHaveBeenCalledWith(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Well-known search
  // ---------------------------------------------------------------------------

  describe('well-known search', () => {
    it('fetches skills from a well-known domain', async () => {
      vi.mocked(configModule.isConnected).mockResolvedValue(false)

      vi.mocked(wellKnownModule.fetchWellKnownIndex).mockResolvedValue({
        skills: [
          {
            name: 'domain-skill',
            description: 'A skill from a domain',
            files: ['SKILL.md'],
          },
        ],
      })

      await runSearch('example.com', '--source', 'well-known')

      const output = stdoutWriteSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
      expect(output).toContain('domain-skill')
      expect(wellKnownModule.fetchWellKnownIndex).toHaveBeenCalledOnce()
    })
  })
})
