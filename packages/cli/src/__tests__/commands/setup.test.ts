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

vi.mock('@agentver/agent-definitions', () => ({
  detectInstalledAgents: vi.fn().mockReturnValue([]),
  detectGlobalAgents: vi.fn().mockReturnValue([]),
}))

vi.mock('prompts', () => ({
  default: vi.fn().mockResolvedValue({}),
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

import { detectInstalledAgents } from '@agentver/agent-definitions'
import { createCLIOutputSchema, setupResultSchema } from '@agentver/shared'
import { Command } from 'commander'
import prompts from 'prompts'
import { registerSetupCommand, registerSetupCommandJSON } from '../../commands/setup.js'
import { isAuthenticated } from '../../registry/auth.js'
import { getPlatformUrl, readConfig, writeConfig } from '../../registry/config.js'
import { checkOnline } from '../../utils/network.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildProgram(): Command {
  const program = new Command()
  program.exitOverride()
  registerSetupCommand(program)
  registerSetupCommandJSON(program)
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('setup command', () => {
  let processExitSpy: ReturnType<typeof vi.spyOn>
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as never)
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    process.argv = ['node', 'agentver', 'setup']
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // JSON mode — interactive required
  // -------------------------------------------------------------------------

  it('outputs INTERACTIVE_REQUIRED error in JSON mode', async () => {
    process.argv = ['node', 'agentver', 'setup', '--json']
    const { stdout } = captureOutput()

    const program = buildProgram()

    await expect(program.parseAsync(['node', 'agentver', 'setup'])).rejects.toThrow(
      'process.exit called'
    )

    expect(processExitSpy).toHaveBeenCalledWith(1)
    const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>
    expect(parsed.success).toBe(false)
    expect((parsed.error as Record<string, unknown>).code).toBe('INTERACTIVE_REQUIRED')
  })

  // -------------------------------------------------------------------------
  // Interactive wizard — completes with all steps
  // -------------------------------------------------------------------------

  it('runs the interactive wizard and prints setup summary', async () => {
    vi.mocked(prompts)
      .mockResolvedValueOnce({ url: 'https://app.agentver.com' }) // platform URL
      .mockResolvedValueOnce({ method: 'skip' }) // auth method

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'setup'])

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Agentver Setup'))
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Setup summary'))
  })

  // -------------------------------------------------------------------------
  // Platform URL — writes config when URL is provided
  // -------------------------------------------------------------------------

  it('writes platform URL to config when provided', async () => {
    vi.mocked(prompts)
      .mockResolvedValueOnce({ url: 'https://custom.example.com' }) // platform URL
      .mockResolvedValueOnce({ method: 'skip' }) // auth method

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'setup'])

    expect(writeConfig).toHaveBeenCalledWith(
      expect.objectContaining({ platformUrl: 'https://custom.example.com' })
    )
  })

  // -------------------------------------------------------------------------
  // Platform URL — skips when already set and user declines change
  // -------------------------------------------------------------------------

  it('skips platform URL when already set and user declines change', async () => {
    vi.mocked(getPlatformUrl).mockReturnValue('https://existing.example.com')
    vi.mocked(prompts)
      .mockResolvedValueOnce({ change: false }) // decline change
      .mockResolvedValueOnce({ method: 'skip' }) // auth method

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'setup'])

    expect(writeConfig).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Authentication — skips when already authenticated
  // -------------------------------------------------------------------------

  it('skips authentication step when already authenticated', async () => {
    vi.mocked(isAuthenticated).mockResolvedValue(true)
    vi.mocked(prompts).mockResolvedValueOnce({ url: 'https://app.agentver.com' })

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'setup'])

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Already authenticated'))
  })

  // -------------------------------------------------------------------------
  // Agent detection — reports found agents
  // -------------------------------------------------------------------------

  it('reports detected agents in the summary', async () => {
    vi.mocked(detectInstalledAgents).mockReturnValue([
      { id: 'claude-code', name: 'Claude Code', configPath: '/home/test/.claude/CLAUDE.md' },
    ])

    vi.mocked(prompts)
      .mockResolvedValueOnce({ url: 'https://app.agentver.com' })
      .mockResolvedValueOnce({ method: 'skip' })

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'setup'])

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Found 1 agent'))
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Claude Code'))
  })

  // -------------------------------------------------------------------------
  // Connectivity — reports failure when offline
  // -------------------------------------------------------------------------

  it('reports connectivity failure when platform is unreachable', async () => {
    vi.mocked(checkOnline).mockResolvedValue(false)
    vi.mocked(prompts)
      .mockResolvedValueOnce({ url: 'https://app.agentver.com' })
      .mockResolvedValueOnce({ method: 'skip' })

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'setup'])

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('unreachable'))
  })

  // -------------------------------------------------------------------------
  // Default org — shows in summary when configured
  // -------------------------------------------------------------------------

  it('shows default organisation in summary when configured', async () => {
    vi.mocked(readConfig).mockReturnValue({ defaultOrg: 'my-team' })
    vi.mocked(prompts)
      .mockResolvedValueOnce({ url: 'https://app.agentver.com' })
      .mockResolvedValueOnce({ method: 'skip' })

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'setup'])

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('my-team'))
  })

  // -------------------------------------------------------------------------
  // Suggests doctor --fix when failures exist
  // -------------------------------------------------------------------------

  it('suggests doctor --fix when there are failed steps', async () => {
    vi.mocked(checkOnline).mockResolvedValue(false)
    vi.mocked(prompts)
      .mockResolvedValueOnce({ url: 'https://app.agentver.com' })
      .mockResolvedValueOnce({ method: 'skip' })

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'setup'])

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('agentver doctor --fix'))
  })
})

