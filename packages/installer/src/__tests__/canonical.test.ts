import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('/home/testuser'),
}))

vi.mock('@agentver/agent-definitions', () => ({
  getSkillPlacementPath: vi.fn(),
  getAgentPlacementPath: vi.fn(),
  getCommandPlacementPath: vi.fn(),
}))

import { getCanonicalFilePath, getCanonicalSkillPath, resolveCanonicalCategory } from '../index'

describe('canonical', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getCanonicalSkillPath', () => {
    it('returns .agents/skills/<name>/ for project scope', () => {
      const result = getCanonicalSkillPath('/project', 'my-skill', 'project')
      expect(result).toBe('/project/.agents/skills/my-skill')
    })

    it('returns ~/.agents/skills/<name>/ for global scope', () => {
      const result = getCanonicalSkillPath('/project', 'my-skill', 'global')
      expect(result).toBe('/home/testuser/.agents/skills/my-skill')
    })

    it('throws on name containing path traversal', () => {
      expect(() => getCanonicalSkillPath('/project', '../evil', 'project')).toThrow(
        'path traversal'
      )
    })

    it('throws on absolute name', () => {
      expect(() => getCanonicalSkillPath('/project', '/etc/passwd', 'project')).toThrow(
        'path traversal'
      )
    })
  })

  describe('getCanonicalFilePath', () => {
    it('returns .agents/agents/<name>.md for agents category', () => {
      const result = getCanonicalFilePath('/project', 'my-agent', 'agents', 'project')
      expect(result).toBe('/project/.agents/agents/my-agent.md')
    })

    it('returns .agents/commands/<name>.md for commands category', () => {
      const result = getCanonicalFilePath('/project', 'my-command', 'commands', 'project')
      expect(result).toBe('/project/.agents/commands/my-command.md')
    })

    it('returns global path for global scope', () => {
      const result = getCanonicalFilePath('/project', 'my-agent', 'agents', 'global')
      expect(result).toBe('/home/testuser/.agents/agents/my-agent.md')
    })

    it('throws on name containing path traversal', () => {
      expect(() => getCanonicalFilePath('/project', '../evil', 'agents', 'project')).toThrow(
        'path traversal'
      )
    })
  })

  describe('resolveCanonicalCategory', () => {
    it('maps SKILL to skills', () => {
      expect(resolveCanonicalCategory('SKILL')).toBe('skills')
    })

    it('maps AGENT to agents', () => {
      expect(resolveCanonicalCategory('AGENT')).toBe('agents')
    })

    it('maps COMMAND to commands', () => {
      expect(resolveCanonicalCategory('COMMAND')).toBe('commands')
    })

    it('maps BUNDLE to skills', () => {
      expect(resolveCanonicalCategory('BUNDLE')).toBe('skills')
    })

    it('maps AGENT_CONFIG to skills', () => {
      expect(resolveCanonicalCategory('AGENT_CONFIG')).toBe('skills')
    })

    it('maps PLUGIN to skills', () => {
      expect(resolveCanonicalCategory('PLUGIN')).toBe('skills')
    })

    it('maps SCRIPT to skills', () => {
      expect(resolveCanonicalCategory('SCRIPT')).toBe('skills')
    })

    it('maps PROMPT to skills', () => {
      expect(resolveCanonicalCategory('PROMPT')).toBe('skills')
    })
  })
})
