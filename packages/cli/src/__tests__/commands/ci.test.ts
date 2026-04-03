import { ciResultSchema, type RestoreResultOutput } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNoopSpinner } from '../helpers/mock-spinner.js'

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../../commands/install.js', () => ({
  restoreFromManifest: vi.fn(),
}))

vi.mock('../../output.js', () => ({
  isJSONMode: vi.fn().mockReturnValue(false),
  isVerbose: vi.fn().mockReturnValue(false),
  isQuiet: vi.fn().mockReturnValue(false),
  createSpinner: vi.fn().mockReturnValue(createNoopSpinner()),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
}))

const { restoreFromManifest } = await import('../../commands/install.js')
const { registerCiCommand } = await import('../../commands/ci.js')
const outputModule = await import('../../output.js')

const mockRestoreFromManifest = vi.mocked(restoreFromManifest)

// ---------------------------------------------------------------------------
// Helper: extract the action handler registered by registerCiCommand
// ---------------------------------------------------------------------------

type CiOptions = {
  agent?: string | string[]
  global?: boolean
  skipAudit?: boolean
  concurrency?: number
}

type CiAction = (options: CiOptions) => Promise<void>

function getCiAction(): CiAction {
  const mockProgram = {
    command: vi.fn().mockReturnThis(),
    description: vi.fn().mockReturnThis(),
    option: vi.fn().mockReturnThis(),
    action: vi.fn().mockReturnThis(),
  }

  registerCiCommand(mockProgram as never)

  return mockProgram.action.mock.calls[0]![0] as CiAction
}

// ---------------------------------------------------------------------------
// Fixture: a successful restore result
// ---------------------------------------------------------------------------

function createRestoreResult(overrides?: Partial<RestoreResultOutput>): RestoreResultOutput {
  return {
    type: 'RESTORE_COMPLETE',
    packages: [
      {
        packageKey: 'test-skill',
        displayName: 'test-skill',
        status: 'installed',
        agents: ['claude-code'],
        filesPlacedCount: 2,
      },
    ],
    installedCount: 1,
    upToDateCount: 0,
    skippedCount: 0,
    failedCount: 0,
    success: true,
    ...overrides,
  }
}

