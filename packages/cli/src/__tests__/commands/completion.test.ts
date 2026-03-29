import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue(''),
  appendFileSync: vi.fn(),
}))

vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('/home/testuser'),
}))

vi.mock('../../output', () => ({
  isJSONMode: vi.fn().mockReturnValue(false),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
  createSpinner: vi.fn(),
}))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { Command } from 'commander'
import { registerCompletionCommand } from '../../commands/completion'
import * as outputModule from '../../output'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createProgram(): Command {
  const program = new Command()
  program.exitOverride()
  registerCompletionCommand(program)
  return program
}

async function runCompletion(args: string[]): Promise<void> {
  const program = createProgram()
  await program.parseAsync(['node', 'agentver', ...args])
}

// The list of all expected top-level commands from the completion script
const EXPECTED_COMMANDS = [
  'adopt',
  'agents',
  'audit',
  'completion',
  'config',
  'diff',
  'doctor',
  'draft',
  'info',
  'init',
  'install',
  'list',
  'log',
  'login',
  'logout',
  'pin',
  'publish',
  'remove',
  'save',
  'scan',
  'search',
  'status',
  'suggest',
  'suggestions',
  'sync',
  'unpin',
  'update',
  'upgrade',
  'validate',
  'verify',
  'version',
  'whoami',
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('commands/completion', () => {
  const originalArgv = process.argv
  const originalExit = process.exit
  let stdoutData: string

  beforeEach(() => {
    vi.clearAllMocks()
    process.argv = ['node', 'agentver', 'completion']
    process.exit = vi.fn() as never
    vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

    stdoutData = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutData += String(chunk)
      return true
    })
  })

  afterEach(() => {
    process.argv = originalArgv
    process.exit = originalExit
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // 1. Bash completion
  // -------------------------------------------------------------------------

  describe('bash completion', () => {
    it('outputs valid bash completion script containing command names', async () => {
      await runCompletion(['completion', 'bash'])

      expect(stdoutData).toContain('_agentver()')
      expect(stdoutData).toContain('complete -F _agentver agentver')
      expect(stdoutData).toContain('COMPREPLY')

      // Verify all expected commands are present
      for (const cmd of EXPECTED_COMMANDS) {
        expect(stdoutData).toContain(cmd)
      }
    })
  })

  // -------------------------------------------------------------------------
  // 2. Zsh completion
  // -------------------------------------------------------------------------

  describe('zsh completion', () => {
    it('outputs valid zsh completion script', async () => {
      await runCompletion(['completion', 'zsh'])

      expect(stdoutData).toContain('_agentver()')
      expect(stdoutData).toContain('compdef _agentver agentver')
      expect(stdoutData).toContain('_arguments')

      for (const cmd of EXPECTED_COMMANDS) {
        expect(stdoutData).toContain(cmd)
      }
    })
  })

  // -------------------------------------------------------------------------
  // 3. Fish completion
  // -------------------------------------------------------------------------

  describe('fish completion', () => {
    it('outputs valid fish completion script', async () => {
      await runCompletion(['completion', 'fish'])

      expect(stdoutData).toContain('complete -c agentver')
      expect(stdoutData).toContain('__fish_use_subcommand')

      for (const cmd of EXPECTED_COMMANDS) {
        expect(stdoutData).toContain(cmd)
      }
    })
  })

  // -------------------------------------------------------------------------
  // 4. Invalid shell
  // -------------------------------------------------------------------------

  describe('invalid shell', () => {
    it('outputs error with supported shells listed', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'completion', '--json']

      // process.exit doesn't halt; code continues and calls SHELL_GENERATORS
      // with an invalid key, so catch the resulting TypeError
      try {
        await runCompletion(['completion', 'powershell'])
      } catch {
        // Expected — code continues past mocked process.exit
      }

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'INVALID_SHELL',
        expect.stringContaining('bash, zsh, fish')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('exits with error for invalid shell in non-JSON mode', async () => {
      try {
        await runCompletion(['completion', 'ksh'])
      } catch {
        // Expected — code continues past mocked process.exit
      }

      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -------------------------------------------------------------------------
  // 5. --install flag for bash
  // -------------------------------------------------------------------------

  describe('--install flag bash', () => {
    it('appends eval line to ~/.bashrc', async () => {
      vi.mocked(existsSync).mockReturnValue(false)

      await runCompletion(['completion', 'bash', '--install'])

      expect(appendFileSync).toHaveBeenCalledWith(
        '/home/testuser/.bashrc',
        expect.stringContaining('agentver completion bash')
      )
    })

    it('skips if already installed in .bashrc', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(
        '# existing content\neval "$(agentver completion bash)"\n'
      )

      await runCompletion(['completion', 'bash', '--install'])

      expect(appendFileSync).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 6. --install flag for zsh
  // -------------------------------------------------------------------------

  describe('--install flag zsh', () => {
    it('appends eval line to ~/.zshrc', async () => {
      vi.mocked(existsSync).mockReturnValue(false)

      await runCompletion(['completion', 'zsh', '--install'])

      expect(appendFileSync).toHaveBeenCalledWith(
        '/home/testuser/.zshrc',
        expect.stringContaining('agentver completion zsh')
      )
    })
  })

  // -------------------------------------------------------------------------
  // 7. All commands present in completion script
  // -------------------------------------------------------------------------

  describe('all commands present', () => {
    it('bash script contains all top-level commands', async () => {
      await runCompletion(['completion', 'bash'])

      for (const cmd of EXPECTED_COMMANDS) {
        expect(stdoutData).toContain(cmd)
      }
    })

    it('zsh script contains all top-level commands', async () => {
      stdoutData = ''
      await runCompletion(['completion', 'zsh'])

      for (const cmd of EXPECTED_COMMANDS) {
        expect(stdoutData).toContain(cmd)
      }
    })

    it('fish script contains all top-level commands', async () => {
      stdoutData = ''
      await runCompletion(['completion', 'fish'])

      for (const cmd of EXPECTED_COMMANDS) {
        expect(stdoutData).toContain(cmd)
      }
    })
  })

  // -------------------------------------------------------------------------
  // --json output
  // -------------------------------------------------------------------------

  describe('--json output', () => {
    it('returns shell and script in JSON output', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'completion', '--json']

      await runCompletion(['completion', 'bash'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.shell).toBe('bash')
      expect(typeof typed.script).toBe('string')
      expect((typed.script as string).length).toBeGreaterThan(0)
    })

    it('returns installed: true with rcPath when --install is used', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'completion', '--json']
      vi.mocked(existsSync).mockReturnValue(false)

      await runCompletion(['completion', 'zsh', '--install'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.shell).toBe('zsh')
      expect(typed.installed).toBe(true)
      expect(typed.rcPath).toBe('/home/testuser/.zshrc')
    })
  })

  // -------------------------------------------------------------------------
  // Subcommands in completion
  // -------------------------------------------------------------------------

  describe('subcommands in completion', () => {
    it('includes draft subcommands in bash script', async () => {
      await runCompletion(['completion', 'bash'])

      expect(stdoutData).toContain('create')
      expect(stdoutData).toContain('discard')
    })

    it('includes config subcommands in bash script', async () => {
      stdoutData = ''
      await runCompletion(['completion', 'bash'])

      expect(stdoutData).toContain('get')
      expect(stdoutData).toContain('set')
      expect(stdoutData).toContain('unset')
    })
  })
})
