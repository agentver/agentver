import { beforeEach, describe, expect, it, vi } from 'vitest'
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

const mockRestoreFromManifest = vi.mocked(restoreFromManifest)

describe('registerCiCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is a function that can register on a Commander program', () => {
    expect(typeof registerCiCommand).toBe('function')
  })

  it('restoreFromManifest is importable and mockable', () => {
    mockRestoreFromManifest.mockResolvedValue(undefined)
    expect(mockRestoreFromManifest).not.toHaveBeenCalled()
  })
})
