import type { Dirent, Stats } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
  readdirSync: vi.fn(),
}))

import { existsSync, readdirSync, statSync } from 'node:fs'
import {
  detectGlobalAgents,
  detectInstalledAgents,
  getSkillPlacementPath,
  inferDetectedType,
  scanForSkillFiles,
  scanGlobalSkillFiles,
} from '../scanner'

const mockExistsSync = vi.mocked(existsSync)
const mockStatSync = vi.mocked(statSync)
const mockReaddirSync = vi.mocked(readdirSync)

function createMockStats(overrides: Partial<Stats> = {}): Stats {
  return {
    isFile: () => false,
    isDirectory: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    dev: 0,
    ino: 0,
    mode: 0,
    nlink: 0,
    uid: 0,
    gid: 0,
    rdev: 0,
    size: 0,
    blksize: 0,
    blocks: 0,
    atimeMs: 0,
    mtimeMs: 0,
    ctimeMs: 0,
    birthtimeMs: 0,
    atime: new Date(),
    mtime: new Date(),
    ctime: new Date(),
    birthtime: new Date(),
    ...overrides,
  } as Stats
}

function createMockDirent(name: string, isDir: boolean): Dirent {
  return {
    name,
    isFile: () => !isDir,
    isDirectory: () => isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    parentPath: '/test',
    path: '/test',
  } as Dirent
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('detectInstalledAgents', () => {
  it('should detect claude-code when .claude/ directory exists', () => {
    mockExistsSync.mockImplementation((p) => String(p) === '/project/.claude')
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true }))

    const result = detectInstalledAgents('/project')
    const ids = result.map((r) => r.id)
    expect(ids).toContain('claude-code')
  })

  it('should detect cursor when .cursor/ directory exists', () => {
    mockExistsSync.mockImplementation((p) => String(p) === '/project/.cursor')
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true }))

    const result = detectInstalledAgents('/project')
    const ids = result.map((r) => r.id)
    expect(ids).toContain('cursor')
  })

  it('should detect copilot via copilot-instructions.md, not just .github/ dir', () => {
    mockExistsSync.mockImplementation(
      (p) => String(p) === '/project/.github/copilot-instructions.md'
    )
    mockStatSync.mockReturnValue(createMockStats({ isFile: () => true }))

    const result = detectInstalledAgents('/project')
    const ids = result.map((r) => r.id)
    expect(ids).toContain('copilot')
  })

  it('should not falsely detect copilot when only .github/ dir exists', () => {
    mockExistsSync.mockImplementation((p) => String(p) === '/project/.github')
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true }))

    const result = detectInstalledAgents('/project')
    const ids = result.map((r) => r.id)
    expect(ids).not.toContain('copilot')
  })

  it('should detect windsurf when .windsurf/ directory exists', () => {
    mockExistsSync.mockImplementation((p) => String(p) === '/project/.windsurf')
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true }))

    const result = detectInstalledAgents('/project')
    const ids = result.map((r) => r.id)
    expect(ids).toContain('windsurf')
  })

  it('should detect roo when .roo/ directory exists', () => {
    mockExistsSync.mockImplementation((p) => String(p) === '/project/.roo')
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true }))

    const result = detectInstalledAgents('/project')
    const ids = result.map((r) => r.id)
    expect(ids).toContain('roo')
  })

  it('should detect gemini-cli when .gemini/ directory exists', () => {
    mockExistsSync.mockImplementation((p) => String(p) === '/project/.gemini')
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true }))

    const result = detectInstalledAgents('/project')
    const ids = result.map((r) => r.id)
    expect(ids).toContain('gemini-cli')
  })

  it('should detect agent by config file when no config dir present', () => {
    mockExistsSync.mockImplementation((p) => String(p) === '/project/.aider.conf.yml')
    mockStatSync.mockReturnValue(createMockStats({ isFile: () => true }))

    const result = detectInstalledAgents('/project')
    const ids = result.map((r) => r.id)
    expect(ids).toContain('aider')
  })

  it('should detect aider via .aider.conf.yml file', () => {
    mockExistsSync.mockImplementation((p) => String(p) === '/project/.aider.conf.yml')
    mockStatSync.mockReturnValue(createMockStats({ isFile: () => true }))

    const result = detectInstalledAgents('/project')
    const aider = result.find((r) => r.id === 'aider')
    expect(aider).toBeDefined()
    expect(aider!.configPath).toBe('/project/.aider.conf.yml')
  })

  it('should detect junie via .junie/ directory', () => {
    mockExistsSync.mockImplementation((p) => String(p) === '/project/.junie')
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true }))

    const result = detectInstalledAgents('/project')
    const ids = result.map((r) => r.id)
    expect(ids).toContain('junie')
  })

  it('should detect multiple agents in the same directory', () => {
    const existingPaths = new Set([
      '/project/.claude',
      '/project/.cursor',
      '/project/.github/copilot-instructions.md',
    ])
    mockExistsSync.mockImplementation((p) => existingPaths.has(String(p)))
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true, isFile: () => true }))

    const result = detectInstalledAgents('/project')
    const ids = result.map((r) => r.id)
    expect(ids).toContain('claude-code')
    expect(ids).toContain('cursor')
    expect(ids).toContain('copilot')
  })

  it('should return empty array for empty directory', () => {
    mockExistsSync.mockReturnValue(false)

    const result = detectInstalledAgents('/project')
    expect(result).toEqual([])
  })

  it('should never auto-detect the "universal" agent', () => {
    // Even if we say everything exists, universal should not appear
    mockExistsSync.mockReturnValue(true)
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true, isFile: () => true }))

    const result = detectInstalledAgents('/project')
    const ids = result.map((r) => r.id)
    expect(ids).not.toContain('universal')
  })

  it('should prefer config dir detection over config file detection', () => {
    // claude-code has both .claude dir and CLAUDE.md file
    const existingPaths = new Set(['/project/.claude', '/project/CLAUDE.md'])
    mockExistsSync.mockImplementation((p) => existingPaths.has(String(p)))
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true, isFile: () => true }))

    const result = detectInstalledAgents('/project')
    const claudeEntries = result.filter((r) => r.id === 'claude-code')
    // Should only be detected once (via config dir, not duplicated by config file)
    expect(claudeEntries).toHaveLength(1)
    expect(claudeEntries[0]!.configPath).toBe('/project/.claude')
  })

  it('should skip entries that are files when checking config dirs', () => {
    // .claude exists but is a file, not a directory
    mockExistsSync.mockImplementation((p) => String(p) === '/project/.claude')
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => false, isFile: () => true }))

    const result = detectInstalledAgents('/project')
    // claude-code should not be detected via configDir since .claude is a file
    // But it might be detected via configFile (CLAUDE.md) — except that doesn't exist
    const claudeEntries = result.filter((r) => r.id === 'claude-code')
    expect(claudeEntries).toHaveLength(0)
  })

  it('should skip entries that are directories when checking config files', () => {
    // CLAUDE.md exists but is a directory, not a file
    mockExistsSync.mockImplementation((p) => String(p) === '/project/CLAUDE.md')
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true, isFile: () => false }))

    const result = detectInstalledAgents('/project')
    const claudeEntries = result.filter((r) => r.id === 'claude-code')
    expect(claudeEntries).toHaveLength(0)
  })
})