describe('registerCiCommand', () => {
  const originalExitCode = process.exitCode
  const originalExit = process.exit

  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    process.exit = vi.fn() as never
    vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
  })

  afterEach(() => {
    process.exitCode = originalExitCode
    process.exit = originalExit
  })

  it('is a function that can register on a Commander program', () => {
    expect(typeof registerCiCommand).toBe('function')
  })

  // -------------------------------------------------------------------------
  // Flag pass-through
  // -------------------------------------------------------------------------

  describe('flag pass-through to restoreFromManifest', () => {
    it('passes --agent flag through', async () => {
      mockRestoreFromManifest.mockResolvedValue(undefined)

      const action = getCiAction()
      await action({ agent: ['cursor'] })

      expect(mockRestoreFromManifest).toHaveBeenCalledWith(
        expect.objectContaining({ agent: ['cursor'] })
      )
    })

    it('passes --global flag through', async () => {
      mockRestoreFromManifest.mockResolvedValue(undefined)

      const action = getCiAction()
      await action({ global: true })

      expect(mockRestoreFromManifest).toHaveBeenCalledWith(
        expect.objectContaining({ global: true })
      )
    })

    it('passes --skip-audit flag through', async () => {
      mockRestoreFromManifest.mockResolvedValue(undefined)

      const action = getCiAction()
      await action({ skipAudit: true })

      expect(mockRestoreFromManifest).toHaveBeenCalledWith(
        expect.objectContaining({ skipAudit: true })
      )
    })

    it('passes --concurrency option through', async () => {
      mockRestoreFromManifest.mockResolvedValue(undefined)

      const action = getCiAction()
      await action({ concurrency: 8 })

      expect(mockRestoreFromManifest).toHaveBeenCalledWith(
        expect.objectContaining({ concurrency: 8 })
      )
    })

    it('always sets yes=true and force=false for CI mode', async () => {
      mockRestoreFromManifest.mockResolvedValue(undefined)

      const action = getCiAction()
      await action({})

      expect(mockRestoreFromManifest).toHaveBeenCalledWith(
        expect.objectContaining({ yes: true, force: false, offline: false })
      )
    })
  })

  // -------------------------------------------------------------------------
  // Exit codes
  // -------------------------------------------------------------------------

  describe('exit codes', () => {
    it('calls process.exit(1) when restoreFromManifest throws', async () => {
      mockRestoreFromManifest.mockRejectedValue(new Error('network failure'))

      const action = getCiAction()
      await action({})

      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('sets exitCode=1 in JSON mode when restore reports failure', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      mockRestoreFromManifest.mockResolvedValue(
        createRestoreResult({ success: false, failedCount: 1 })
      )

      const action = getCiAction()
      await action({})

      expect(process.exitCode).toBe(1)
    })

    it('does not set exitCode when restore succeeds in JSON mode', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      mockRestoreFromManifest.mockResolvedValue(createRestoreResult({ success: true }))

      const action = getCiAction()
      await action({})

      expect(process.exitCode).not.toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // JSON output validation
  // -------------------------------------------------------------------------

  describe('JSON output', () => {
    it('outputs a result that validates against ciResultSchema', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      const restoreResult = createRestoreResult()
      mockRestoreFromManifest.mockResolvedValue(restoreResult)

      const action = getCiAction()
      await action({})

      expect(outputModule.outputSuccess).toHaveBeenCalledTimes(1)
      const emitted = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0]

      // The emitted object must parse cleanly against the shared schema
      const parseResult = ciResultSchema.safeParse(emitted)
      expect(parseResult.success).toBe(true)
    })

    it('constructs a default restore envelope when restoreFromManifest returns undefined', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      mockRestoreFromManifest.mockResolvedValue(undefined)

      const action = getCiAction()
      await action({})

      expect(outputModule.outputSuccess).toHaveBeenCalledTimes(1)
      const emitted = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0]

      const parseResult = ciResultSchema.safeParse(emitted)
      expect(parseResult.success).toBe(true)

      // The fallback should report zero packages
      expect(emitted).toEqual(
        expect.objectContaining({
          success: true,
          restore: expect.objectContaining({
            type: 'RESTORE_COMPLETE',
            packages: [],
            installedCount: 0,
          }),
        })
      )
    })

    it('calls outputError with CI_FAILED code when restoreFromManifest throws in JSON mode', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      mockRestoreFromManifest.mockRejectedValue(new Error('something broke'))

      const action = getCiAction()
      await action({})

      expect(outputModule.outputError).toHaveBeenCalledWith('CI_FAILED', 'something broke')
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -------------------------------------------------------------------------
  // Stderr output for non-JSON errors
  // -------------------------------------------------------------------------

  describe('non-JSON error output', () => {
    it('writes error message to stderr when not in JSON mode', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

      mockRestoreFromManifest.mockRejectedValue(new Error('disk full'))

      const action = getCiAction()
      await action({})

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('disk full'))
      stderrSpy.mockRestore()
    })

    it('suppresses CANCELLED errors in non-JSON mode', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

      const { AgentverError } = await import('@agentver/shared')
      mockRestoreFromManifest.mockRejectedValue(new AgentverError('CANCELLED', 'User cancelled'))

      const action = getCiAction()
      await action({})

      // Should not write the cancellation message to stderr
      expect(stderrSpy).not.toHaveBeenCalledWith(expect.stringContaining('User cancelled'))
      stderrSpy.mockRestore()
    })
  })

  // -------------------------------------------------------------------------
  // Empty manifest
  // -------------------------------------------------------------------------

  describe('empty manifest', () => {
    it('produces a clean exit when restoreFromManifest returns undefined', async () => {
      mockRestoreFromManifest.mockResolvedValue(undefined)

      const action = getCiAction()
      await action({})

      // Non-JSON mode: no outputSuccess call, no exit code set
      expect(outputModule.outputSuccess).not.toHaveBeenCalled()
      expect(process.exitCode).not.toBe(1)
      expect(process.exit).not.toHaveBeenCalled()
    })

    it('in JSON mode with undefined restore still emits valid schema output', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      mockRestoreFromManifest.mockResolvedValue(undefined)

      const action = getCiAction()
      await action({})

      const emitted = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0]
      expect(emitted).toEqual(
        expect.objectContaining({
          success: true,
          restore: expect.objectContaining({ type: 'RESTORE_COMPLETE' }),
        })
      )
    })
  })
})
