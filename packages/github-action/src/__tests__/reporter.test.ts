import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInstallResult, createInstallSummary } from './helpers/fixtures'

vi.mock('@actions/core', () => ({
  setOutput: vi.fn(),
  summary: { addRaw: vi.fn().mockReturnThis(), write: vi.fn().mockResolvedValue(undefined) },
}))

describe('reporter', () => {
  let core: typeof import('@actions/core')
  let reporter: typeof import('../reporter')

  beforeEach(async () => {
    vi.clearAllMocks()
    core = await import('@actions/core')
    reporter = await import('../reporter')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('buildSummary', () => {
    it('counts successful and failed installs correctly', () => {
      const results = [
        createInstallResult({ success: true }),
        createInstallResult({ name: 'org/failed', success: false }),
        createInstallResult({ name: 'org/success2', success: true }),
      ]

      const summary = reporter.buildSummary(results)
      expect(summary.totalInstalled).toBe(2)
      expect(summary.totalFailed).toBe(1)
    })

    it('deduplicates agent IDs from successful results', () => {
      const results = [
        createInstallResult({ agents: ['claude-code', 'cursor'], success: true }),
        createInstallResult({
          name: 'org/other',
          agents: ['claude-code', 'windsurf'],
          success: true,
        }),
      ]

      const summary = reporter.buildSummary(results)
      expect(summary.allAgents).toEqual(['claude-code', 'cursor', 'windsurf'])
    })

    it('returns empty allAgents when no successful installs', () => {
      const results = [createInstallResult({ success: false })]

      const summary = reporter.buildSummary(results)
      expect(summary.allAgents).toEqual([])
    })

    it('includes all results in summary', () => {
      const results = [
        createInstallResult(),
        createInstallResult({ name: 'org/other', success: false }),
      ]

      const summary = reporter.buildSummary(results)
      expect(summary.results).toHaveLength(2)
    })
  })

  describe('setOutputs', () => {
    it('sets installed-count output as string', () => {
      const summary = createInstallSummary({ totalInstalled: 3 })

      reporter.setOutputs(summary)
      expect(core.setOutput).toHaveBeenCalledWith('installed-count', '3')
    })

    it('sets installed-skills output as JSON array of successful skill names', () => {
      const summary = createInstallSummary({
        results: [
          createInstallResult({ name: 'org/a', success: true }),
          createInstallResult({ name: 'org/b', success: false }),
          createInstallResult({ name: 'org/c', success: true }),
        ],
      })

      reporter.setOutputs(summary)
      expect(core.setOutput).toHaveBeenCalledWith(
        'installed-skills',
        JSON.stringify(['org/a', 'org/c'])
      )
    })

    it('sets agents-configured output as comma-separated agent IDs', () => {
      const summary = createInstallSummary({ allAgents: ['claude-code', 'cursor'] })

      reporter.setOutputs(summary)
      expect(core.setOutput).toHaveBeenCalledWith('agents-configured', 'claude-code,cursor')
    })
  })

  describe('generateJobSummary', () => {
    it('writes markdown with heading', async () => {
      const summary = createInstallSummary()

      await reporter.generateJobSummary(summary)

      expect(core.summary.addRaw).toHaveBeenCalledWith(
        expect.stringContaining('## Agentver Skill Installation')
      )
      expect(core.summary.write).toHaveBeenCalled()
    })

    it('shows installed count when > 0', async () => {
      const summary = createInstallSummary({ totalInstalled: 2 })

      await reporter.generateJobSummary(summary)

      expect(core.summary.addRaw).toHaveBeenCalledWith(
        expect.stringContaining('**2** skill(s) installed successfully')
      )
    })

    it('shows failed count when > 0', async () => {
      const summary = createInstallSummary({ totalFailed: 1 })

      await reporter.generateJobSummary(summary)

      expect(core.summary.addRaw).toHaveBeenCalledWith(
        expect.stringContaining('**1** skill(s) failed to install')
      )
    })

    it('lists configured agents', async () => {
      const summary = createInstallSummary({ allAgents: ['claude-code', 'cursor'] })

      await reporter.generateJobSummary(summary)

      expect(core.summary.addRaw).toHaveBeenCalledWith(
        expect.stringContaining('claude-code, cursor')
      )
    })

    it('generates table with correct columns', async () => {
      const summary = createInstallSummary({
        results: [createInstallResult()],
      })

      await reporter.generateJobSummary(summary)

      const call = vi.mocked(core.summary.addRaw).mock.calls[0]![0] as string
      expect(call).toContain('| Skill | Version | Agents | Files | Status |')
    })

    it('shows "Installed" status for successful results', async () => {
      const summary = createInstallSummary({
        results: [createInstallResult({ success: true })],
      })

      await reporter.generateJobSummary(summary)

      expect(core.summary.addRaw).toHaveBeenCalledWith(expect.stringContaining('Installed'))
    })

    it('shows "Failed: {error}" status for failed results', async () => {
      const summary = createInstallSummary({
        results: [createInstallResult({ success: false, error: 'Network timeout' })],
      })

      await reporter.generateJobSummary(summary)

      expect(core.summary.addRaw).toHaveBeenCalledWith(
        expect.stringContaining('Failed: Network timeout')
      )
    })
  })
})
