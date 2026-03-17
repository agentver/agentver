import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('search command', () => {
  let registryFetch: ReturnType<typeof vi.fn>
  let isConnected: ReturnType<typeof vi.fn>
  let searchSkillsSh: ReturnType<typeof vi.fn>
  let toGitInstallSource: ReturnType<typeof vi.fn>
  let fetchWellKnownIndex: ReturnType<typeof vi.fn>
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>
  let _stderrWriteSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>
  let registerSearchCommand: typeof import('../../commands/search').registerSearchCommand
  let Command: typeof import('commander').Command

  beforeEach(async () => {
    vi.clearAllMocks()

    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    _stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    const clientModule = await import('../../registry/client')
    const configModule = await import('../../registry/config')
    const skillsShModule = await import('../../registry/skills-sh')
    const wellKnownModule = await import('../../wellknown/index.js')

    registryFetch = vi.mocked(clientModule.registryFetch)
    isConnected = vi.mocked(configModule.isConnected)
    searchSkillsSh = vi.mocked(skillsShModule.searchSkillsSh)
    toGitInstallSource = vi.mocked(skillsShModule.toGitInstallSource)
    fetchWellKnownIndex = vi.mocked(wellKnownModule.fetchWellKnownIndex)

    const commanderModule = await import('commander')
    Command = commanderModule.Command

    const searchModule = await import('../../commands/search')
    registerSearchCommand = searchModule.registerSearchCommand
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
      isConnected.mockResolvedValue(true)

      registryFetch.mockResolvedValue({
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

      searchSkillsSh.mockResolvedValue([
        {
          id: 'c1',
          name: 'community-skill',
          description: 'A community skill',
          installCount: 50,
          source: 'owner/repo',
          url: 'https://skills.sh/c1',
        },
      ])

      toGitInstallSource.mockReturnValue('github.com/owner/repo/community-skill')

      await runSearch('testing', '--source', 'all')

      const output = stdoutWriteSpy.mock.calls.map((c) => String(c[0])).join('')
      expect(output).toContain('platform-skill')
      expect(output).toContain('community-skill')
    })
  })

  // ---------------------------------------------------------------------------
  // Platform only results
  // ---------------------------------------------------------------------------

  describe('platform only results', () => {
    it('returns only platform results when skills.sh returns empty', async () => {
      isConnected.mockResolvedValue(true)

      registryFetch.mockResolvedValue({
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

      // Default source when connected is 'platform', so skills.sh is not called
      await runSearch('testing')

      const output = stdoutWriteSpy.mock.calls.map((c) => String(c[0])).join('')
      expect(output).toContain('platform-skill')
      expect(searchSkillsSh).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Skills.sh only (no platform connected)
  // ---------------------------------------------------------------------------

  describe('skills.sh only', () => {
    it('returns skills.sh results when no platform is connected', async () => {
      isConnected.mockResolvedValue(false)

      searchSkillsSh.mockResolvedValue([
        {
          id: 'c1',
          name: 'test-skill',
          description: 'A test skill',
          installCount: 75,
          source: 'owner/repo',
          url: 'https://skills.sh/c1',
        },
      ])

      toGitInstallSource.mockReturnValue('github.com/owner/repo/test-skill')

      await runSearch('test')

      const output = stdoutWriteSpy.mock.calls.map((c) => String(c[0])).join('')
      expect(output).toContain('test-skill')
      expect(registryFetch).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // No results
  // ---------------------------------------------------------------------------

  describe('no results', () => {
    it('displays a no-results message when both sources return empty', async () => {
      isConnected.mockResolvedValue(true)

      registryFetch.mockResolvedValue({
        results: [],
        total: 0,
        limit: 20,
        offset: 0,
      })

      searchSkillsSh.mockResolvedValue([])

      await runSearch('nonexistent', '--source', 'all')

      const output = stdoutWriteSpy.mock.calls.map((c) => String(c[0])).join('')
      expect(output).toContain('No results')
    })
  })

  // ---------------------------------------------------------------------------
  // --type filter
  // ---------------------------------------------------------------------------

  describe('--type filter', () => {
    it('passes the type filter as an uppercase query parameter to the platform', async () => {
      isConnected.mockResolvedValue(true)

      registryFetch.mockResolvedValue({
        results: [],
        total: 0,
        limit: 20,
        offset: 0,
      })

      await runSearch('testing', '--type', 'skill')

      expect(registryFetch).toHaveBeenCalledOnce()
      const callUrl = registryFetch.mock.calls[0]![0] as string
      expect(callUrl).toContain('type=SKILL')
    })
  })

  // ---------------------------------------------------------------------------
  // --source filter
  // ---------------------------------------------------------------------------

  describe('--source filter', () => {
    it('only searches community when --source community is specified', async () => {
      isConnected.mockResolvedValue(true)
      searchSkillsSh.mockResolvedValue([])

      await runSearch('testing', '--source', 'community')

      expect(registryFetch).not.toHaveBeenCalled()
      expect(searchSkillsSh).toHaveBeenCalledOnce()
    })

    it('only searches platform when --source platform is specified', async () => {
      isConnected.mockResolvedValue(true)
      registryFetch.mockResolvedValue({
        results: [],
        total: 0,
        limit: 20,
        offset: 0,
      })

      await runSearch('testing', '--source', 'platform')

      expect(registryFetch).toHaveBeenCalledOnce()
      expect(searchSkillsSh).not.toHaveBeenCalled()
    })

    it('rejects invalid source values', async () => {
      isConnected.mockResolvedValue(true)

      await expect(runSearch('testing', '--source', 'banana')).rejects.toThrow()
      expect(exitSpy).toHaveBeenCalledWith(1)
    })

    it('errors when --source platform is used without a connection', async () => {
      isConnected.mockResolvedValue(false)

      await expect(runSearch('testing', '--source', 'platform')).rejects.toThrow()
      expect(exitSpy).toHaveBeenCalledWith(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Skills.sh network error
  // ---------------------------------------------------------------------------

  describe('skills.sh network error', () => {
    it('gracefully returns platform results when skills.sh fails', async () => {
      isConnected.mockResolvedValue(true)

      registryFetch.mockResolvedValue({
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
      searchSkillsSh.mockResolvedValue([])

      await runSearch('testing', '--source', 'all')

      const output = stdoutWriteSpy.mock.calls.map((c) => String(c[0])).join('')
      expect(output).toContain('platform-skill')
    })
  })

  // ---------------------------------------------------------------------------
  // Platform error
  // ---------------------------------------------------------------------------

  describe('platform error', () => {
    it('gracefully returns skills.sh results when platform request fails', async () => {
      isConnected.mockResolvedValue(true)

      registryFetch.mockRejectedValue(new Error('Network failure'))

      searchSkillsSh.mockResolvedValue([
        {
          id: 'c1',
          name: 'community-skill',
          description: 'Still works',
          installCount: 30,
          source: 'owner/repo',
          url: 'https://skills.sh/c1',
        },
      ])

      toGitInstallSource.mockReturnValue('github.com/owner/repo/community-skill')

      // When platform throws, Promise.all rejects, so the whole search fails
      await expect(runSearch('testing', '--source', 'all')).rejects.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // Well-known search
  // ---------------------------------------------------------------------------

  describe('well-known search', () => {
    it('fetches skills from a well-known domain', async () => {
      isConnected.mockResolvedValue(false)

      fetchWellKnownIndex.mockResolvedValue({
        skills: [
          {
            name: 'domain-skill',
            description: 'A skill from a domain',
            files: ['SKILL.md'],
          },
        ],
      })

      await runSearch('example.com', '--source', 'well-known')

      const output = stdoutWriteSpy.mock.calls.map((c) => String(c[0])).join('')
      expect(output).toContain('domain-skill')
      expect(fetchWellKnownIndex).toHaveBeenCalledOnce()
    })
  })
})
