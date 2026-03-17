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
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    process.argv = ['node', 'agentver', 'logout']
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // 1. Happy path — clears credentials and platform URL
  // -------------------------------------------------------------------------

  it('clears credentials and platform URL when logged in', async () => {
    vi.mocked(isAuthenticated).mockResolvedValue(true)
    vi.mocked(getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(readConfig).mockReturnValue({
      platformUrl: 'https://app.agentver.com',
      telemetry: true,
    })

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'logout'])

    expect(clearCredentials).toHaveBeenCalled()
    expect(writeConfig).toHaveBeenCalledWith(
      expect.not.objectContaining({ platformUrl: expect.anything() })
    )
  })

  it('shows success message including the disconnected URL', async () => {
    vi.mocked(isAuthenticated).mockResolvedValue(true)
    vi.mocked(getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(readConfig).mockReturnValue({ platformUrl: 'https://app.agentver.com' })

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'logout'])

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Logged out successfully.'))
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('https://app.agentver.com'))
  })

  it('shows success message without URL when no platform URL was configured', async () => {
    vi.mocked(isAuthenticated).mockResolvedValue(true)
    vi.mocked(getPlatformUrl).mockReturnValue(null)

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'logout'])

    expect(clearCredentials).toHaveBeenCalled()
    expect(writeConfig).not.toHaveBeenCalled()
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Logged out successfully.'))
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
    // Do NOT pass --json to Commander — isJSONMode() reads process.argv directly
    await program.parseAsync(['node', 'agentver', 'logout'])

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

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'logout'])

    expect(clearCredentials).not.toHaveBeenCalled()
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('not currently logged in'))
  })

  it('returns { cleared: true } in JSON mode even when not logged in', async () => {
    process.argv = ['node', 'agentver', 'logout', '--json']
    vi.mocked(isAuthenticated).mockResolvedValue(false)
    const { stdout } = captureOutput()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'logout'])

    const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>
    expect(parsed.success).toBe(true)
    const data = parsed.data as Record<string, unknown>
    expect(data.cleared).toBe(true)
  })

  // -------------------------------------------------------------------------
  // 4. After logout, isAuthenticated would return false
  // -------------------------------------------------------------------------

  it('calls clearCredentials which empties the credentials file', async () => {
    vi.mocked(isAuthenticated).mockResolvedValue(true)
    vi.mocked(getPlatformUrl).mockReturnValue(null)

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'logout'])

    expect(clearCredentials).toHaveBeenCalledTimes(1)
  })
})
