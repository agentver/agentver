import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue('---\nname: test\n---\n# Test'),
}))

vi.mock('@agentver/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentver/shared')>()
  return {
    ...actual,
    validateSkillMd: vi.fn().mockReturnValue({
      valid: true,
      errors: [],
      warnings: [],
      specCompliant: true,
      agentverExtensions: [],
    }),
  }
})

vi.mock('chalk', () => {
  const identity = (s: string) => s
  const fn = Object.assign(identity, {
    red: identity,
    green: identity,
    cyan: identity,
    yellow: identity,
    dim: identity,
    bold: identity,
  })
  return { default: fn }
})

vi.mock('../../output.js', () => ({
  isJSONMode: vi.fn().mockReturnValue(false),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { existsSync } from 'node:fs'
import { validateSkillMd } from '@agentver/shared'
import { registerValidateCommand } from '../../commands/validate'
import * as outputModule from '../../output.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ValidateAction = (pathArg: string | undefined) => Promise<void>

function getValidateAction(): ValidateAction {
  const mockProgram = {
    command: vi.fn().mockReturnThis(),
    description: vi.fn().mockReturnThis(),
    addHelpText: vi.fn().mockReturnThis(),
    action: vi.fn().mockReturnThis(),
  }

  registerValidateCommand(mockProgram as never)

  return mockProgram.action.mock.calls[0]![0] as ValidateAction
}

class ExitError extends Error {
  code: number
  constructor(code: number) {
    super(`process.exit(${code})`)
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validate command', () => {
  const originalCwd = process.cwd
  const originalArgv = process.argv
  const originalExit = process.exit
  let validateAction: ValidateAction
  let stdoutSpy: ReturnType<typeof vi.spyOn>
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    process.cwd = vi.fn().mockReturnValue('/project') as never
    process.argv = ['node', 'agentver', 'validate']
    process.exit = vi.fn().mockImplementation((code: number) => {
      throw new ExitError(code)
    }) as never
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
    vi.mocked(existsSync).mockReturnValue(true)
    validateAction = getValidateAction()
  })

  afterEach(() => {
    process.cwd = originalCwd
    process.argv = originalArgv
    process.exit = originalExit
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Path resolution
  // -------------------------------------------------------------------------

  it('defaults to SKILL.md in cwd when no path given', async () => {
    await validateAction(undefined)

    expect(existsSync).toHaveBeenCalledWith('/project/SKILL.md')
  })

  it('resolves a directory path by appending SKILL.md', async () => {
    await validateAction('my-skill')

    expect(existsSync).toHaveBeenCalledWith('/project/my-skill/SKILL.md')
  })

  it('uses .md file path directly', async () => {
    await validateAction('custom.md')

    expect(existsSync).toHaveBeenCalledWith('/project/custom.md')
  })

  // -------------------------------------------------------------------------
  // NOT_FOUND
  // -------------------------------------------------------------------------

  it('exits with error when SKILL.md not found', async () => {
    vi.mocked(existsSync).mockReturnValue(false)

    await expect(validateAction(undefined)).rejects.toThrow(ExitError)

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('No SKILL.md found'))
  })

  it('outputs NOT_FOUND error in JSON mode when file missing', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

    await expect(validateAction(undefined)).rejects.toThrow(ExitError)

    expect(outputModule.outputError).toHaveBeenCalledWith(
      'NOT_FOUND',
      expect.stringContaining('No SKILL.md found')
    )
  })

  // -------------------------------------------------------------------------
  // Valid SKILL.md
  // -------------------------------------------------------------------------

  it('prints success message for valid SKILL.md', async () => {
    vi.mocked(validateSkillMd).mockReturnValue({
      valid: true,
      errors: [],
      warnings: [],
      specCompliant: true,
      agentverExtensions: [],
    })

    await validateAction(undefined)

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('SKILL.md is valid'))
  })

  it('shows spec compliant message when fully compliant', async () => {
    vi.mocked(validateSkillMd).mockReturnValue({
      valid: true,
      errors: [],
      warnings: [],
      specCompliant: true,
      agentverExtensions: [],
    })

    await validateAction(undefined)

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('agentskills.io spec compliant'))
  })

  it('shows warning when Agentver extensions are used', async () => {
    vi.mocked(validateSkillMd).mockReturnValue({
      valid: true,
      errors: [],
      warnings: [],
      specCompliant: false,
      agentverExtensions: ['triggers', 'compatibility'],
    })

    await validateAction(undefined)

    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining('Not fully agentskills.io spec compliant')
    )
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('triggers, compatibility'))
  })

  it('renders warnings when present', async () => {
    vi.mocked(validateSkillMd).mockReturnValue({
      valid: true,
      errors: [],
      warnings: ['Missing licence field'],
      specCompliant: true,
      agentverExtensions: [],
    })

    await validateAction(undefined)

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Missing licence field'))
  })

  // -------------------------------------------------------------------------
  // Invalid SKILL.md
  // -------------------------------------------------------------------------

  it('exits with error for invalid SKILL.md', async () => {
    vi.mocked(validateSkillMd).mockReturnValue({
      valid: false,
      errors: ['Missing required field: name'],
      warnings: [],
      specCompliant: false,
      agentverExtensions: [],
    })

    await expect(validateAction(undefined)).rejects.toThrow(ExitError)

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('validation failed'))
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Missing required field: name'))
  })

  // -------------------------------------------------------------------------
  // JSON output
  // -------------------------------------------------------------------------

  it('outputs valid result via outputSuccess in JSON mode', async () => {
    vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
    vi.mocked(validateSkillMd).mockReturnValue({
      valid: true,
      errors: [],
      warnings: [],
      specCompliant: true,
      agentverExtensions: [],
    })

    await validateAction(undefined)

    expect(outputModule.outputSuccess).toHaveBeenCalledWith({
      path: '/project/SKILL.md',
      valid: true,
      specCompliant: true,
      errors: [],
      warnings: [],
      agentverExtensions: [],
    })
  })

  it('exits with code 1 in JSON mode when invalid', async () => {
    vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
    vi.mocked(validateSkillMd).mockReturnValue({
      valid: false,
      errors: ['Bad frontmatter'],
      warnings: [],
      specCompliant: false,
      agentverExtensions: [],
    })

    await expect(validateAction(undefined)).rejects.toThrow(ExitError)

    expect(outputModule.outputSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ valid: false })
    )
  })
})
