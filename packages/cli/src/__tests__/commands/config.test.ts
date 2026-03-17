import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports that reference them
// ---------------------------------------------------------------------------

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

import { Command } from 'commander'
import { registerConfigCommand } from '../../commands/config.js'
import { readConfig, writeConfig } from '../../registry/config.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildProgram(): Command {
  const program = new Command()
  program.exitOverride()
  registerConfigCommand(program)
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

describe('config command', () => {
  let processExitSpy: ReturnType<typeof vi.spyOn>
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as never)
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.argv = ['node', 'agentver', 'config']
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // 1. config list — shows all current config values
  // -------------------------------------------------------------------------

  describe('config list', () => {
    it('shows all current config values', async () => {
      vi.mocked(readConfig).mockReturnValue({
        platformUrl: 'https://app.agentver.com',
        telemetry: true,
      })

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'config', 'list'])

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('platformUrl'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('telemetry'))
    })

    it('shows "No configuration set" when config is empty', async () => {
      vi.mocked(readConfig).mockReturnValue({})

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'config', 'list'])

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('No configuration set'))
    })

    it('outputs config as JSON in --json mode', async () => {
      process.argv = ['node', 'agentver', 'config', 'list', '--json']
      vi.mocked(readConfig).mockReturnValue({
        platformUrl: 'https://app.agentver.com',
        telemetry: false,
      })
      const { stdout } = captureOutput()

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'config', 'list', '--json'])

      const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>
      expect(parsed.success).toBe(true)

      const data = parsed.data as Record<string, unknown>
      expect(data.platformUrl).toBe('https://app.agentver.com')
      expect(data.telemetry).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // 2. config get — returns stored value for a known key
  // -------------------------------------------------------------------------

  describe('config get', () => {
    it('returns stored platformUrl value', async () => {
      vi.mocked(readConfig).mockReturnValue({ platformUrl: 'https://custom.example.com' })

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'config', 'get', 'platformUrl'])

      expect(consoleLogSpy).toHaveBeenCalledWith('https://custom.example.com')
    })

    it('exits silently when key exists but has no value', async () => {
      vi.mocked(readConfig).mockReturnValue({})

      const program = buildProgram()

      await expect(
        program.parseAsync(['node', 'agentver', 'config', 'get', 'platformUrl'])
      ).rejects.toThrow('process.exit called')

      expect(processExitSpy).toHaveBeenCalledWith(0)
    })

    // -----------------------------------------------------------------------
    // 3. config get missing key — error for unknown key name
    // -----------------------------------------------------------------------

    it('shows error for unknown key name', async () => {
      const program = buildProgram()

      await expect(
        program.parseAsync(['node', 'agentver', 'config', 'get', 'unknownKey'])
      ).rejects.toThrow('process.exit called')

      expect(processExitSpy).toHaveBeenCalledWith(1)
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown config key'))
    })

    it('outputs INVALID_KEY error in JSON mode for unknown key', async () => {
      process.argv = ['node', 'agentver', 'config', 'get', 'badKey', '--json']
      const { stdout } = captureOutput()

      const program = buildProgram()

      await expect(
        program.parseAsync(['node', 'agentver', 'config', 'get', 'badKey', '--json'])
      ).rejects.toThrow('process.exit called')

      expect(processExitSpy).toHaveBeenCalledWith(1)
      const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>
      expect(parsed.success).toBe(false)
      const error = parsed.error as Record<string, unknown>
      expect(error.code).toBe('INVALID_KEY')
    })

    it('returns key and value in JSON mode', async () => {
      process.argv = ['node', 'agentver', 'config', 'get', 'platformUrl', '--json']
      vi.mocked(readConfig).mockReturnValue({ platformUrl: 'https://json.example.com' })
      const { stdout } = captureOutput()

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'config', 'get', 'platformUrl', '--json'])

      const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>
      expect(parsed.success).toBe(true)
      const data = parsed.data as Record<string, unknown>
      expect(data.key).toBe('platformUrl')
      expect(data.value).toBe('https://json.example.com')
    })
  })

  // -------------------------------------------------------------------------
  // 4. config set platformUrl — writes to config file
  // -------------------------------------------------------------------------

  describe('config set', () => {
    it('sets platformUrl with a valid HTTPS URL', async () => {
      vi.mocked(readConfig).mockReturnValue({})

      const program = buildProgram()
      await program.parseAsync([
        'node',
        'agentver',
        'config',
        'set',
        'platformUrl',
        'https://custom.example.com',
      ])

      expect(writeConfig).toHaveBeenCalledWith(
        expect.objectContaining({ platformUrl: 'https://custom.example.com' })
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Set platformUrl'))
    })

    // -----------------------------------------------------------------------
    // 5. config set telemetry false — boolean value
    // -----------------------------------------------------------------------

    it('sets telemetry to false (boolean)', async () => {
      vi.mocked(readConfig).mockReturnValue({})

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'config', 'set', 'telemetry', 'false'])

      expect(writeConfig).toHaveBeenCalledWith(expect.objectContaining({ telemetry: false }))
    })

    it('sets telemetry to true (boolean)', async () => {
      vi.mocked(readConfig).mockReturnValue({})

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'config', 'set', 'telemetry', 'true'])

      expect(writeConfig).toHaveBeenCalledWith(expect.objectContaining({ telemetry: true }))
    })

    // -----------------------------------------------------------------------
    // 6. config set with invalid key — error for unrecognised key
    // -----------------------------------------------------------------------

    it('shows error for unrecognised config key', async () => {
      const program = buildProgram()

      await expect(
        program.parseAsync(['node', 'agentver', 'config', 'set', 'invalidKey', 'someValue'])
      ).rejects.toThrow('process.exit called')

      expect(processExitSpy).toHaveBeenCalledWith(1)
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown config key'))
      expect(writeConfig).not.toHaveBeenCalled()
    })

    // -----------------------------------------------------------------------
    // 7. config set platformUrl with invalid URL — validation error
    // -----------------------------------------------------------------------

    it('rejects platformUrl that does not start with https://', async () => {
      const program = buildProgram()

      await expect(
        program.parseAsync([
          'node',
          'agentver',
          'config',
          'set',
          'platformUrl',
          'http://insecure.example.com',
        ])
      ).rejects.toThrow('process.exit called')

      expect(processExitSpy).toHaveBeenCalledWith(1)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('platformUrl must start with https://')
      )
      expect(writeConfig).not.toHaveBeenCalled()
    })

    it('rejects platformUrl that is not a URL at all', async () => {
      const program = buildProgram()

      await expect(
        program.parseAsync(['node', 'agentver', 'config', 'set', 'platformUrl', 'not-a-url'])
      ).rejects.toThrow('process.exit called')

      expect(processExitSpy).toHaveBeenCalledWith(1)
      expect(writeConfig).not.toHaveBeenCalled()
    })

    it('rejects invalid telemetry value', async () => {
      const program = buildProgram()

      await expect(
        program.parseAsync(['node', 'agentver', 'config', 'set', 'telemetry', 'maybe'])
      ).rejects.toThrow('process.exit called')

      expect(processExitSpy).toHaveBeenCalledWith(1)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('telemetry must be true or false')
      )
      expect(writeConfig).not.toHaveBeenCalled()
    })

    it('outputs INVALID_VALUE error in JSON mode for invalid platformUrl', async () => {
      process.argv = ['node', 'agentver', 'config', 'set', 'platformUrl', 'not-https', '--json']
      const { stdout } = captureOutput()

      const program = buildProgram()

      await expect(
        program.parseAsync([
          'node',
          'agentver',
          'config',
          'set',
          'platformUrl',
          'not-https',
          '--json',
        ])
      ).rejects.toThrow('process.exit called')

      const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>
      expect(parsed.success).toBe(false)
      const error = parsed.error as Record<string, unknown>
      expect(error.code).toBe('INVALID_VALUE')
    })

    it('outputs key and value in JSON mode on success', async () => {
      process.argv = [
        'node',
        'agentver',
        'config',
        'set',
        'platformUrl',
        'https://set.example.com',
        '--json',
      ]
      vi.mocked(readConfig).mockReturnValue({})
      const { stdout } = captureOutput()

      const program = buildProgram()
      await program.parseAsync([
        'node',
        'agentver',
        'config',
        'set',
        'platformUrl',
        'https://set.example.com',
        '--json',
      ])

      const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>
      expect(parsed.success).toBe(true)
      const data = parsed.data as Record<string, unknown>
      expect(data.key).toBe('platformUrl')
      expect(data.value).toBe('https://set.example.com')
    })
  })

  // -------------------------------------------------------------------------
  // 8. config unset — removes a key from config
  // -------------------------------------------------------------------------

  describe('config unset', () => {
    it('removes platformUrl from config', async () => {
      vi.mocked(readConfig).mockReturnValue({
        platformUrl: 'https://will-be-removed.com',
        telemetry: true,
      })

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'config', 'unset', 'platformUrl'])

      expect(writeConfig).toHaveBeenCalled()
      const writtenConfig = vi.mocked(writeConfig).mock.calls[0]![0]
      expect(writtenConfig).not.toHaveProperty('platformUrl')
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Removed platformUrl'))
    })

    // -----------------------------------------------------------------------
    // 9. config unset nonexistent — graceful handling
    // -----------------------------------------------------------------------

    it('handles unsetting a key that was not set without error', async () => {
      vi.mocked(readConfig).mockReturnValue({})

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'config', 'unset', 'platformUrl'])

      expect(writeConfig).toHaveBeenCalled()
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Removed platformUrl'))
    })

    it('rejects unknown key for unset', async () => {
      const program = buildProgram()

      await expect(
        program.parseAsync(['node', 'agentver', 'config', 'unset', 'badKey'])
      ).rejects.toThrow('process.exit called')

      expect(processExitSpy).toHaveBeenCalledWith(1)
      expect(writeConfig).not.toHaveBeenCalled()
    })

    it('outputs key and removed: true in JSON mode', async () => {
      process.argv = ['node', 'agentver', 'config', 'unset', 'telemetry', '--json']
      vi.mocked(readConfig).mockReturnValue({ telemetry: true })
      const { stdout } = captureOutput()

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'config', 'unset', 'telemetry', '--json'])

      const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>
      expect(parsed.success).toBe(true)
      const data = parsed.data as Record<string, unknown>
      expect(data.key).toBe('telemetry')
      expect(data.removed).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // 10. config path — prints the config file path
  // -------------------------------------------------------------------------

  describe('config path', () => {
    it('prints the config file path', async () => {
      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'config', 'path'])

      expect(consoleLogSpy).toHaveBeenCalledWith('/home/testuser/.agentver/config.json')
    })
  })

  // -------------------------------------------------------------------------
  // 11. config set preserves existing config values
  // -------------------------------------------------------------------------

  it('preserves existing config values when setting a new key', async () => {
    vi.mocked(readConfig).mockReturnValue({
      platformUrl: 'https://existing.com',
      telemetry: true,
    })

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'config', 'set', 'defaultOrg', 'my-org'])

    expect(writeConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        platformUrl: 'https://existing.com',
        telemetry: true,
        defaultOrg: 'my-org',
      })
    )
  })
})
