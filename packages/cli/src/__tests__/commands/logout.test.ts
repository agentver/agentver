import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports that reference them
// ---------------------------------------------------------------------------

vi.mock('../../registry/auth.js', () => ({
  clearCredentials: vi.fn(),
  isAuthenticated: vi.fn().mockResolvedValue(false),
  getCredentials: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../registry/config.js', () => ({
  readConfig: vi.fn().mockReturnValue({}),
  writeConfig: vi.fn(),
  getPlatformUrl: vi.fn().mockReturnValue(null),
  getConfigPath: vi.fn().mockReturnValue('/home/testuser/.agentver/config.json'),
}))

vi.mock('prompts', () => ({
  default: vi.fn().mockResolvedValue({ confirmed: true }),
}))

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

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { createCLIOutputSchema, logoutResultSchema } from '@agentver/shared'
import { Command } from 'commander'
import { registerLogoutCommand } from '../../commands/logout.js'
import { clearCredentials, isAuthenticated } from '../../registry/auth.js'
import { getPlatformUrl, readConfig, writeConfig } from '../../registry/config.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildProgram(): Command {
  const program = new Command()
  program.exitOverride()
  registerLogoutCommand(program)
  return program
}

/** Capture all writes to stdout/stderr for assertion. */
function captureOutput(): { stdout: string[]; stderr: string[] } {
  const stdout: string[] = []
  const stderr: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk))
    return true
  })
  return { stdout, stderr }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('logout command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    process.argv = ['node', 'agentver', 'logout']
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // 1. Happy path — clears credentials and preserves platform URL
  // -------------------------------------------------------------------------

  it('clears credentials and preserves platform URL when logged in', async () => {
    vi.mocked(isAuthenticated).mockResolvedValue(true)
    vi.mocked(getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(readConfig).mockReturnValue({
      platformUrl: 'https://app.agentver.com',
      telemetry: true,
    })

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'logout'])

    expect(clearCredentials).toHaveBeenCalled()
    expect(writeConfig).not.toHaveBeenCalled()
  })

  it('shows success message including the disconnected URL', async () => {
    vi.mocked(isAuthenticated).mockResolvedValue(true)
    vi.mocked(getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(readConfig).mockReturnValue({ platformUrl: 'https://app.agentver.com' })
    const { stdout } = captureOutput()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'logout'])

    const output = stdout.join('')
    expect(output).toContain('Logged out successfully.')
    expect(output).toContain('https://app.agentver.com')
  })

  it('shows success message without URL when no platform URL was configured', async () => {
    vi.mocked(isAuthenticated).mockResolvedValue(true)
    vi.mocked(getPlatformUrl).mockReturnValue(null)
    const { stdout } = captureOutput()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'logout'])

    expect(clearCredentials).toHaveBeenCalled()
    expect(writeConfig).not.toHaveBeenCalled()
    expect(stdout.join('')).toContain('Logged out successfully.')
  })

  // -------------------------------------------------------------------------
  // 2. --json output validates against logoutResultSchema
  // -------------------------------------------------------------------------

  it('outputs valid JSON matching logoutResultSchema when --json is used', async () => {
    process.argv = ['node', 'agentver', 'logout', '--json']
    vi.mocked(isAuthenticated).mockResolvedValue(true)
    vi.mocked(getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(readConfig).mockReturnValue({ platformUrl: 'https://app.agentver.com' })
    const { stdout } = captureOutput()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'logout', '--yes'])

    expect(stdout.length).toBeGreaterThan(0)
    const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>
    expect(parsed.success).toBe(true)

    const data = parsed.data as Record<string, unknown>
    expect(data.cleared).toBe(true)

    const outputSchema = createCLIOutputSchema(logoutResultSchema)
    const result = outputSchema.safeParse(parsed)
    expect(result.success).toBe(true)
  })

  // -------------------------------------------------------------------------
  // 3. Not logged in — handles gracefully
  // -------------------------------------------------------------------------

  it('handles gracefully when not logged in (no error thrown)', async () => {
    vi.mocked(isAuthenticated).mockResolvedValue(false)
    const { stdout } = captureOutput()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'logout'])

    expect(clearCredentials).not.toHaveBeenCalled()
    expect(stdout.join('')).toContain('not currently logged in')
  })

  it('returns { cleared: true } in JSON mode even when not logged in', async () => {
    process.argv = ['node', 'agentver', 'logout', '--json']
    vi.mocked(isAuthenticated).mockResolvedValue(false)
    const { stdout } = captureOutput()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'logout', '--yes'])

    const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>
    expect(parsed.success).toBe(true)
    const data = parsed.data as Record<string, unknown>
    expect(data.cleared).toBe(true)
  })

  // -------------------------------------------------------------------------
  // 4. Confirmation prompts
  // -------------------------------------------------------------------------

  it('does not clear credentials when user cancels confirmation', async () => {
    vi.mocked(isAuthenticated).mockResolvedValue(true)
    vi.mocked(getPlatformUrl).mockReturnValue(null)
    const promptsMod = await import('prompts')
    vi.mocked(promptsMod.default).mockResolvedValueOnce({ confirmed: false })
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'logout'])

    expect(clearCredentials).not.toHaveBeenCalled()
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Cancelled'))
    stdoutSpy.mockRestore()
  })

  it('outputs CONFIRMATION_REQUIRED error in JSON mode without --yes', async () => {
    process.argv = ['node', 'agentver', 'logout', '--json']
    vi.mocked(isAuthenticated).mockResolvedValue(true)
    vi.mocked(getPlatformUrl).mockReturnValue(null)
    const { stdout } = captureOutput()

    const program = buildProgram()
    try {
      await program.parseAsync(['node', 'agentver', 'logout'])
    } catch {
      // process.exit throws in test env
    }

    const output = stdout.join('')
    expect(output).toContain('CONFIRMATION_REQUIRED')
    expect(clearCredentials).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 5. After logout, isAuthenticated would return false
  // -------------------------------------------------------------------------

  it('calls clearCredentials which empties the credentials file', async () => {
    vi.mocked(isAuthenticated).mockResolvedValue(true)
    vi.mocked(getPlatformUrl).mockReturnValue(null)

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'logout'])

    expect(clearCredentials).toHaveBeenCalledTimes(1)
  })
})