// ---------------------------------------------------------------------------
// setup-check command (non-interactive JSON variant)
// ---------------------------------------------------------------------------

describe('setup-check command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as never)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    process.argv = ['node', 'agentver', 'setup-check']
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('outputs valid JSON matching setupResultSchema', async () => {
    vi.mocked(getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(isAuthenticated).mockResolvedValue(true)
    const { stdout } = captureOutput()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'setup-check'])

    const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>
    expect(parsed.success).toBe(true)
    const outputSchema = createCLIOutputSchema(setupResultSchema)
    expect(outputSchema.safeParse(parsed).success).toBe(true)
  })

  it('reports platform URL as skip when not configured', async () => {
    vi.mocked(getPlatformUrl).mockReturnValue(null)
    const { stdout } = captureOutput()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'setup-check'])

    const parsed = JSON.parse(stdout.join('')) as {
      data: { steps: Array<{ name: string; status: string }> }
    }
    const platformStep = parsed.data.steps.find((s) => s.name === 'platform-url')
    expect(platformStep?.status).toBe('skip')
  })

  it('reports connectivity pass when platform is reachable', async () => {
    vi.mocked(getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(checkOnline).mockResolvedValue(true)
    const { stdout } = captureOutput()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'setup-check'])

    const parsed = JSON.parse(stdout.join('')) as {
      data: { steps: Array<{ name: string; status: string }> }
    }
    const connStep = parsed.data.steps.find((s) => s.name === 'connectivity')
    expect(connStep?.status).toBe('pass')
  })

  it('reports connectivity fail when platform is unreachable', async () => {
    vi.mocked(getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(checkOnline).mockResolvedValue(false)
    const { stdout } = captureOutput()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'setup-check'])

    const parsed = JSON.parse(stdout.join('')) as {
      data: { steps: Array<{ name: string; status: string }> }
    }
    const connStep = parsed.data.steps.find((s) => s.name === 'connectivity')
    expect(connStep?.status).toBe('fail')
  })

  it('includes detected agent count in results', async () => {
    vi.mocked(detectInstalledAgents).mockReturnValue([
      { id: 'claude-code', name: 'Claude Code', configPath: '/home/test/.claude/CLAUDE.md' },
      { id: 'cursor', name: 'Cursor', configPath: '/home/test/.cursor/rules' },
    ])
    const { stdout } = captureOutput()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'setup-check'])

    const parsed = JSON.parse(stdout.join('')) as {
      data: { steps: Array<{ name: string; message: string }> }
    }
    const agentStep = parsed.data.steps.find((s) => s.name === 'detect-agents')
    expect(agentStep?.message).toContain('2 agents')
  })
})