describe('detectGlobalAgents', () => {
  it('should detect agents with config dirs in the home directory', () => {
    mockExistsSync.mockImplementation((p) => String(p) === '/home/user/.claude')
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true }))

    const result = detectGlobalAgents('/home/user')
    const ids = result.map((r) => r.id)
    expect(ids).toContain('claude-code')
  })

  it('should detect agents with global skill paths', () => {
    // ~/.cursor/skills exists but ~/.cursor does not (testing the fallback to globalSkillPath)
    mockExistsSync.mockImplementation((p) => String(p) === '/home/user/.cursor/skills')
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true }))

    const result = detectGlobalAgents('/home/user')
    const ids = result.map((r) => r.id)
    expect(ids).toContain('cursor')
  })

  it('should not detect agents whose dirs do not exist', () => {
    mockExistsSync.mockReturnValue(false)

    const result = detectGlobalAgents('/home/user')
    expect(result).toEqual([])
  })

  it('should deduplicate — not return the same agent twice', () => {
    // Both ~/.claude and ~/.claude/skills exist
    const existingPaths = new Set(['/home/user/.claude', '/home/user/.claude/skills'])
    mockExistsSync.mockImplementation((p) => existingPaths.has(String(p)))
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true }))

    const result = detectGlobalAgents('/home/user')
    const claudeEntries = result.filter((r) => r.id === 'claude-code')
    expect(claudeEntries).toHaveLength(1)
  })

  it('should not detect the "universal" agent', () => {
    mockExistsSync.mockReturnValue(true)
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true }))

    const result = detectGlobalAgents('/home/user')
    const ids = result.map((r) => r.id)
    expect(ids).not.toContain('universal')
  })

  it('should return name and configPath for each detected agent', () => {
    mockExistsSync.mockImplementation((p) => String(p) === '/home/user/.claude')
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true }))

    const result = detectGlobalAgents('/home/user')
    const claude = result.find((r) => r.id === 'claude-code')
    expect(claude).toBeDefined()
    expect(claude!.name).toBe('Claude Code')
    expect(claude!.configPath).toBe('/home/user/.claude')
  })

  it('should detect multiple agents when their config dirs exist', () => {
    const existingPaths = new Set([
      '/home/user/.claude',
      '/home/user/.cursor',
      '/home/user/.gemini',
    ])
    mockExistsSync.mockImplementation((p) => existingPaths.has(String(p)))
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true }))

    const result = detectGlobalAgents('/home/user')
    const ids = result.map((r) => r.id)
    expect(ids).toContain('claude-code')
    expect(ids).toContain('cursor')
    expect(ids).toContain('gemini-cli')
  })

  it('should prefer configDir detection over globalSkillPath', () => {
    // Both ~/.cursor (configDir) and ~/.cursor/skills (globalSkillPath) exist
    const existingPaths = new Set(['/home/user/.cursor', '/home/user/.cursor/skills'])
    mockExistsSync.mockImplementation((p) => existingPaths.has(String(p)))
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true }))

    const result = detectGlobalAgents('/home/user')
    const cursor = result.find((r) => r.id === 'cursor')
    expect(cursor).toBeDefined()
    // Should use the configDir path, not the globalSkillPath
    expect(cursor!.configPath).toBe('/home/user/.cursor')
  })
})

