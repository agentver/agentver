import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@agentver/agent-definitions', () => ({
  getSkillPlacementPath: vi.fn(),
  getAgentPlacementPath: vi.fn(),
  getCommandPlacementPath: vi.fn(),
}))

import { getSkillPlacementPath } from '@agentver/agent-definitions'
import { detectConflicts, isAgentverManagedSymlink } from '../index'

describe('conflict', () => {
  let tmpDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    tmpDir = mkdtempSync(join(tmpdir(), 'agentver-conflict-test-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  describe('detectConflicts', () => {
    it('returns no conflicts when placement paths do not exist', () => {
      const mockGetSkill = vi.mocked(getSkillPlacementPath)
      mockGetSkill.mockReturnValue('.claude/skills/test-skill')

      const canonicalPath = join(tmpDir, '.agents', 'skills', 'test-skill')

      const conflicts = detectConflicts(
        tmpDir,
        'test-skill',
        ['claude-code'],
        'project',
        'skills',
        canonicalPath
      )

      expect(conflicts).toEqual([])
    })

    it('detects a non-symlink directory at the placement path', () => {
      const placementRelative = '.claude/skills/test-skill'
      const mockGetSkill = vi.mocked(getSkillPlacementPath)
      mockGetSkill.mockReturnValue(placementRelative)

      const placementFull = join(tmpDir, placementRelative)
      mkdirSync(placementFull, { recursive: true })
      writeFileSync(join(placementFull, 'SKILL.md'), '# old skill', 'utf-8')

      const canonicalPath = join(tmpDir, '.agents', 'skills', 'test-skill')

      const conflicts = detectConflicts(
        tmpDir,
        'test-skill',
        ['claude-code'],
        'project',
        'skills',
        canonicalPath
      )

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0]?.kind).toBe('directory')
      expect(conflicts[0]?.agentId).toBe('claude-code')
      expect(conflicts[0]?.path).toBe(placementFull)
    })

    it('detects a non-symlink file at the placement path', () => {
      const placementRelative = '.claude/skills/test-skill'
      const mockGetSkill = vi.mocked(getSkillPlacementPath)
      mockGetSkill.mockReturnValue(placementRelative)

      const placementFull = join(tmpDir, placementRelative)
      mkdirSync(join(tmpDir, '.claude', 'skills'), { recursive: true })
      writeFileSync(placementFull, '# plain file', 'utf-8')

      const canonicalPath = join(tmpDir, '.agents', 'skills', 'test-skill')

      const conflicts = detectConflicts(
        tmpDir,
        'test-skill',
        ['claude-code'],
        'project',
        'skills',
        canonicalPath
      )

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0]?.kind).toBe('file')
    })

    it('does NOT flag symlinks to the canonical path as conflicts (Agentver-managed)', () => {
      const placementRelative = '.claude/skills/test-skill'
      const mockGetSkill = vi.mocked(getSkillPlacementPath)
      mockGetSkill.mockReturnValue(placementRelative)

      const canonicalPath = join(tmpDir, '.agents', 'skills', 'test-skill')
      mkdirSync(canonicalPath, { recursive: true })

      const placementFull = join(tmpDir, placementRelative)
      mkdirSync(join(tmpDir, '.claude', 'skills'), { recursive: true })
      const relTarget = relative(join(tmpDir, '.claude', 'skills'), canonicalPath)
      symlinkSync(relTarget, placementFull)

      const conflicts = detectConflicts(
        tmpDir,
        'test-skill',
        ['claude-code'],
        'project',
        'skills',
        canonicalPath
      )

      expect(conflicts).toEqual([])
    })

    it('flags symlinks to a different target as conflicts', () => {
      const placementRelative = '.claude/skills/test-skill'
      const mockGetSkill = vi.mocked(getSkillPlacementPath)
      mockGetSkill.mockReturnValue(placementRelative)

      // Create a symlink pointing to a different location
      const otherTarget = join(tmpDir, 'some-other-dir')
      mkdirSync(otherTarget, { recursive: true })

      const placementFull = join(tmpDir, placementRelative)
      mkdirSync(join(tmpDir, '.claude', 'skills'), { recursive: true })
      const relTarget = relative(join(tmpDir, '.claude', 'skills'), otherTarget)
      symlinkSync(relTarget, placementFull)

      const canonicalPath = join(tmpDir, '.agents', 'skills', 'test-skill')

      const conflicts = detectConflicts(
        tmpDir,
        'test-skill',
        ['claude-code'],
        'project',
        'skills',
        canonicalPath
      )

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0]?.agentId).toBe('claude-code')
    })
  })

  describe('isAgentverManagedSymlink', () => {
    it('returns true for a symlink pointing to the canonical path', () => {
      const canonicalPath = join(tmpDir, 'canonical')
      mkdirSync(canonicalPath, { recursive: true })

      const linkPath = join(tmpDir, 'link')
      const relTarget = relative(tmpDir, canonicalPath)
      symlinkSync(relTarget, linkPath)

      expect(isAgentverManagedSymlink(linkPath, canonicalPath)).toBe(true)
    })

    it('returns false for a symlink pointing elsewhere', () => {
      const canonicalPath = join(tmpDir, 'canonical')
      const otherPath = join(tmpDir, 'other')
      mkdirSync(otherPath, { recursive: true })

      const linkPath = join(tmpDir, 'link')
      const relTarget = relative(tmpDir, otherPath)
      symlinkSync(relTarget, linkPath)

      expect(isAgentverManagedSymlink(linkPath, canonicalPath)).toBe(false)
    })

    it('returns false for a regular file', () => {
      const filePath = join(tmpDir, 'regular.md')
      writeFileSync(filePath, 'content', 'utf-8')

      expect(isAgentverManagedSymlink(filePath, join(tmpDir, 'canonical'))).toBe(false)
    })

    it('returns false for a non-existent path', () => {
      expect(isAgentverManagedSymlink(join(tmpDir, 'missing'), join(tmpDir, 'canonical'))).toBe(
        false
      )
    })
  })
})
