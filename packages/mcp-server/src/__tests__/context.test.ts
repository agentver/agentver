import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}))

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/test'),
}))

vi.mock('@agentver/agent-definitions', () => ({
  detectInstalledAgents: vi.fn(),
}))

describe('context', () => {
  let fs: typeof import('node:fs')
  let agentDefs: typeof import('@agentver/agent-definitions')
  let context: typeof import('../shared/context')
  let originalEnv: string | undefined

  beforeEach(async () => {
    vi.clearAllMocks()
    originalEnv = process.env.AGENTVER_PROJECT_ROOT
    delete process.env.AGENTVER_PROJECT_ROOT
    fs = await import('node:fs')
    agentDefs = await import('@agentver/agent-definitions')
    context = await import('../shared/context')
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.AGENTVER_PROJECT_ROOT = originalEnv
    } else {
      delete process.env.AGENTVER_PROJECT_ROOT
    }
    vi.restoreAllMocks()
  })

  describe('getWorkingDirectory', () => {
    it('returns process.cwd() when AGENTVER_PROJECT_ROOT is unset', () => {
      expect(context.getWorkingDirectory()).toBe(process.cwd())
    })

    it('returns env var value when AGENTVER_PROJECT_ROOT is set', () => {
      process.env.AGENTVER_PROJECT_ROOT = '/custom/root'
      expect(context.getWorkingDirectory()).toBe('/custom/root')
    })
  })

  describe('getGlobalConfigDirectory', () => {
    it('returns ~/.agentver', () => {
      expect(context.getGlobalConfigDirectory()).toBe(join('/home/test', '.agentver'))
    })
  })

  describe('isAgentverProject', () => {
    it('returns true when .agentver directory exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      expect(context.isAgentverProject('/project')).toBe(true)
      expect(fs.existsSync).toHaveBeenCalledWith(join('/project', '.agentver'))
    })

    it('returns false when .agentver directory does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)
      expect(context.isAgentverProject('/project')).toBe(false)
    })
  })

  describe('detectAgents', () => {
    it('delegates to detectInstalledAgents and returns result', () => {
      const agents = [{ id: 'claude-code', name: 'Claude Code', configPath: '/project/.claude' }]
      vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue(
        agents as ReturnType<typeof agentDefs.detectInstalledAgents>
      )

      const result = context.detectAgents('/project')
      expect(agentDefs.detectInstalledAgents).toHaveBeenCalledWith('/project')
      expect(result).toEqual(agents)
    })
  })

  describe('logDebug', () => {
    it('writes to process.stderr with [agentver-mcp] prefix', () => {
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

      context.logDebug('test message')
      expect(spy).toHaveBeenCalledWith('[agentver-mcp] test message\n')

      spy.mockRestore()
    })
  })
})