describe('scanForSkillFiles', () => {
  it('should find SKILL.md in skill subdirectories', () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p)
      return (
        path === '/project/.claude/skills' || path === '/project/.claude/skills/my-skill/SKILL.md'
      )
    })
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true }))
    mockReaddirSync.mockReturnValue([createMockDirent('my-skill', true)] as unknown as ReturnType<
      typeof readdirSync
    >)

    const result = scanForSkillFiles('/project')
    const skillFiles = result.filter((f) => f.type === 'skill' && f.detectedType === 'SKILL')
    expect(skillFiles.length).toBeGreaterThanOrEqual(1)
    const mySkill = skillFiles.find((f) => f.name === 'my-skill')
    expect(mySkill).toBeDefined()
    expect(mySkill!.path).toBe('/project/.claude/skills/my-skill/SKILL.md')
  })

  it('should find loose .md files in skill directories', () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p)
      return path === '/project/.claude/skills'
    })
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true }))
    mockReaddirSync.mockReturnValue([createMockDirent('guide.md', false)] as unknown as ReturnType<
      typeof readdirSync
    >)

    const result = scanForSkillFiles('/project')
    const mdFiles = result.filter((f) => f.name === 'guide')
    expect(mdFiles.length).toBeGreaterThanOrEqual(1)
    expect(mdFiles[0]!.path).toBe('/project/.claude/skills/guide.md')
  })

  it('should detect config files alongside skills', () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p)
      return path === '/project/CLAUDE.md'
    })
    mockStatSync.mockImplementation((p) => {
      const path = String(p)
      if (path === '/project/CLAUDE.md') {
        return createMockStats({ isFile: () => true, isDirectory: () => false })
      }
      return createMockStats({ isDirectory: () => false })
    })

    const result = scanForSkillFiles('/project')
    const configFiles = result.filter((f) => f.type === 'config')
    expect(configFiles.length).toBeGreaterThanOrEqual(1)
    const claudeConfig = configFiles.find((f) => f.agentId === 'claude-code')
    expect(claudeConfig).toBeDefined()
  })

  it('should return empty array when no skills present', () => {
    mockExistsSync.mockReturnValue(false)

    const result = scanForSkillFiles('/project')
    expect(result).toEqual([])
  })

  it('should scan multiple agent skill paths', () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p)
      return (
        path === '/project/.claude/skills' ||
        path === '/project/.cursor/skills' ||
        path === '/project/.claude/skills/s1/SKILL.md' ||
        path === '/project/.cursor/skills/s2/SKILL.md'
      )
    })
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true }))
    mockReaddirSync.mockImplementation((p) => {
      const path = String(p)
      if (path === '/project/.claude/skills') {
        return [createMockDirent('s1', true)] as unknown as ReturnType<typeof readdirSync>
      }
      if (path === '/project/.cursor/skills') {
        return [createMockDirent('s2', true)] as unknown as ReturnType<typeof readdirSync>
      }
      return [] as unknown as ReturnType<typeof readdirSync>
    })

    const result = scanForSkillFiles('/project')
    const agentIds = new Set(result.filter((f) => f.type === 'skill').map((f) => f.agentId))
    expect(agentIds.has('claude-code')).toBe(true)
    expect(agentIds.has('cursor')).toBe(true)
  })
})

