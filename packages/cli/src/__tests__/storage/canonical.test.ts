import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  lstatSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  readlinkSync: vi.fn(),
  rmSync: vi.fn(),
  symlinkSync: vi.fn(),
}))

vi.mock('@agentver/agent-definitions', () => ({
  getSkillPlacementPath: vi.fn(),
}))

vi.mock('@agentver/shared', () => ({
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
  })
})
