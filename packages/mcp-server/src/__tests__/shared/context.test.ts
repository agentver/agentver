import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  detectAgents,
  getGlobalConfigDirectory,
  getWorkingDirectory,
  isAgentverProject,
} from '../../shared/context'

describe('context', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  // ---------------------------------------------------------------------------
  // getWorkingDirectory
  // ---------------------------------------------------------------------------

  describe('getWorkingDirectory', () => {
    it('returns AGENTVER_PROJECT_ROOT when set', () => {
      process.env.AGENTVER_PROJECT_ROOT = '/custom/path'
      expect(getWorkingDirectory()).toBe('/custom/path')
    })

    it('falls back to process.cwd() when AGENTVER_PROJECT_ROOT is not set', () => {
      delete process.env.AGENTVER_PROJECT_ROOT
      expect(getWorkingDirectory()).toBe(process.cwd())
    })
  })

  // ---------------------------------------------------------------------------
  // getGlobalConfigDirectory
  // ---------------------------------------------------------------------------

  describe('getGlobalConfigDirectory', () => {
    it('returns ~/.agentver', () => {
      expect(getGlobalConfigDirectory()).toBe(join(homedir(), '.agentver'))
    })
  })

  // ---------------------------------------------------------------------------
  // isAgentverProject
  // ---------------------------------------------------------------------------

  describe('isAgentverProject', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = join(
        tmpdir(),
        `agentver-ctx-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
      )
      mkdirSync(tempDir, { recursive: true })
    })

    afterEach(() => {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('returns true when .agentver directory exists', () => {
      mkdirSync(join(tempDir, '.agentver'), { recursive: true })
      expect(isAgentverProject(tempDir)).toBe(true)
    })

    it('returns false when .agentver directory does not exist', () => {
      expect(isAgentverProject(tempDir)).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // detectAgents
  // ---------------------------------------------------------------------------

  describe('detectAgents', () => {
    it('returns an array (may be empty for a temp directory)', () => {
      const tempDir = join(
        tmpdir(),
        `agentver-detect-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
      )
      mkdirSync(tempDir, { recursive: true })

      try {
        const result = detectAgents(tempDir)
        expect(Array.isArray(result)).toBe(true)
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('detects agents when config directories exist', () => {
      const tempDir = join(
        tmpdir(),
        `agentver-detect-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
      )
      mkdirSync(tempDir, { recursive: true })

      // Create a .claude directory to simulate Claude Code presence
      mkdirSync(join(tempDir, '.claude'), { recursive: true })

      try {
        const result = detectAgents(tempDir)
        const agentIds = result.map((a) => a.id)
        expect(agentIds).toContain('claude-code')
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })
})