describe('scanGlobalSkillFiles', () => {
  it('should find SKILL.md files in global skill directories', () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p)
      return (
        path === '/home/user/.claude/skills' ||
        path === '/home/user/.claude/skills/my-skill/SKILL.md'
      )
    })
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true }))
    mockReaddirSync.mockImplementation((p) => {
      const path = String(p)
      if (path === '/home/user/.claude/skills') {
        return [createMockDirent('my-skill', true)] as unknown as ReturnType<typeof readdirSync>
      }
      return [] as unknown as ReturnType<typeof readdirSync>
    })

    const result = scanGlobalSkillFiles('/home/user')
    const skillFiles = result.filter((f) => f.type === 'skill' && f.detectedType === 'SKILL')
    expect(skillFiles.length).toBeGreaterThanOrEqual(1)
    const mySkill = skillFiles.find((f) => f.name === 'my-skill')
    expect(mySkill).toBeDefined()
    expect(mySkill!.path).toBe('/home/user/.claude/skills/my-skill/SKILL.md')
    expect(mySkill!.agentId).toBe('claude-code')
  })

  it('should find standalone .md files in skill directories', () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p)
      return path === '/home/user/.claude/skills'
    })
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true }))
    mockReaddirSync.mockReturnValue([createMockDirent('guide.md', false)] as unknown as ReturnType<
      typeof readdirSync
    >)

    const result = scanGlobalSkillFiles('/home/user')
    const mdFiles = result.filter((f) => f.name === 'guide')
    expect(mdFiles.length).toBeGreaterThanOrEqual(1)
    expect(mdFiles[0]!.path).toBe('/home/user/.claude/skills/guide.md')
  })

  it('should find config files in global config dirs', () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p)
      return (
        path === '/home/user/CLAUDE.md' ||
        path === '/home/user/.codex' ||
        path === '/home/user/.codex/AGENTS.md'
      )
    })
    mockStatSync.mockImplementation((p) => {
      const path = String(p)
      if (path === '/home/user/CLAUDE.md' || path === '/home/user/.codex/AGENTS.md') {
        return createMockStats({ isFile: () => true, isDirectory: () => false })
      }
      if (path === '/home/user/.codex') {
        return createMockStats({ isFile: () => false, isDirectory: () => true })
      }
      return createMockStats({ isDirectory: () => false })
    })

    const result = scanGlobalSkillFiles('/home/user')
    const configFiles = result.filter((f) => f.type === 'config')
    expect(configFiles.length).toBeGreaterThanOrEqual(1)

    const claudeConfig = configFiles.find((f) => f.agentId === 'claude-code')
    expect(claudeConfig).toBeDefined()
    expect(claudeConfig!.detectedType).toBe('AGENT_CONFIG')
  })

  it('should deduplicate by path', () => {
    // claude-code and claude-cowork share the same globalSkillPath (~/.claude/skills)
    // Files found there should not be duplicated
    mockExistsSync.mockImplementation((p) => {
      const path = String(p)
      return path === '/home/user/.claude/skills'
    })
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true }))
    mockReaddirSync.mockReturnValue([createMockDirent('shared.md', false)] as unknown as ReturnType<
      typeof readdirSync
    >)

    const result = scanGlobalSkillFiles('/home/user')
    const sharedFiles = result.filter((f) => f.path === '/home/user/.claude/skills/shared.md')
    // Should only appear once despite claude-code and claude-cowork sharing the path
    expect(sharedFiles).toHaveLength(1)
  })

  it('should handle missing directories gracefully', () => {
    mockExistsSync.mockReturnValue(false)

    const result = scanGlobalSkillFiles('/home/user')
    expect(result).toEqual([])
  })

  it('should not crash on permission errors when reading subdirectories', () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p)
      return path === '/home/user/.claude/skills'
    })
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true }))
    mockReaddirSync.mockImplementation((p) => {
      const path = String(p)
      if (path === '/home/user/.claude/skills') {
        return [createMockDirent('protected-dir', true)] as unknown as ReturnType<
          typeof readdirSync
        >
      }
      // Simulate permission error reading subdirectory
      throw new Error('EACCES: permission denied')
    })

    // Should not throw — permission errors in subdirectories are silently caught
    expect(() => scanGlobalSkillFiles('/home/user')).not.toThrow()
  })

  it('should skip the universal agent', () => {
    mockExistsSync.mockReturnValue(true)
    mockStatSync.mockReturnValue(createMockStats({ isDirectory: () => true, isFile: () => true }))
    mockReaddirSync.mockReturnValue([] as unknown as ReturnType<typeof readdirSync>)

    const result = scanGlobalSkillFiles('/home/user')
    const universalFiles = result.filter((f) => f.agentId === 'universal')
    expect(universalFiles).toHaveLength(0)
  })
})

