import { describe, expect, it, vi } from 'vitest'

vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('/home/testuser'),
}))

import { resolvePlacementPath } from '../../utils/paths'

describe('utils/resolvePlacementPath', () => {
  describe('global scope', () => {
    it('expands ~ to the home directory for a valid tilde path', () => {
      expect(resolvePlacementPath('~/.agents/skills/my-skill', '/project', 'global')).toBe(
        '/home/testuser/.agents/skills/my-skill'
      )
    })

    it('returns null for a path traversal attempt via ~/../', () => {
      expect(resolvePlacementPath('~/../etc/passwd', '/project', 'global')).toBeNull()
    })

    it('returns null when the path does not start with ~', () => {
      expect(resolvePlacementPath('/abs/path/skill', '/project', 'global')).toBeNull()
    })

    it('returns null for an empty string', () => {
      expect(resolvePlacementPath('', '/project', 'global')).toBeNull()
    })

    it('returns null for bare ~ (too broad — would resolve to home directory)', () => {
      expect(resolvePlacementPath('~', '/project', 'global')).toBeNull()
    })

    it('expands a deeply nested tilde path correctly', () => {
      expect(resolvePlacementPath('~/.a/b/c', '/project', 'global')).toBe('/home/testuser/.a/b/c')
    })
  })

  describe('project scope', () => {
    it('resolves a relative path against the project root', () => {
      expect(resolvePlacementPath('.claude/skills/my-skill', '/project', 'project')).toBe(
        '/project/.claude/skills/my-skill'
      )
    })

    it('returns null for a path traversal attempt', () => {
      expect(resolvePlacementPath('../../etc/passwd', '/project', 'project')).toBeNull()
    })

    it('resolves a nested relative path correctly', () => {
      expect(resolvePlacementPath('.claude/skills/org/my-skill', '/project', 'project')).toBe(
        '/project/.claude/skills/org/my-skill'
      )
    })

    it('path.join normalises absolute input under projectRoot — not a supported input but cannot escape root', () => {
      // path.join('/project', '/etc/passwd') = '/project/etc/passwd'
      // This is a Node.js path.join artefact, not a supported input from getSkillPlacementPath
      expect(resolvePlacementPath('/etc/passwd', '/project', 'project')).toBe('/project/etc/passwd')
    })
  })
})
