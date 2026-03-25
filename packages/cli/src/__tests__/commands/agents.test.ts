import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@agentver/agent-definitions', () => ({
  detectInstalledAgents: vi.fn().mockReturnValue([]),
  detectGlobalAgents: vi.fn().mockReturnValue([]),
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

vi.mock('../../output.js', () => ({
  isJSONMode: vi.fn().mockReturnValue(false),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { detectGlobalAgents, detectInstalledAgents } from '@agentver/agent-definitions'
import { registerAgentsCommand } from '../../commands/agents'
import * as outputModule from '../../output.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AgentsAction = (options: { global?: boolean }) => Promise<void>

function getAgentsAction(): AgentsAction {
  const mockProgram = {
    command: vi.fn().mockReturnThis(),
    description: vi.fn().mockReturnThis(),
    option: vi.fn().mockReturnThis(),
    action: vi.fn().mockReturnThis(),
  }

  registerAgentsCommand(mockProgram as never)

  return mockProgram.action.mock.calls[0]![0] as AgentsAction
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

describe('agents command', () => {
  const originalArgv = process.argv
  const originalExit = process.exit
  let agentsAction: AgentsAction
  let stdoutSpy: ReturnType<typeof vi.spyOn>
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    process.argv = ['node', 'agentver', 'agents']
    process.exit = vi.fn().mockImplementation((code: number) => {
      throw new ExitError(code)
    }) as never
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
    agentsAction = getAgentsAction()
  })

  afterEach(() => {
    process.argv = originalArgv
    process.exit = originalExit
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Project agents
  // -------------------------------------------------------------------------

  it('lists project agents when found', async () => {
    vi.mocked(detectInstalledAgents).mockReturnValue([
      { id: 'claude-code', name: 'Claude Code', configPath: '.claude/CLAUDE.md' },
    ] as never)

    await agentsAction({})

    expect(detectInstalledAgents).toHaveBeenCalledWith(process.cwd())
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('claude-code'))
  })

  it('shows empty message for project scope when no agents detected', async () => {
    vi.mocked(detectInstalledAgents).mockReturnValue([])

    await agentsAction({})

    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining('No agents detected in this project')
    )
  })

  // -------------------------------------------------------------------------
  // Global agents
  // -------------------------------------------------------------------------

  it('lists global agents when --global is passed', async () => {
    vi.mocked(detectGlobalAgents).mockReturnValue([
      { id: 'cursor', name: 'Cursor', configPath: '~/.cursorrules' },
    ] as never)

    await agentsAction({ global: true })

    expect(detectGlobalAgents).toHaveBeenCalled()
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('cursor'))
  })

  it('shows empty message for global scope when no agents detected', async () => {
    vi.mocked(detectGlobalAgents).mockReturnValue([])

    await agentsAction({ global: true })

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('No agents detected globally'))
  })

  // -------------------------------------------------------------------------
  // JSON output
  // -------------------------------------------------------------------------

  it('outputs JSON with agents and scope via outputSuccess', async () => {
    vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
    vi.mocked(detectInstalledAgents).mockReturnValue([
      { id: 'claude-code', name: 'Claude Code', configPath: '.claude/CLAUDE.md' },
    ] as never)

    await agentsAction({})

    expect(outputModule.outputSuccess).toHaveBeenCalledWith({
      agents: [{ id: 'claude-code', name: 'Claude Code', configPath: '.claude/CLAUDE.md' }],
      scope: 'project',
    })
  })

  it('outputs JSON with global scope label', async () => {
    vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
    vi.mocked(detectGlobalAgents).mockReturnValue([])

    await agentsAction({ global: true })

    expect(outputModule.outputSuccess).toHaveBeenCalledWith({
      agents: [],
      scope: 'global',
    })
  })

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it('handles detection errors gracefully in interactive mode', async () => {
    vi.mocked(detectInstalledAgents).mockImplementation(() => {
      throw new Error('Permission denied')
    })

    await expect(agentsAction({})).rejects.toThrow(ExitError)

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Permission denied'))
  })

  it('outputs error JSON when detection fails in JSON mode', async () => {
    vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
    vi.mocked(detectInstalledAgents).mockImplementation(() => {
      throw new Error('Permission denied')
    })

    await expect(agentsAction({})).rejects.toThrow(ExitError)

    expect(outputModule.outputError).toHaveBeenCalledWith('DETECT_FAILED', 'Permission denied')
  })
})
