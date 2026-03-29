import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
  debug: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
  setSecret: vi.fn(),
  getInput: vi.fn(),
  getBooleanInput: vi.fn(),
  summary: {
    addRaw: vi.fn().mockReturnThis(),
    write: vi.fn().mockResolvedValue(undefined),
  },
}))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import * as core from '@actions/core'
import type { InstallResult } from '../reporter'
import { buildSummary, generateJobSummary, setOutputs } from '../reporter'

describe('reporter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------------------
  // buildSummary
  // ---------------------------------------------------------------------------

  describe('buildSummary', () => {
    it('counts successful and failed installations', () => {
      const results: InstallResult[] = [
        { name: 'org/a', version: '1.0.0', agents: ['claude-code'], fileCount: 2, success: true },
        { name: 'org/b', version: '1.0.0', agents: ['cursor'], fileCount: 1, success: true },
        {
          name: 'org/c',
          version: '1.0.0',
          agents: [],
          fileCount: 0,
          success: false,
          error: 'Failed',
        },
      ]

      const summary = buildSummary(results)

      expect(summary.totalInstalled).toBe(2)
      expect(summary.totalFailed).toBe(1)
      expect(summary.results).toHaveLength(3)
    })

    it('collects unique agent IDs from successful results', () => {
      const results: InstallResult[] = [
        {
          name: 'org/a',
          version: '1.0.0',
          agents: ['claude-code', 'cursor'],
          fileCount: 2,
          success: true,
        },
        {
          name: 'org/b',
          version: '1.0.0',
          agents: ['claude-code', 'windsurf'],
          fileCount: 1,
          success: true,
        },
      ]

      const summary = buildSummary(results)

      expect(summary.allAgents).toContain('claude-code')
      expect(summary.allAgents).toContain('cursor')
      expect(summary.allAgents).toContain('windsurf')
      expect(summary.allAgents).toHaveLength(3)
    })

    it('returns empty agents list when all results failed', () => {
      const results: InstallResult[] = [
        {
          name: 'org/a',
          version: '1.0.0',
          agents: [],
          fileCount: 0,
          success: false,
          error: 'Fail',
        },
      ]

      const summary = buildSummary(results)
      expect(summary.allAgents).toHaveLength(0)
    })

    it('handles empty results array', () => {
      const summary = buildSummary([])

      expect(summary.totalInstalled).toBe(0)
      expect(summary.totalFailed).toBe(0)
      expect(summary.allAgents).toHaveLength(0)
      expect(summary.results).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // setOutputs
  // ---------------------------------------------------------------------------

  describe('setOutputs', () => {
    it('sets installed-count output', () => {
      const summary = buildSummary([
        { name: 'org/a', version: '1.0.0', agents: ['claude-code'], fileCount: 1, success: true },
      ])

      setOutputs(summary)

      expect(core.setOutput).toHaveBeenCalledWith('installed-count', '1')
    })

    it('sets installed-skills as JSON array of successful package names', () => {
      const summary = buildSummary([
        { name: 'org/a', version: '1.0.0', agents: ['claude-code'], fileCount: 1, success: true },
        {
          name: 'org/b',
          version: '1.0.0',
          agents: [],
          fileCount: 0,
          success: false,
          error: 'Fail',
        },
        { name: 'org/c', version: '2.0.0', agents: ['cursor'], fileCount: 2, success: true },
      ])

      setOutputs(summary)

      expect(core.setOutput).toHaveBeenCalledWith(
        'installed-skills',
        JSON.stringify(['org/a', 'org/c'])
      )
    })

    it('sets agents-configured as comma-separated list', () => {
      const summary = buildSummary([
        {
          name: 'org/a',
          version: '1.0.0',
          agents: ['claude-code', 'cursor'],
          fileCount: 1,
          success: true,
        },
      ])

      setOutputs(summary)

      expect(core.setOutput).toHaveBeenCalledWith('agents-configured', 'claude-code,cursor')
    })

    it('sets empty outputs when no packages were installed', () => {
      const summary = buildSummary([])

      setOutputs(summary)

      expect(core.setOutput).toHaveBeenCalledWith('installed-count', '0')
      expect(core.setOutput).toHaveBeenCalledWith('installed-skills', '[]')
      expect(core.setOutput).toHaveBeenCalledWith('agents-configured', '')
    })
  })

  // ---------------------------------------------------------------------------
  // generateJobSummary
  // ---------------------------------------------------------------------------

  describe('generateJobSummary', () => {
    it('generates a markdown summary with installed count', async () => {
      const summary = buildSummary([
        { name: 'org/a', version: '1.0.0', agents: ['claude-code'], fileCount: 2, success: true },
      ])

      await generateJobSummary(summary)

      expect(core.summary.addRaw).toHaveBeenCalledOnce()
      const markdown = vi.mocked(core.summary.addRaw).mock.calls[0]![0] as string

      expect(markdown).toContain('## Agentver Skill Installation')
      expect(markdown).toContain('**1** skill(s) installed successfully')
      expect(markdown).toContain('org/a')
      expect(markdown).toContain('1.0.0')
      expect(markdown).toContain('claude-code')
      expect(markdown).toContain('Installed')
    })

    it('includes failure information for failed packages', async () => {
      const summary = buildSummary([
        {
          name: 'org/a',
          version: '1.0.0',
          agents: [],
          fileCount: 0,
          success: false,
          error: 'Network timeout',
        },
      ])

      await generateJobSummary(summary)

      const markdown = vi.mocked(core.summary.addRaw).mock.calls[0]![0] as string
      expect(markdown).toContain('**1** skill(s) failed to install')
      expect(markdown).toContain('Failed: Network timeout')
    })

    it('lists configured agents', async () => {
      const summary = buildSummary([
        {
          name: 'org/a',
          version: '1.0.0',
          agents: ['claude-code', 'cursor'],
          fileCount: 1,
          success: true,
        },
      ])

      await generateJobSummary(summary)

      const markdown = vi.mocked(core.summary.addRaw).mock.calls[0]![0] as string
      expect(markdown).toContain('**Agents configured:** claude-code, cursor')
    })

    it('generates a table with all results', async () => {
      const summary = buildSummary([
        { name: 'org/a', version: '1.0.0', agents: ['claude-code'], fileCount: 2, success: true },
        {
          name: 'org/b',
          version: '2.0.0',
          agents: [],
          fileCount: 0,
          success: false,
          error: 'Error',
        },
      ])

      await generateJobSummary(summary)

      const markdown = vi.mocked(core.summary.addRaw).mock.calls[0]![0] as string
      expect(markdown).toContain('| Skill | Version | Agents | Files | Status |')
      expect(markdown).toContain('| org/a | 1.0.0 | claude-code | 2 | Installed |')
      expect(markdown).toContain('| org/b | 2.0.0 | - | 0 | Failed: Error |')
    })

    it('calls summary.write() to persist the summary', async () => {
      const summary = buildSummary([])

      await generateJobSummary(summary)

      expect(core.summary.write).toHaveBeenCalledOnce()
    })
  })
})