describe('inferDetectedType', () => {
  it('should return SKILL for "skill.md"', () => {
    expect(inferDetectedType('skill.md')).toBe('SKILL')
  })

  it('should return PROMPT for "prompt.md"', () => {
    expect(inferDetectedType('prompt.md')).toBe('PROMPT')
  })

  it('should return PLUGIN for "plugin.json"', () => {
    expect(inferDetectedType('plugin.json')).toBe('PLUGIN')
  })

  it('should return SCRIPT for "script.json"', () => {
    expect(inferDetectedType('script.json')).toBe('SCRIPT')
  })

  it('should return AGENT_CONFIG for "claude.md"', () => {
    expect(inferDetectedType('claude.md')).toBe('AGENT_CONFIG')
  })

  it('should return AGENT_CONFIG for ".cursorrules"', () => {
    expect(inferDetectedType('.cursorrules')).toBe('AGENT_CONFIG')
  })

  it('should return AGENT_CONFIG for ".windsurfrules"', () => {
    expect(inferDetectedType('.windsurfrules')).toBe('AGENT_CONFIG')
  })

  it('should return AGENT_CONFIG for "agents.md"', () => {
    expect(inferDetectedType('agents.md')).toBe('AGENT_CONFIG')
  })

  it('should return AGENT_CONFIG for "gemini.md"', () => {
    expect(inferDetectedType('gemini.md')).toBe('AGENT_CONFIG')
  })

  it('should return SKILL as default for unknown .md files', () => {
    expect(inferDetectedType('random-file.md')).toBe('SKILL')
    expect(inferDetectedType('readme.md')).toBe('SKILL')
  })

  it('should be case-insensitive', () => {
    expect(inferDetectedType('SKILL.MD')).toBe('SKILL')
    expect(inferDetectedType('Prompt.Md')).toBe('PROMPT')
    expect(inferDetectedType('PLUGIN.JSON')).toBe('PLUGIN')
    expect(inferDetectedType('Claude.md')).toBe('AGENT_CONFIG')
  })
})

describe('getSkillPlacementPath', () => {
  it('should return project path for project scope', () => {
    const result = getSkillPlacementPath('claude-code', 'my-skill', 'project')
    expect(result).toBe('.claude/skills/my-skill')
  })

  it('should return global path for global scope', () => {
    const result = getSkillPlacementPath('claude-code', 'my-skill', 'global')
    expect(result).toBe('~/.claude/skills/my-skill')
  })

  it('should return null for invalid agent ID', () => {
    // @ts-expect-error — testing invalid agent ID
    const result = getSkillPlacementPath('nonexistent', 'my-skill', 'project')
    expect(result).toBeNull()
  })

  it('should join base path with skill name', () => {
    const result = getSkillPlacementPath('cursor', 'test-skill', 'project')
    expect(result).toBe('.cursor/skills/test-skill')
  })

  it('should handle agents with non-standard paths', () => {
    const openclawResult = getSkillPlacementPath('openclaw', 'my-skill', 'project')
    expect(openclawResult).toBe('skills/my-skill')

    const antigravityResult = getSkillPlacementPath('antigravity', 'my-skill', 'project')
    expect(antigravityResult).toBe('.agent/skills/my-skill')

    const antigravityGlobal = getSkillPlacementPath('antigravity', 'my-skill', 'global')
    expect(antigravityGlobal).toBe('~/.gemini/antigravity/skills/my-skill')
  })
})
