import * as nodeHttp from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports that reference them
// ---------------------------------------------------------------------------

vi.mock('../../registry/auth.js', () => ({
  saveCredentials: vi.fn(),
  getCredentials: vi.fn().mockResolvedValue(null),
  clearCredentials: vi.fn(),
  isAuthenticated: vi.fn().mockResolvedValue(false),
}))

vi.mock('../../registry/config.js', () => ({
  DEFAULT_PLATFORM_URL: 'https://app.agentver.com',
  readConfig: vi.fn().mockReturnValue({}),
  writeConfig: vi.fn(),
  getPlatformUrl: vi.fn().mockReturnValue(null),
  getConfigPath: vi.fn().mockReturnValue('/home/testuser/.agentver/config.json'),
}))

vi.mock('../../registry/client.js', () => ({
  getRegistryUrl: vi.fn().mockReturnValue('https://app.agentver.com/api/v1'),
}))

vi.mock('../../utils/network.js', () => ({
  checkOnline: vi.fn().mockResolvedValue(true),
  showOfflineError: vi.fn(),
}))

vi.mock('open', () => ({
  default: vi.fn().mockResolvedValue(undefined),
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

vi.mock('ora', () => {
  const spinner = {
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    text: '',
  }
  return { default: () => spinner }
})

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { createCLIOutputSchema, loginResultSchema } from '@agentver/shared'
import { Command } from 'commander'
import open from 'open'
import { registerLoginCommand } from '../../commands/login.js'
import { saveCredentials } from '../../registry/auth.js'
import { getPlatformUrl, readConfig, writeConfig } from '../../registry/config.js'
import { checkOnline, showOfflineError } from '../../utils/network.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildProgram(): Command {
  const program = new Command()
  program.exitOverride()
  registerLoginCommand(program)
  return program
}

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

/**
 * Make a real HTTP GET request to a local server, bypassing the stubbed global
 * fetch. Required in OAuth flow tests so the callback server actually receives
 * the request and resolves its waitForCallback() promise.
 */
function httpGet(url: string): Promise<void> {
  return new Promise((resolve) => {
    nodeHttp
      .get(url, (res) => {
        res.resume()
        res.on('end', resolve)
        res.on('error', resolve)
      })
      .on('error', resolve)
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('login command', () => {
  let processExitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as never)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    process.argv = ['node', 'agentver', 'login']
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('saves API key and platform URL when --token and URL are provided', async () => {
    const program = buildProgram()
    await program.parseAsync([
      'node',
      'agentver',
      'login',
      '--token',
      'sk-abc123',
      'https://custom.agentver.com',
    ])
    expect(saveCredentials).toHaveBeenCalledWith({ apiKey: 'sk-abc123' })
    expect(writeConfig).toHaveBeenCalledWith(
      expect.objectContaining({ platformUrl: 'https://custom.agentver.com' })
    )
  })

  it('saves API key and writes default platform URL when no URL argument is provided', async () => {
    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'login', '--token', 'sk-abc123'])
    expect(saveCredentials).toHaveBeenCalledWith({ apiKey: 'sk-abc123' })
    expect(writeConfig).toHaveBeenCalledWith(
      expect.objectContaining({ platformUrl: 'https://app.agentver.com' })
    )
  })

  it('does not overwrite existing platform URL when no URL argument is provided', async () => {
    vi.mocked(getPlatformUrl).mockReturnValue('https://custom.agentver.com')
    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'login', '--token', 'sk-abc123'])
    expect(saveCredentials).toHaveBeenCalledWith({ apiKey: 'sk-abc123' })
    expect(writeConfig).not.toHaveBeenCalled()
  })

  it('delegates credential storage to saveCredentials with the provided API key', async () => {
    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'login', '--token', 'sk-test-key'])
    expect(saveCredentials).toHaveBeenCalledTimes(1)
    expect(saveCredentials).toHaveBeenCalledWith({ apiKey: 'sk-test-key' })
  })

  it('rejects empty token values', async () => {
    const program = buildProgram()
    await expect(
      program.parseAsync(['node', 'agentver', 'login', '--token', '   '])
    ).rejects.toThrow('process.exit called')
    expect(saveCredentials).not.toHaveBeenCalled()
    expect(processExitSpy).toHaveBeenCalledWith(1)
  })

  // isJSONMode() reads process.argv directly — do NOT pass --json to parseAsync
  // as the login command does not register it as a commander option
  it('outputs valid JSON matching loginResultSchema when --token is used in JSON mode', async () => {
    process.argv = ['node', 'agentver', 'login', '--token', 'sk-abc123', '--json']
    const { stdout } = captureOutput()
    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'login', '--token', 'sk-abc123'])
    expect(stdout.length).toBeGreaterThan(0)
    const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>
    expect(parsed.success).toBe(true)
    const outputSchema = createCLIOutputSchema(loginResultSchema)
    expect(outputSchema.safeParse(parsed).success).toBe(true)
  })

  it('outputs INTERACTIVE_REQUIRED error in JSON mode when no --token is provided', async () => {
    process.argv = ['node', 'agentver', 'login', '--json']
    const { stdout } = captureOutput()
    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'login'])).rejects.toThrow(
      'process.exit called'
    )
    expect(processExitSpy).toHaveBeenCalledWith(1)
    const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>
    expect(parsed.success).toBe(false)
    expect((parsed.error as Record<string, unknown>).code).toBe('INTERACTIVE_REQUIRED')
  })

  // Uses node:http (not stubbed global fetch) to deliver the callback to the real server
  it('opens browser with code_challenge, state, and redirect_uri params in the auth URL', async () => {
    let capturedUrl = ''
    vi.mocked(open).mockImplementation(async (url: string) => {
      capturedUrl = url
      const authUrl = new URL(url)
      const redirectUri = authUrl.searchParams.get('redirect_uri')
      const state = authUrl.searchParams.get('state')
      if (redirectUri && state) {
        await httpGet(`${redirectUri}?code=test-auth-code&state=${encodeURIComponent(state)}`)
      }
      return undefined as never
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.includes('/auth/token')) {
          return new Response(
            JSON.stringify({ access_token: 'oauth-test-token', token_type: 'Bearer' }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          )
        }
        return new Response(null, { status: 404 })
      })
    )
    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'login'])).rejects.toThrow(
      'process.exit called'
    )
    expect(capturedUrl).toContain('code_challenge=')
    expect(capturedUrl).toContain('state=')
    expect(capturedUrl).toContain('redirect_uri=')
  })

  it('exchanges auth code for token and saves the returned access token', async () => {
    let tokenRequestBody: Record<string, unknown> | undefined
    vi.mocked(open).mockImplementation(async (url: string) => {
      const authUrl = new URL(url)
      const redirectUri = authUrl.searchParams.get('redirect_uri')
      const state = authUrl.searchParams.get('state')
      if (redirectUri && state) {
        await httpGet(`${redirectUri}?code=exchange-code&state=${encodeURIComponent(state)}`)
      }
      return undefined as never
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.includes('/auth/token') && init?.method === 'POST') {
          tokenRequestBody = JSON.parse(init.body as string) as Record<string, unknown>
          return new Response(
            JSON.stringify({ access_token: 'oauth-exchanged-token', token_type: 'Bearer' }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          )
        }
        return new Response(null, { status: 404 })
      })
    )
    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'login'])).rejects.toThrow(
      'process.exit called'
    )
    expect(tokenRequestBody?.grant_type).toBe('authorization_code')
    expect(tokenRequestBody?.code).toBe('exchange-code')
    expect(typeof tokenRequestBody?.code_verifier).toBe('string')
    expect((tokenRequestBody?.code_verifier as string).length).toBeGreaterThan(0)
    expect(tokenRequestBody?.redirect_uri).toBeDefined()
    expect(saveCredentials).toHaveBeenCalledWith({ token: 'oauth-exchanged-token' })
  })

  it('times out and exits with error when callback is not received within 120 seconds', async () => {
    // Only fake timer APIs — real I/O (server.listen) must still work
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] })
    vi.mocked(open).mockResolvedValue(undefined as never)
    vi.mocked(checkOnline).mockResolvedValue(true)
    const program = buildProgram()
    const parsePromise = program.parseAsync(['node', 'agentver', 'login'])
    // Attach rejection handler BEFORE advancing timers to prevent unhandledRejection
    // (the timeout fires during advanceTimersByTimeAsync, rejecting parsePromise before
    // the await on the next line would otherwise attach the handler)
    const assertionPromise = expect(parsePromise).rejects.toThrow('process.exit called')
    await vi.advanceTimersByTimeAsync(125_000)
    await assertionPromise
    expect(processExitSpy).toHaveBeenCalledWith(1)
    vi.useRealTimers()
  })

  it('handles re-authentication by overwriting existing credentials with the new API key', async () => {
    vi.mocked(getPlatformUrl).mockReturnValue('https://existing.agentver.com')
    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'login', '--token', 'sk-new-key'])
    expect(saveCredentials).toHaveBeenCalledWith({ apiKey: 'sk-new-key' })
  })

  it('merges the URL argument into the existing config object when saving platform URL', async () => {
    vi.mocked(readConfig).mockReturnValue({ telemetry: true })
    const program = buildProgram()
    await program.parseAsync([
      'node',
      'agentver',
      'login',
      '--token',
      'sk-abc',
      'https://my-instance.com',
    ])
    expect(writeConfig).toHaveBeenCalledWith(
      expect.objectContaining({ telemetry: true, platformUrl: 'https://my-instance.com' })
    )
  })

  it('calls showOfflineError and exits when offline in non-JSON mode', async () => {
    vi.mocked(checkOnline).mockResolvedValue(false)
    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'login'])).rejects.toThrow(
      'process.exit called'
    )
    expect(showOfflineError).toHaveBeenCalled()
    expect(processExitSpy).toHaveBeenCalledWith(1)
  })

  it('outputs structured OFFLINE error in JSON mode when registry is unreachable', async () => {
    process.argv = ['node', 'agentver', 'login', '--json']
    vi.mocked(checkOnline).mockResolvedValue(false)
    const { stdout } = captureOutput()
    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'login'])).rejects.toThrow(
      'process.exit called'
    )
    expect(processExitSpy).toHaveBeenCalledWith(1)
    const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>
    expect(parsed.success).toBe(false)
    expect((parsed.error as Record<string, unknown>).code).toBe('OFFLINE')
  })
})
