import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  lstatSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  readlinkSync: vi.fn(),
  rmSync: vi.fn(),
  symlinkSync: vi.fn(),
  unlinkSync: vi.fn(),
}))

vi.mock('@agentver/agent-definitions', () => ({
  getSkillPlacementPath: vi.fn(),
}))

vi.mock('@agentver/shared', () => ({
  AgentverError: class AgentverError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  },
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('chalk', () => ({
  default: {
    yellow: (s: string) => s,
    dim: (s: string) => s,
  },
}))

vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('/home/testuser'),
}))

describe('storage/canonical', () => {
  let fs: typeof import('node:fs')
  let canonicalModule: typeof import('../../storage/canonical')
  let agentDefs: typeof import('@agentver/agent-definitions')

  beforeEach(async () => {
    vi.clearAllMocks()
    fs = await import('node:fs')
    canonicalModule = await import('../../storage/canonical')
    agentDefs = await import('@agentver/agent-definitions')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getCanonicalSkillPath', () => {
    it('returns project-scoped path', () => {
      const result = canonicalModule.getCanonicalSkillPath('/project', 'my-skill', 'project')
      expect(result).toBe('/project/.agents/skills/my-skill')
    })

    it('returns global-scoped path', () => {
      const result = canonicalModule.getCanonicalSkillPath('/project', 'my-skill', 'global')
      expect(result).toBe('/home/testuser/.agents/skills/my-skill')
    })

    it('throws on name containing path traversal', () => {
      expect(() => canonicalModule.getCanonicalSkillPath('/project', '../evil', 'project')).toThrow(
        'path traversal'
      )
    })

    it('throws on absolute name', () => {
      expect(() =>
        canonicalModule.getCanonicalSkillPath('/project', '/etc/passwd', 'project')
      ).toThrow('path traversal')
    })
  })

  describe('isSymlinkedInstall', () => {
    it('returns true when canonical directory exists and is a directory', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.lstatSync).mockReturnValue({ isDirectory: () => true } as ReturnType<
        typeof fs.lstatSync
      >)

      expect(canonicalModule.isSymlinkedInstall('/project', 'my-skill')).toBe(true)
    })

    it('returns false when canonical directory does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      expect(canonicalModule.isSymlinkedInstall('/project', 'my-skill')).toBe(false)
    })

    it('returns false when path is not a directory', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.lstatSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof fs.lstatSync
      >)

      expect(canonicalModule.isSymlinkedInstall('/project', 'my-skill')).toBe(false)
    })
  })

  describe('createAgentSymlinks', () => {
    it('creates symlinks for each agent', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/my-skill')
      vi.mocked(fs.existsSync).mockReturnValue(false)
      vi.mocked(fs.lstatSync).mockImplementation(() => {
        throw new Error('ENOENT')
      })

      canonicalModule.createAgentSymlinks('/project', 'my-skill', ['claude'], 'project')

      expect(fs.symlinkSync).toHaveBeenCalled()
    })

    it('creates symlinks with relative paths (not absolute)', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/my-skill')
      vi.mocked(fs.existsSync).mockReturnValue(false)
      vi.mocked(fs.lstatSync).mockImplementation(() => {
        throw new Error('ENOENT')
      })

      canonicalModule.createAgentSymlinks('/project', 'my-skill', ['claude'], 'project')

      const symlinkTarget = vi.mocked(fs.symlinkSync).mock.calls[0]![0] as string
      // The symlink target should be relative — it must NOT start with /
      expect(symlinkTarget.startsWith('/')).toBe(false)
      // It should be a relative path from the agent skill dir to the canonical dir
      expect(symlinkTarget).toContain('..')
    })

    it('skips agents with no placement path', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue(undefined as unknown as string)

      canonicalModule.createAgentSymlinks('/project', 'my-skill', ['unknown-agent'], 'project')

      expect(fs.symlinkSync).not.toHaveBeenCalled()
    })

    it('removes existing path before creating symlink', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/my-skill')
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => false,
        isDirectory: () => true,
      } as ReturnType<typeof fs.lstatSync>)

      canonicalModule.createAgentSymlinks('/project', 'my-skill', ['claude'], 'project')

      expect(fs.rmSync).toHaveBeenCalled()
      expect(fs.symlinkSync).toHaveBeenCalled()
    })

    it('replaces an existing symlink pointing to the wrong target', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/my-skill')
      // existsSync returns true (symlink exists)
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => true,
        isDirectory: () => false,
      } as ReturnType<typeof fs.lstatSync>)

      canonicalModule.createAgentSymlinks('/project', 'my-skill', ['claude'], 'project')

      // Should remove the old symlink and create a new one
      expect(fs.rmSync).toHaveBeenCalled()
      expect(fs.symlinkSync).toHaveBeenCalled()
    })

    it('resolves ~ placement path to absolute home directory path for global scope', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('~/.claude-code/skills/my-skill')
      vi.mocked(fs.existsSync).mockReturnValue(false)
      vi.mocked(fs.lstatSync).mockImplementation(() => {
        throw new Error('ENOENT')
      })

      canonicalModule.createAgentSymlinks('/project', 'my-skill', ['claude-code'], 'global')

      const symlinkPath = vi.mocked(fs.symlinkSync).mock.calls[0]![1] as string
      expect(symlinkPath).toBe('/home/testuser/.claude-code/skills/my-skill')
      expect(symlinkPath).not.toContain('~')
    })

    it('skips agent for global scope when placement path does not start with ~', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('/absolute/path/my-skill')
      vi.mocked(fs.existsSync).mockReturnValue(false)

      canonicalModule.createAgentSymlinks('/project', 'my-skill', ['some-agent'], 'global')

      expect(fs.symlinkSync).not.toHaveBeenCalled()
    })
  })

  describe('removeAgentSymlinks', () => {
    it('removes symlinks for each agent', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/my-skill')
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof fs.lstatSync>)
      vi.mocked(fs.readdirSync).mockReturnValue(['other-file'] as unknown as ReturnType<
        typeof fs.readdirSync
      >)

      canonicalModule.removeAgentSymlinks('/project', 'my-skill', ['claude'], 'project')

      expect(fs.rmSync).toHaveBeenCalled()
    })

    it('removes symlink at absolute home directory path for global scope', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('~/.claude-code/skills/my-skill')
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof fs.lstatSync>)
      vi.mocked(fs.readdirSync).mockReturnValue(['other-file'] as unknown as ReturnType<
        typeof fs.readdirSync
      >)

      canonicalModule.removeAgentSymlinks('/project', 'my-skill', ['claude-code'], 'global')

      expect(fs.rmSync).toHaveBeenCalledWith(
        '/home/testuser/.claude-code/skills/my-skill',
        expect.objectContaining({ recursive: true, force: true })
      )
    })

    it('cleans up empty parent directories after symlink removal', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude-code/skills/my-skill')
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof fs.lstatSync>)
      vi.mocked(fs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>)

      canonicalModule.removeAgentSymlinks('/project', 'my-skill', ['claude-code'], 'project')

      // Should attempt to clean up empty parent dirs
      expect(fs.rmSync).toHaveBeenCalled()
    })

    it('stops cleanup at home directory boundary for global scope', () => {
      const rmSyncCalls: string[] = []

      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('~/.claude-code/skills/my-skill')
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof fs.lstatSync>)
      vi.mocked(fs.rmSync).mockImplementation((path) => {
        rmSyncCalls.push(path as string)
      })
      vi.mocked(fs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>)

      canonicalModule.removeAgentSymlinks('/project', 'my-skill', ['claude-code'], 'global')

      // Must NOT remove the home directory itself
      expect(rmSyncCalls).not.toContain('/home/testuser')
    })
  })

  describe('removeCanonicalDirectory', () => {
    it('removes the canonical directory when it exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readdirSync).mockReturnValue(['something'] as unknown as ReturnType<
        typeof fs.readdirSync
      >)

      canonicalModule.removeCanonicalDirectory('/project', 'my-skill', 'project')

      expect(fs.rmSync).toHaveBeenCalledWith('/project/.agents/skills/my-skill', {
        recursive: true,
        force: true,
      })
    })

    it('does nothing when directory does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      canonicalModule.removeCanonicalDirectory('/project', 'my-skill', 'project')

      // rmSync should not be called for the canonical dir (only for cleanup)
      expect(fs.rmSync).not.toHaveBeenCalled()
    })

    it('removes from home directory path for global scope', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readdirSync).mockReturnValue(['something'] as unknown as ReturnType<
        typeof fs.readdirSync
      >)

      canonicalModule.removeCanonicalDirectory('/project', 'my-skill', 'global')

      expect(fs.rmSync).toHaveBeenCalledWith('/home/testuser/.agents/skills/my-skill', {
        recursive: true,
        force: true,
      })
    })

    it('cleans up empty parent directories after removal', () => {
      const rmSyncCalls: string[] = []

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.rmSync).mockImplementation((path) => {
        rmSyncCalls.push(path as string)
      })
      vi.mocked(fs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>)

      canonicalModule.removeCanonicalDirectory('/project', 'my-skill', 'project')

      // Should remove: canonical dir, then empty .agents/skills, then empty .agents
      expect(rmSyncCalls).toContain('/project/.agents/skills/my-skill')
      expect(rmSyncCalls).toContain('/project/.agents/skills')
      expect(rmSyncCalls).toContain('/project/.agents')
    })

    it('stops cleanup at the project root boundary', () => {
      const rmSyncCalls: string[] = []

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.rmSync).mockImplementation((path) => {
        rmSyncCalls.push(path as string)
      })
      vi.mocked(fs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>)

      canonicalModule.removeCanonicalDirectory('/project', 'my-skill', 'project')

      // Must NOT remove the project root itself
      expect(rmSyncCalls).not.toContain('/project')
    })

    it('stops cleanup at the home directory boundary for global scope', () => {
      const rmSyncCalls: string[] = []

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.rmSync).mockImplementation((path) => {
        rmSyncCalls.push(path as string)
      })
      vi.mocked(fs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>)

      canonicalModule.removeCanonicalDirectory('/project', 'my-skill', 'global')

      // Must NOT remove the home directory itself
      expect(rmSyncCalls).not.toContain('/home/testuser')
    })
  })

  describe('resolveReadPath', () => {
    it('returns canonical path when it exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.lstatSync).mockReturnValue({
        isDirectory: () => true,
        isSymbolicLink: () => false,
      } as ReturnType<typeof fs.lstatSync>)

      const result = canonicalModule.resolveReadPath('/project', 'my-skill', ['claude'])
      expect(result).toBe('/project/.agents/skills/my-skill')
    })

    it('falls back to agent-specific path', () => {
      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(false) // canonical path doesn't exist
        .mockReturnValueOnce(true) // agent-specific path exists

      vi.mocked(fs.lstatSync).mockReturnValue({
        isDirectory: () => false,
        isSymbolicLink: () => false,
      } as ReturnType<typeof fs.lstatSync>)

      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/my-skill')

      const result = canonicalModule.resolveReadPath('/project', 'my-skill', ['claude'])
      expect(result).toBe('/project/.claude/skills/my-skill')
    })

    it('returns null when no paths exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)
      vi.mocked(fs.lstatSync).mockImplementation(() => {
        throw new Error('ENOENT')
      })
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/my-skill')

      const result = canonicalModule.resolveReadPath('/project', 'my-skill', ['claude'])
      expect(result).toBeNull()
    })

    it('falls back to global scope agent path resolving ~ to home directory', () => {
      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(false) // canonical path does not exist
        .mockReturnValueOnce(true) // agent-specific path exists

      vi.mocked(fs.lstatSync).mockReturnValue({
        isDirectory: () => false,
        isSymbolicLink: () => false,
      } as ReturnType<typeof fs.lstatSync>)

      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('~/.claude-code/skills/my-skill')

      const result = canonicalModule.resolveReadPath(
        '/project',
        'my-skill',
        ['claude-code'],
        'global'
      )

      expect(result).toBe('/home/testuser/.claude-code/skills/my-skill')
      expect(result).not.toContain('~')
    })

    it('throws on name containing path traversal', () => {
      expect(() => canonicalModule.resolveReadPath('/project', '../evil', ['claude'])).toThrow(
        'path traversal'
      )
    })

    it('throws on name with encoded traversal that escapes root', () => {
      expect(() =>
        canonicalModule.resolveReadPath('/project', '../../etc/passwd', ['claude'])
      ).toThrow()
    })
  })

  describe('getCanonicalFilePath', () => {
    it('returns project-scoped path for agents category', () => {
      const result = canonicalModule.getCanonicalFilePath(
        '/project',
        'deep-research',
        'agents',
        'project'
      )
      expect(result).toBe('/project/.agents/agents/deep-research.md')
    })

    it('returns global-scoped path for agents category', () => {
      const result = canonicalModule.getCanonicalFilePath(
        '/project',
        'deep-research',
        'agents',
        'global'
      )
      expect(result).toBe('/home/testuser/.agents/agents/deep-research.md')
    })

    it('returns correct path for commands category', () => {
      const result = canonicalModule.getCanonicalFilePath(
        '/project',
        'my-command',
        'commands',
        'project'
      )
      expect(result).toBe('/project/.agents/commands/my-command.md')
    })

    it('throws on path traversal', () => {
      expect(() =>
        canonicalModule.getCanonicalFilePath('/project', '../evil', 'agents', 'project')
      ).toThrow('path traversal')
    })

    it('throws on absolute name', () => {
      expect(() =>
        canonicalModule.getCanonicalFilePath('/project', '/etc/passwd', 'agents', 'project')
      ).toThrow('path traversal')
    })
  })

  describe('getFilePlacementPath', () => {
    it('returns correct path for agent with standard skill path', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/')

      const result = canonicalModule.getFilePlacementPath(
        'claude-code' as never,
        'deep-research',
        'agents',
        'project'
      )
      expect(result).toBe('.claude/agents/deep-research.md')
    })

    it('returns correct global path', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('~/.claude/skills/')

      const result = canonicalModule.getFilePlacementPath(
        'claude-code' as never,
        'deep-research',
        'agents',
        'global'
      )
      expect(result).toBe('~/.claude/agents/deep-research.md')
    })

    it('returns correct path for commands category', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/')

      const result = canonicalModule.getFilePlacementPath(
        'claude-code' as never,
        'my-cmd',
        'commands',
        'project'
      )
      expect(result).toBe('.claude/commands/my-cmd.md')
    })

    it('returns null for unknown agent', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue(null as unknown as string)

      const result = canonicalModule.getFilePlacementPath(
        'unknown' as never,
        'deep-research',
        'agents',
        'project'
      )
      expect(result).toBeNull()
    })

    it('returns null when skill path does not end with skills', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/packages/')

      const result = canonicalModule.getFilePlacementPath(
        'claude-code' as never,
        'deep-research',
        'agents',
        'project'
      )
      expect(result).toBeNull()
    })

    it('handles skill path without trailing slash', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills')

      const result = canonicalModule.getFilePlacementPath(
        'claude-code' as never,
        'deep-research',
        'agents',
        'project'
      )
      expect(result).toBe('.claude/agents/deep-research.md')
    })
  })

  describe('createFileSymlinks', () => {
    it('creates file-level symlinks for each agent', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/')
      vi.mocked(fs.existsSync).mockReturnValue(false)
      vi.mocked(fs.lstatSync).mockImplementation(() => {
        throw new Error('ENOENT')
      })

      canonicalModule.createFileSymlinks(
        '/project',
        'deep-research',
        'agents',
        ['claude-code'],
        'project'
      )

      expect(fs.symlinkSync).toHaveBeenCalled()
      const symlinkPath = vi.mocked(fs.symlinkSync).mock.calls[0]![1] as string
      expect(symlinkPath).toBe('/project/.claude/agents/deep-research.md')
    })

    it('uses relative symlink paths', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/')
      vi.mocked(fs.existsSync).mockReturnValue(false)
      vi.mocked(fs.lstatSync).mockImplementation(() => {
        throw new Error('ENOENT')
      })

      canonicalModule.createFileSymlinks(
        '/project',
        'deep-research',
        'agents',
        ['claude-code'],
        'project'
      )

      const symlinkTarget = vi.mocked(fs.symlinkSync).mock.calls[0]![0] as string
      expect(symlinkTarget.startsWith('/')).toBe(false)
      expect(symlinkTarget).toContain('..')
    })

    it('removes existing file before creating symlink', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/')
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => false,
        isFile: () => true,
      } as ReturnType<typeof fs.lstatSync>)

      canonicalModule.createFileSymlinks(
        '/project',
        'deep-research',
        'agents',
        ['claude-code'],
        'project'
      )

      expect(fs.rmSync).toHaveBeenCalled()
      expect(fs.symlinkSync).toHaveBeenCalled()
    })

    it('skips agents with no placement path', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue(null as unknown as string)

      canonicalModule.createFileSymlinks(
        '/project',
        'deep-research',
        'agents',
        ['unknown-agent'],
        'project'
      )

      expect(fs.symlinkSync).not.toHaveBeenCalled()
    })

    it('resolves ~ placement path for global scope', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('~/.claude/skills/')
      vi.mocked(fs.existsSync).mockReturnValue(false)
      vi.mocked(fs.lstatSync).mockImplementation(() => {
        throw new Error('ENOENT')
      })

      canonicalModule.createFileSymlinks(
        '/project',
        'deep-research',
        'agents',
        ['claude-code'],
        'global'
      )

      const symlinkPath = vi.mocked(fs.symlinkSync).mock.calls[0]![1] as string
      expect(symlinkPath).toBe('/home/testuser/.claude/agents/deep-research.md')
      expect(symlinkPath).not.toContain('~')
    })
  })

  describe('removeFileSymlinks', () => {
    it('removes symlinks for each agent', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/')
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof fs.lstatSync>)
      vi.mocked(fs.readdirSync).mockReturnValue(['other-file'] as unknown as ReturnType<
        typeof fs.readdirSync
      >)

      canonicalModule.removeFileSymlinks(
        '/project',
        'deep-research',
        'agents',
        ['claude-code'],
        'project'
      )

      expect(fs.rmSync).toHaveBeenCalledWith(
        '/project/.claude/agents/deep-research.md',
        expect.objectContaining({ force: true })
      )
    })

    it('resolves ~ for global scope', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('~/.claude/skills/')
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof fs.lstatSync>)
      vi.mocked(fs.readdirSync).mockReturnValue(['other-file'] as unknown as ReturnType<
        typeof fs.readdirSync
      >)

      canonicalModule.removeFileSymlinks(
        '/project',
        'deep-research',
        'agents',
        ['claude-code'],
        'global'
      )

      expect(fs.rmSync).toHaveBeenCalledWith(
        '/home/testuser/.claude/agents/deep-research.md',
        expect.objectContaining({ force: true })
      )
    })

    it('cleans up empty parent directories', () => {
      const rmSyncCalls: string[] = []

      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/')
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => true,
      } as ReturnType<typeof fs.lstatSync>)
      vi.mocked(fs.rmSync).mockImplementation((path) => {
        rmSyncCalls.push(path as string)
      })
      vi.mocked(fs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>)

      canonicalModule.removeFileSymlinks(
        '/project',
        'deep-research',
        'agents',
        ['claude-code'],
        'project'
      )

      // Should remove the symlink, then clean up empty .claude/agents dir
      expect(rmSyncCalls).toContain('/project/.claude/agents/deep-research.md')
    })
  })

  describe('removeCanonicalFile', () => {
    it('removes the canonical file when it exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readdirSync).mockReturnValue(['something'] as unknown as ReturnType<
        typeof fs.readdirSync
      >)

      canonicalModule.removeCanonicalFile('/project', 'deep-research', 'agents', 'project')

      expect(fs.unlinkSync).toHaveBeenCalledWith('/project/.agents/agents/deep-research.md')
    })

    it('does nothing when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      canonicalModule.removeCanonicalFile('/project', 'deep-research', 'agents', 'project')

      expect(fs.unlinkSync).not.toHaveBeenCalled()
    })

    it('removes from home directory for global scope', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readdirSync).mockReturnValue(['something'] as unknown as ReturnType<
        typeof fs.readdirSync
      >)

      canonicalModule.removeCanonicalFile('/project', 'deep-research', 'agents', 'global')

      expect(fs.unlinkSync).toHaveBeenCalledWith('/home/testuser/.agents/agents/deep-research.md')
    })

    it('cleans up empty parent directories', () => {
      const rmSyncCalls: string[] = []

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.rmSync).mockImplementation((path) => {
        rmSyncCalls.push(path as string)
      })
      vi.mocked(fs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>)

      canonicalModule.removeCanonicalFile('/project', 'deep-research', 'agents', 'project')

      // Should clean up empty .agents/agents dir and .agents dir
      expect(rmSyncCalls).toContain('/project/.agents/agents')
      expect(rmSyncCalls).toContain('/project/.agents')
    })

    it('stops cleanup at home directory boundary for global scope', () => {
      const rmSyncCalls: string[] = []

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.rmSync).mockImplementation((path) => {
        rmSyncCalls.push(path as string)
      })
      vi.mocked(fs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>)

      canonicalModule.removeCanonicalFile('/project', 'deep-research', 'agents', 'global')

      expect(rmSyncCalls).not.toContain('/home/testuser')
    })
  })

  describe('isSymlinkedInstall with category', () => {
    it('returns true for agents category when canonical file exists and is a file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.lstatSync).mockReturnValue({
        isFile: () => true,
        isDirectory: () => false,
      } as ReturnType<typeof fs.lstatSync>)

      expect(
        canonicalModule.isSymlinkedInstall('/project', 'deep-research', 'project', 'agents')
      ).toBe(true)
    })

    it('returns false for agents category when path does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      expect(
        canonicalModule.isSymlinkedInstall('/project', 'deep-research', 'project', 'agents')
      ).toBe(false)
    })

    it('returns false for agents category when path is a directory', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.lstatSync).mockReturnValue({
        isFile: () => false,
        isDirectory: () => true,
      } as ReturnType<typeof fs.lstatSync>)

      expect(
        canonicalModule.isSymlinkedInstall('/project', 'deep-research', 'project', 'agents')
      ).toBe(false)
    })

    it('still works for skills category (default)', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.lstatSync).mockReturnValue({
        isDirectory: () => true,
        isFile: () => false,
      } as ReturnType<typeof fs.lstatSync>)

      expect(canonicalModule.isSymlinkedInstall('/project', 'my-skill')).toBe(true)
    })
  })

  describe('resolveReadPath with category', () => {
    it('returns canonical file path when it exists for agents category', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.lstatSync).mockReturnValue({
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
      } as ReturnType<typeof fs.lstatSync>)

      const result = canonicalModule.resolveReadPath(
        '/project',
        'deep-research',
        ['claude-code'],
        'project',
        'agents'
      )
      expect(result).toBe('/project/.agents/agents/deep-research.md')
    })

    it('falls back to agent-specific file path for agents category', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/')
      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(false) // canonical file doesn't exist
        .mockReturnValueOnce(true) // agent-specific file exists

      vi.mocked(fs.lstatSync).mockReturnValue({
        isFile: () => false,
        isDirectory: () => false,
        isSymbolicLink: () => false,
      } as ReturnType<typeof fs.lstatSync>)

      const result = canonicalModule.resolveReadPath(
        '/project',
        'deep-research',
        ['claude-code'],
        'project',
        'agents'
      )
      expect(result).toBe('/project/.claude/agents/deep-research.md')
    })

    it('returns null when no paths exist for agents category', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/')
      vi.mocked(fs.existsSync).mockReturnValue(false)
      vi.mocked(fs.lstatSync).mockImplementation(() => {
        throw new Error('ENOENT')
      })

      const result = canonicalModule.resolveReadPath(
        '/project',
        'deep-research',
        ['claude-code'],
        'project',
        'agents'
      )
      expect(result).toBeNull()
    })

    it('resolves symlink for agents category fallback', () => {
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/')
      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(false) // canonical doesn't exist
        .mockReturnValueOnce(true) // agent path exists
        .mockReturnValueOnce(true) // resolved target exists

      vi.mocked(fs.lstatSync).mockReturnValue({
        isFile: () => false,
        isDirectory: () => false,
        isSymbolicLink: () => true,
      } as ReturnType<typeof fs.lstatSync>)

      vi.mocked(fs.readlinkSync).mockReturnValue('../../.agents/agents/deep-research.md')

      const result = canonicalModule.resolveReadPath(
        '/project',
        'deep-research',
        ['claude-code'],
        'project',
        'agents'
      )
      expect(result).toBe('/project/.agents/agents/deep-research.md')
    })

    it('still works for default skills category', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.lstatSync).mockReturnValue({
        isDirectory: () => true,
        isSymbolicLink: () => false,
      } as ReturnType<typeof fs.lstatSync>)

      const result = canonicalModule.resolveReadPath('/project', 'my-skill', ['claude'])
      expect(result).toBe('/project/.agents/skills/my-skill')
    })
  })
})
