import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports that reference them
// ---------------------------------------------------------------------------

vi.mock('../../registry/auth.js', () => ({
  getCredentials: vi.fn().mockResolvedValue(null),
  isAuthenticated: vi.fn().mockResolvedValue(false),
}))

vi.mock('../../registry/config.js', () => ({
  readConfig: vi.fn().mockReturnValue({}),
  writeConfig: vi.fn(),
  getPlatformUrl: vi.fn().mockReturnValue(null),
  getConfigPath: vi.fn().mockReturnValue('/home/testuser/.agentver/config.json'),
}))

vi.mock('../../registry/platform.js', () => ({
  platformFetchSilent: vi.fn().mockResolvedValue(null),
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

import { createCLIOutputSchema, whoamiResultSchema } from '@agentver/shared'
import { Command } from 'commander'
import { registerWhoamiCommand } from '../../commands/whoami.js'
import { getCredentials } from '../../registry/auth.js'
import { getPlatformUrl } from '../../registry/config.js'
import { platformFetchSilent } from '../../registry/platform.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildProgram(): Command {
  const program = new Command()
  program.exitOverride()
  registerWhoamiCommand(program)
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

describe('whoami command', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.argv = ['node', 'agentver', 'whoami']
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // 1. Authenticated with OAuth token — shows user info
  // -------------------------------------------------------------------------

  it('shows user info when authenticated via OAuth token', async () => {
    vi.mocked(getCredentials).mockResolvedValue({ token: 'oauth-token-abc' })
    vi.mocked(getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(platformFetchSilent).mockResolvedValue({
      id: 'user-123',
      email: 'user@example.com',
      name: 'Test User',
      organisations: [],
    })

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'whoami'])

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Authenticated via OAuth'))
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('user@example.com'))
    expect(platformFetchSilent).toHaveBeenCalledWith('/me', { swallowAuthErrors: false })
  })

  // -------------------------------------------------------------------------
  // 2. Authenticated with API key — shows auth method
  // -------------------------------------------------------------------------

  it('shows API key prefix when authenticated via API key', async () => {
    vi.mocked(getCredentials).mockResolvedValue({ apiKey: 'sk-abcdef1234567890' })
    vi.mocked(getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(platformFetchSilent).mockResolvedValue({
      id: 'user-456',
      email: 'api@example.com',
      name: 'API User',
      organisations: [],
    })

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'whoami'])

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('API key'))
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('sk-abcde'))
  })

  // -------------------------------------------------------------------------
  // 3. Not authenticated — shows unauthenticated message
  // -------------------------------------------------------------------------

  it('shows not authenticated message when no credentials exist', async () => {
    vi.mocked(getCredentials).mockResolvedValue(null)

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'whoami'])

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Not authenticated'))
    expect(platformFetchSilent).not.toHaveBeenCalled()
  })

  it('does not call platform API when credentials are empty', async () => {
    vi.mocked(getCredentials).mockResolvedValue({})

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'whoami'])

    expect(platformFetchSilent).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 4. Platform unavailable — authenticated but cannot reach platform
  // -------------------------------------------------------------------------

  it('shows auth method but not user details when platform is unreachable', async () => {
    vi.mocked(getCredentials).mockResolvedValue({ token: 'valid-token' })
    vi.mocked(getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(platformFetchSilent).mockResolvedValue(null)

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'whoami'])

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Authenticated via OAuth'))
    // No user email shown since platform returned null
    const allLogCalls = consoleLogSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    const hasEmail = allLogCalls.some((msg: string) => msg.includes('User:'))
    expect(hasEmail).toBe(false)
  })

  it('reports expired authentication instead of treating it as a network failure', async () => {
    vi.mocked(getCredentials).mockResolvedValue({ token: 'expired-token' })
    vi.mocked(getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(platformFetchSilent).mockRejectedValue(
      new Error('Authentication expired. Run `agentver login` to re-authenticate.')
    )

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'whoami'])

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Authentication expired'))
  })

  // -------------------------------------------------------------------------
  // 5. --json output validates against whoamiResultSchema
  // -------------------------------------------------------------------------

  it('outputs valid JSON matching whoamiResultSchema when authenticated', async () => {
    process.argv = ['node', 'agentver', 'whoami', '--json']
    vi.mocked(getCredentials).mockResolvedValue({ token: 'oauth-token' })
    vi.mocked(getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(platformFetchSilent).mockResolvedValue({
      id: 'user-789',
      email: 'json@example.com',
      name: 'JSON User',
      organisations: [{ slug: 'test-org', name: 'Test Org', role: 'admin' }],
    })
    const { stdout } = captureOutput()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'whoami'])

    const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>
    expect(parsed.success).toBe(true)

    const data = parsed.data as Record<string, unknown>
    expect(data.authenticated).toBe(true)
    expect(data.platform).toBe('https://app.agentver.com')

    const user = data.user as Record<string, unknown>
    expect(user.email).toBe('json@example.com')

    const outputSchema = createCLIOutputSchema(whoamiResultSchema)
    const result = outputSchema.safeParse(parsed)
    expect(result.success).toBe(true)
  })

  it('outputs { authenticated: false } in JSON mode when not logged in', async () => {
    process.argv = ['node', 'agentver', 'whoami', '--json']
    vi.mocked(getCredentials).mockResolvedValue(null)
    const { stdout } = captureOutput()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'whoami'])

    const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>
    expect(parsed.success).toBe(true)

    const data = parsed.data as Record<string, unknown>
    expect(data.authenticated).toBe(false)

    const outputSchema = createCLIOutputSchema(whoamiResultSchema)
    const result = outputSchema.safeParse(parsed)
    expect(result.success).toBe(true)
  })

  // -------------------------------------------------------------------------
  // 6. With organisations — shown in output
  // -------------------------------------------------------------------------

  it('displays organisations when platform returns them', async () => {
    vi.mocked(getCredentials).mockResolvedValue({ token: 'oauth-token' })
    vi.mocked(getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(platformFetchSilent).mockResolvedValue({
      id: 'user-org',
      email: 'org@example.com',
      name: 'Org User',
      organisations: [
        { slug: 'acme-corp', name: 'ACME Corp', role: 'admin' },
        { slug: 'dev-team', name: 'Dev Team', role: 'member' },
      ],
    })

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'whoami'])

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('acme-corp'))
  })

  it('includes organisation slugs in JSON output', async () => {
    process.argv = ['node', 'agentver', 'whoami', '--json']
    vi.mocked(getCredentials).mockResolvedValue({ token: 'oauth-token' })
    vi.mocked(getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(platformFetchSilent).mockResolvedValue({
      id: 'user-org',
      email: 'org@example.com',
      name: 'Org User',
      organisations: [
        { slug: 'acme-corp', name: 'ACME Corp', role: 'admin' },
        { slug: 'dev-team', name: 'Dev Team', role: 'member' },
      ],
    })
    const { stdout } = captureOutput()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'whoami'])

    const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>
    const data = parsed.data as Record<string, unknown>
    expect(data.organisation).toBe('acme-corp, dev-team')
  })

  // -------------------------------------------------------------------------
  // No platform URL configured — shows auth but no platform info
  // -------------------------------------------------------------------------

  it('shows not connected message when no platform URL is configured', async () => {
    vi.mocked(getCredentials).mockResolvedValue({ token: 'valid-token' })
    vi.mocked(getPlatformUrl).mockReturnValue(null)

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'whoami'])

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('not connected'))
    expect(platformFetchSilent).not.toHaveBeenCalled()
  })

  it('outputs { authenticated: true } without platform in JSON mode when no URL configured', async () => {
    process.argv = ['node', 'agentver', 'whoami', '--json']
    vi.mocked(getCredentials).mockResolvedValue({ token: 'valid-token' })
    vi.mocked(getPlatformUrl).mockReturnValue(null)
    const { stdout } = captureOutput()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'whoami'])

    const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>
    const data = parsed.data as Record<string, unknown>
    expect(data.authenticated).toBe(true)
    expect(data.platform).toBeUndefined()
  })

  it('returns a JSON error when authentication has expired', async () => {
    process.argv = ['node', 'agentver', 'whoami', '--json']
    vi.mocked(getCredentials).mockResolvedValue({ token: 'expired-token' })
    vi.mocked(getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(platformFetchSilent).mockRejectedValue(
      new Error('Authentication expired. Run `agentver login` to re-authenticate.')
    )
    const { stdout } = captureOutput()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'whoami'])

    const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>
    expect(parsed.success).toBe(false)
  })
})
