import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue('/home/testuser'),
  }
})

vi.mock('@agentver/agent-definitions', () => ({
  getSkillPlacementPath: vi.fn(),
  getAgentPlacementPath: vi.fn(),
  getCommandPlacementPath: vi.fn(),
}))

import { getSkillPlacementPath } from '@agentver/agent-definitions'
import {
  getCanonicalFilePath,
  getCanonicalSkillPath,
  isCanonicalInstall,
  resolveCanonicalCategory,
  resolveReadPath,
} from '../index'

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

  describe('isCanonicalInstall', () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'agentver-canonical-test-'))
    })

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true })
    })

    it('returns true when canonical skill directory exists', () => {
      const skillDir = join(tmpDir, '.agents', 'skills', 'my-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), '# Test')

      expect(isCanonicalInstall(tmpDir, 'my-skill', 'project', 'skills')).toBe(true)
    })

    it('returns false when canonical skill directory does not exist', () => {
      expect(isCanonicalInstall(tmpDir, 'my-skill', 'project', 'skills')).toBe(false)
    })

    it('returns true when canonical agent file exists', () => {
      const agentDir = join(tmpDir, '.agents', 'agents')
      mkdirSync(agentDir, { recursive: true })
      writeFileSync(join(agentDir, 'my-agent.md'), '# Agent')

      expect(isCanonicalInstall(tmpDir, 'my-agent', 'project', 'agents')).toBe(true)
    })

    it('returns false when canonical agent file does not exist', () => {
      expect(isCanonicalInstall(tmpDir, 'my-agent', 'project', 'agents')).toBe(false)
    })
  })

  describe('resolveReadPath', () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'agentver-readpath-test-'))
    })

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true })
    })

    it('returns canonical path when directory exists', () => {
      const skillDir = join(tmpDir, '.agents', 'skills', 'my-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), '# Test')

      const result = resolveReadPath(tmpDir, 'my-skill', ['claude-code'], 'project', 'skills')
      expect(result).toBe(skillDir)
    })

    it('falls back to agent placement path when canonical is absent', () => {
      const mockGetSkill = vi.mocked(getSkillPlacementPath)
      mockGetSkill.mockReturnValue('.claude/skills/my-skill')

      // Create the agent placement path but NOT the canonical path
      const placementDir = join(tmpDir, '.claude', 'skills', 'my-skill')
      mkdirSync(placementDir, { recursive: true })
      writeFileSync(join(placementDir, 'SKILL.md'), '# Test')

      const result = resolveReadPath(tmpDir, 'my-skill', ['claude-code'], 'project', 'skills')
      expect(result).toBe(placementDir)
    })

    it('follows symlinks to the real target', () => {
      const mockGetSkill = vi.mocked(getSkillPlacementPath)
      mockGetSkill.mockReturnValue('.claude/skills/my-skill')

      // Create canonical directory as the symlink target
      const canonicalDir = join(tmpDir, '.agents', 'skills', 'my-skill')
      mkdirSync(canonicalDir, { recursive: true })
      writeFileSync(join(canonicalDir, 'SKILL.md'), '# Test')

      // Create a symlink from the placement path to the canonical path
      const placementDir = join(tmpDir, '.claude', 'skills', 'my-skill')
      mkdirSync(join(tmpDir, '.claude', 'skills'), { recursive: true })
      symlinkSync(canonicalDir, placementDir)

      // Since canonical exists, it should return canonical directly
      const result = resolveReadPath(tmpDir, 'my-skill', ['claude-code'], 'project', 'skills')
      expect(result).toBe(canonicalDir)
    })

    it('returns null when nothing is found', () => {
      const mockGetSkill = vi.mocked(getSkillPlacementPath)
      mockGetSkill.mockReturnValue('.claude/skills/my-skill')

      const result = resolveReadPath(tmpDir, 'my-skill', ['claude-code'], 'project', 'skills')
      expect(result).toBeNull()
    })
  })
})
