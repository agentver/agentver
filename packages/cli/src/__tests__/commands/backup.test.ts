import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockListBackups = vi.fn()
const mockRestorePersistentBackup = vi.fn()
const mockDeleteBackup = vi.fn()

vi.mock('@agentver/installer', () => ({
  listBackups: (...args: unknown[]) => mockListBackups(...args),
  restorePersistentBackup: (...args: unknown[]) => mockRestorePersistentBackup(...args),
  deleteBackup: (...args: unknown[]) => mockDeleteBackup(...args),
}))

vi.mock('../../output.js', () => ({
  isJSONMode: vi.fn(),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
  createSpinner: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    text: '',
  })),
}))

vi.mock('prompts', () => ({
  default: vi.fn(),
}))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import { registerBackupCommand } from '../../commands/backup'

// ---------------------------------------------------------------------------
// Mock module imports
// ---------------------------------------------------------------------------

import type { BackupIndexEntry } from '@agentver/shared'
import { Command } from 'commander'
import prompts from 'prompts'
import * as outputModule from '../../output.js'

describe('backup command', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    vi.clearAllMocks()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.exitCode = undefined
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })

  function createProgram(): InstanceType<typeof Command> {
    const program = new Command()
    program.exitOverride()
    registerBackupCommand(program)
    return program
  }

  function createEntry(overrides?: Partial<BackupIndexEntry>): BackupIndexEntry {
    return {
      id: '2026-03-31T12-00-00-000Z',
      createdAt: '2026-03-31T12:00:00.000Z',
      packageKey: 'git:test',
      displayName: 'test-skill',
      reason: 'conflict-replace',
      items: [
        {
          originalPath: '/project/.claude/skills/test-skill',
          backupRelativePath: 'target-0',
          kind: 'directory',
          size: 1024,
        },
      ],
      ...overrides,
    }
  }

  // ---------------------------------------------------------------------------
  // backup list
  // ---------------------------------------------------------------------------

  describe('list', () => {
    it('shows a table of backups in text mode', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      mockListBackups.mockReturnValue([createEntry()])

      const program = createProgram()
      await program.parseAsync(['node', 'agentver', 'backup', 'list'])

      expect(mockListBackups).toHaveBeenCalledWith(expect.any(String), 'project')
      expect(consoleSpy).toHaveBeenCalled()
    })

    it('outputs JSON when --json is passed', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      const entries = [createEntry()]
      mockListBackups.mockReturnValue(entries)

      const program = createProgram()
      await program.parseAsync(['node', 'agentver', 'backup', 'list', '--json'])

      expect(outputModule.outputSuccess).toHaveBeenCalledWith({
        backups: entries,
      })
    })

    it('shows empty message when no backups exist', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      mockListBackups.mockReturnValue([])

      const program = createProgram()
      await program.parseAsync(['node', 'agentver', 'backup', 'list'])

      expect(consoleSpy).toHaveBeenCalled()
      const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(allOutput).toContain('No backups found')
    })

    it('uses global scope when --global is passed', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      mockListBackups.mockReturnValue([])

      const program = createProgram()
      await program.parseAsync(['node', 'agentver', 'backup', 'list', '--global'])

      expect(mockListBackups).toHaveBeenCalledWith(expect.any(String), 'global')
    })
  })

  // ---------------------------------------------------------------------------
  // backup restore
  // ---------------------------------------------------------------------------

  describe('restore', () => {
    it('restores a backup with --yes', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      mockListBackups.mockReturnValue([createEntry()])
      mockRestorePersistentBackup.mockReturnValue(['/project/.claude/skills/test-skill'])

      const program = createProgram()
      await program.parseAsync([
        'node',
        'agentver',
        'backup',
        'restore',
        '2026-03-31T12-00-00-000Z',
        '--yes',
      ])

      expect(mockRestorePersistentBackup).toHaveBeenCalledWith(
        expect.any(String),
        'project',
        '2026-03-31T12-00-00-000Z'
      )
    })

    it('prompts for confirmation in interactive mode', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      mockListBackups.mockReturnValue([createEntry()])
      vi.mocked(prompts).mockResolvedValue({ confirmed: true })
      mockRestorePersistentBackup.mockReturnValue(['/project/.claude/skills/test-skill'])

      const program = createProgram()
      await program.parseAsync([
        'node',
        'agentver',
        'backup',
        'restore',
        '2026-03-31T12-00-00-000Z',
      ])

      expect(prompts).toHaveBeenCalled()
      expect(mockRestorePersistentBackup).toHaveBeenCalled()
    })

    it('aborts when user declines confirmation', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      mockListBackups.mockReturnValue([createEntry()])
      vi.mocked(prompts).mockResolvedValue({ confirmed: false })

      const program = createProgram()
      await program.parseAsync([
        'node',
        'agentver',
        'backup',
        'restore',
        '2026-03-31T12-00-00-000Z',
      ])

      expect(mockRestorePersistentBackup).not.toHaveBeenCalled()
    })

    it('returns error for missing backup ID', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      mockListBackups.mockReturnValue([])

      const program = createProgram()
      await program.parseAsync(['node', 'agentver', 'backup', 'restore', 'nonexistent', '--yes'])

      expect(consoleErrorSpy).toHaveBeenCalled()
      expect(process.exitCode).toBe(1)
    })

    it('returns JSON error in JSON mode without --yes', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      mockListBackups.mockReturnValue([createEntry()])

      const program = createProgram()
      await program.parseAsync([
        'node',
        'agentver',
        'backup',
        'restore',
        '2026-03-31T12-00-00-000Z',
      ])

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'CONFIRMATION_REQUIRED',
        expect.any(String)
      )
    })

    it('returns JSON success in JSON mode with --yes', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      mockListBackups.mockReturnValue([createEntry()])
      mockRestorePersistentBackup.mockReturnValue(['/project/.claude/skills/test-skill'])

      const program = createProgram()
      await program.parseAsync([
        'node',
        'agentver',
        'backup',
        'restore',
        '2026-03-31T12-00-00-000Z',
        '--yes',
      ])

      expect(outputModule.outputSuccess).toHaveBeenCalledWith({
        restored: true,
        backupId: '2026-03-31T12-00-00-000Z',
        paths: ['/project/.claude/skills/test-skill'],
      })
    })
  })

  // ---------------------------------------------------------------------------
  // backup delete
  // ---------------------------------------------------------------------------

  describe('delete', () => {
    it('deletes a backup with --yes', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      mockListBackups.mockReturnValue([createEntry()])

      const program = createProgram()
      await program.parseAsync([
        'node',
        'agentver',
        'backup',
        'delete',
        '2026-03-31T12-00-00-000Z',
        '--yes',
      ])

      expect(mockDeleteBackup).toHaveBeenCalledWith(
        expect.any(String),
        'project',
        '2026-03-31T12-00-00-000Z'
      )
    })

    it('prompts for confirmation in interactive mode', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      mockListBackups.mockReturnValue([createEntry()])
      vi.mocked(prompts).mockResolvedValue({ confirmed: true })

      const program = createProgram()
      await program.parseAsync(['node', 'agentver', 'backup', 'delete', '2026-03-31T12-00-00-000Z'])

      expect(prompts).toHaveBeenCalled()
      expect(mockDeleteBackup).toHaveBeenCalled()
    })

    it('returns error for missing backup ID', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      mockListBackups.mockReturnValue([])

      const program = createProgram()
      await program.parseAsync(['node', 'agentver', 'backup', 'delete', 'nonexistent', '--yes'])

      expect(consoleErrorSpy).toHaveBeenCalled()
      expect(process.exitCode).toBe(1)
    })

    it('returns JSON output when --json --yes passed', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      mockListBackups.mockReturnValue([createEntry()])

      const program = createProgram()
      await program.parseAsync([
        'node',
        'agentver',
        'backup',
        'delete',
        '2026-03-31T12-00-00-000Z',
        '--yes',
      ])

      expect(outputModule.outputSuccess).toHaveBeenCalledWith({
        deleted: true,
        backupId: '2026-03-31T12-00-00-000Z',
      })
    })
  })
})
