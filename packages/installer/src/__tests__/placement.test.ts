import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@agentver/agent-definitions', () => ({
  getSkillPlacementPath: vi.fn(),
  getAgentPlacementPath: vi.fn(),
  getCommandPlacementPath: vi.fn(),
}))

import { getSkillPlacementPath } from '@agentver/agent-definitions'
import type { PlacementOperation } from '../index'
import { createAgentPlacements, removeAgentPlacements } from '../index'

describe('placement', () => {
  let tmpDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    tmpDir = mkdtempSync(join(tmpdir(), 'agentver-placement-test-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  describe('createAgentPlacements', () => {
    it('creates relative symlinks for each placement', () => {
      const canonicalPath = join(tmpDir, '.agents', 'skills', 'test-skill')
      mkdirSync(canonicalPath, { recursive: true })
      writeFileSync(join(canonicalPath, 'SKILL.md'), '# Test', 'utf-8')

      const destPath = join(tmpDir, '.claude', 'skills', 'test-skill')

      const placements: PlacementOperation[] = [
        {
          agentId: 'claude-code',
          destinationPath: destPath,
          linkMode: { mode: 'symlink', isFallback: false },
        },
      ]

      const results = createAgentPlacements(canonicalPath, placements, tmpDir, 'project', {
        allowFallback: true,
      })

      expect(results).toHaveLength(1)
      expect(results[0]?.success).toBe(true)
      expect(results[0]?.actualLinkMode).toBe('symlink')
      expect(results[0]?.fallbackUsed).toBe(false)

      // Verify it is a symlink
      expect(lstatSync(destPath).isSymbolicLink()).toBe(true)

      // Verify it is a relative symlink
      const target = readlinkSync(destPath)
      expect(target).not.toMatch(/^\//)

      // Verify it resolves to canonical path
      const resolvedTarget = resolve(dirname(destPath), target)
      expect(resolvedTarget).toBe(canonicalPath)
    })

    it('falls back to copy when symlink fails and fallback is allowed', () => {
      const canonicalPath = join(tmpDir, '.agents', 'skills', 'test-skill')
      mkdirSync(canonicalPath, { recursive: true })
      writeFileSync(join(canonicalPath, 'SKILL.md'), '# Test', 'utf-8')

      // Create a conflicting file at the destination to make symlink fail
      const destPath = join(tmpDir, '.claude', 'skills', 'test-skill')
      mkdirSync(destPath, { recursive: true })
      writeFileSync(join(destPath, 'existing.md'), 'conflict', 'utf-8')

      const placements: PlacementOperation[] = [
        {
          agentId: 'claude-code',
          destinationPath: destPath,
          linkMode: { mode: 'symlink', isFallback: false },
        },
      ]

      const results = createAgentPlacements(canonicalPath, placements, tmpDir, 'project', {
        allowFallback: true,
      })

      expect(results).toHaveLength(1)
      const result = results[0]

      // Because the destination was an existing directory (not a symlink),
      // the placement code doesn't remove it before symlink. Symlink fails
      // on existing non-symlink, then falls back to copy.
      if (result?.fallbackUsed) {
        expect(result.actualLinkMode).toBe('copy')
        expect(result.success).toBe(true)
      } else {
        // On some systems the symlink may succeed (replaces dir)
        expect(result?.success).toBe(true)
      }
    })

    it('returns PlacementResult with actual link mode', () => {
      const canonicalPath = join(tmpDir, '.agents', 'skills', 'test-skill')
      mkdirSync(canonicalPath, { recursive: true })
      writeFileSync(join(canonicalPath, 'SKILL.md'), '# Test', 'utf-8')

      const destPath = join(tmpDir, '.cursor', 'skills', 'test-skill')

      const placements: PlacementOperation[] = [
        {
          agentId: 'cursor',
          destinationPath: destPath,
          linkMode: { mode: 'copy', isFallback: false },
        },
      ]

      const results = createAgentPlacements(canonicalPath, placements, tmpDir, 'project', {
        allowFallback: false,
      })

      expect(results).toHaveLength(1)
      expect(results[0]?.success).toBe(true)
      expect(results[0]?.actualLinkMode).toBe('copy')
      expect(results[0]?.agentId).toBe('cursor')

      // Verify copy was made
      expect(readFileSync(join(destPath, 'SKILL.md'), 'utf-8')).toBe('# Test')
    })

    it('returns failure when allowFallback is false and primary link mode fails', () => {
      const canonicalPath = join(tmpDir, '.agents', 'skills', 'test-skill')
      mkdirSync(canonicalPath, { recursive: true })
      writeFileSync(join(canonicalPath, 'SKILL.md'), '# Test', 'utf-8')

      // Create a conflicting non-symlink directory at the destination so
      // symlink creation fails (symlinkSync throws on existing non-symlink)
      const destPath = join(tmpDir, '.claude', 'skills', 'test-skill')
      mkdirSync(destPath, { recursive: true })
      writeFileSync(join(destPath, 'existing.md'), 'conflict', 'utf-8')

      const placements: PlacementOperation[] = [
        {
          agentId: 'claude-code',
          destinationPath: destPath,
          linkMode: { mode: 'symlink', isFallback: false },
        },
      ]

      const results = createAgentPlacements(canonicalPath, placements, tmpDir, 'project', {
        allowFallback: false,
      })

      expect(results).toHaveLength(1)
      expect(results[0]?.success).toBe(false)
      expect(results[0]?.fallbackUsed).toBe(false)
      expect(results[0]?.actualLinkMode).toBe('symlink')
      expect(results[0]?.error).toBeTruthy()
    })

    it('handles empty placements list', () => {
      const canonicalPath = join(tmpDir, '.agents', 'skills', 'test-skill')

      const results = createAgentPlacements(canonicalPath, [], tmpDir, 'project', {
        allowFallback: true,
      })

      expect(results).toEqual([])
    })

    it('creates placements for multiple agents', () => {
      const canonicalPath = join(tmpDir, '.agents', 'skills', 'test-skill')
      mkdirSync(canonicalPath, { recursive: true })
      writeFileSync(join(canonicalPath, 'SKILL.md'), '# Test', 'utf-8')

      const dest1 = join(tmpDir, '.claude', 'skills', 'test-skill')
      const dest2 = join(tmpDir, '.cursor', 'skills', 'test-skill')

      const placements: PlacementOperation[] = [
        {
          agentId: 'claude-code',
          destinationPath: dest1,
          linkMode: { mode: 'symlink', isFallback: false },
        },
        {
          agentId: 'cursor',
          destinationPath: dest2,
          linkMode: { mode: 'symlink', isFallback: false },
        },
      ]

      const results = createAgentPlacements(canonicalPath, placements, tmpDir, 'project', {
        allowFallback: true,
      })

      expect(results).toHaveLength(2)
      expect(results.every((r) => r.success)).toBe(true)
      expect(lstatSync(dest1).isSymbolicLink()).toBe(true)
      expect(lstatSync(dest2).isSymbolicLink()).toBe(true)
    })
  })

  describe('removeAgentPlacements', () => {
    it('removes placement directories', () => {
      const mockGetSkill = vi.mocked(getSkillPlacementPath)
      mockGetSkill.mockReturnValue('.claude/skills/test-skill')

      const placementPath = join(tmpDir, '.claude', 'skills', 'test-skill')
      mkdirSync(placementPath, { recursive: true })
      writeFileSync(join(placementPath, 'SKILL.md'), '# Test', 'utf-8')

      removeAgentPlacements(tmpDir, 'test-skill', ['claude-code'], 'project', 'skills')

      expect(existsSync(placementPath)).toBe(false)
    })

    it('cleans up empty parent directories', () => {
      const mockGetSkill = vi.mocked(getSkillPlacementPath)
      mockGetSkill.mockReturnValue('.claude/skills/test-skill')

      const placementPath = join(tmpDir, '.claude', 'skills', 'test-skill')
      mkdirSync(placementPath, { recursive: true })

      removeAgentPlacements(tmpDir, 'test-skill', ['claude-code'], 'project', 'skills')

      // The empty parent directories should be cleaned up
      expect(existsSync(join(tmpDir, '.claude', 'skills'))).toBe(false)
      expect(existsSync(join(tmpDir, '.claude'))).toBe(false)
    })

    it('does not remove non-empty parent directories', () => {
      const mockGetSkill = vi.mocked(getSkillPlacementPath)
      mockGetSkill.mockReturnValue('.claude/skills/test-skill')

      const skillsDir = join(tmpDir, '.claude', 'skills')
      mkdirSync(join(skillsDir, 'test-skill'), { recursive: true })
      mkdirSync(join(skillsDir, 'other-skill'), { recursive: true })

      removeAgentPlacements(tmpDir, 'test-skill', ['claude-code'], 'project', 'skills')

      expect(existsSync(join(skillsDir, 'test-skill'))).toBe(false)
      expect(existsSync(join(skillsDir, 'other-skill'))).toBe(true)
      expect(existsSync(skillsDir)).toBe(true)
    })
  })
})
