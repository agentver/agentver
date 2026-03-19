import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createManifest, createManifestPackage } from '../helpers/fixtures'

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../../storage/manifest', () => ({
  readManifest: vi.fn(),
  writeManifest: vi.fn(),
}))

vi.mock('../../output.js', () => ({
  isJSONMode: vi.fn().mockReturnValue(false),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
  createSpinner: vi.fn(),
}))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import { Command } from 'commander'
import { registerPinCommand, registerUnpinCommand } from '../../commands/pin'
import * as outputModule from '../../output.js'
import * as manifestModule from '../../storage/manifest'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createPinProgram(): Command {
  const program = new Command()
  program.exitOverride()
  registerPinCommand(program)
  return program
}

function createUnpinProgram(): Command {
  const program = new Command()
  program.exitOverride()
  registerUnpinCommand(program)
  return program
}

async function runPin(args: string[]): Promise<void> {
  const program = createPinProgram()
  await program.parseAsync(['node', 'agentver', ...args])
}

async function runUnpin(args: string[]): Promise<void> {
  const program = createUnpinProgram()
  await program.parseAsync(['node', 'agentver', ...args])
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('commands/pin', () => {
  const originalCwd = process.cwd
  const originalArgv = process.argv
  const originalExit = process.exit

  beforeEach(() => {
    vi.clearAllMocks()
    process.cwd = vi.fn().mockReturnValue('/project')
    process.argv = ['node', 'agentver', 'pin']
    process.exit = vi.fn() as never
    vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
  })

  afterEach(() => {
    process.cwd = originalCwd
    process.argv = originalArgv
    process.exit = originalExit
  })

  // -------------------------------------------------------------------------
  // 1. Pin happy path
  // -------------------------------------------------------------------------

  describe('pin happy path', () => {
    it('sets pinned: true on the manifest entry', async () => {
      const pkg = createManifestPackage()
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({ packages: { 'my-skill': pkg } })
      )

      await runPin(['pin', 'my-skill'])

      expect(manifestModule.writeManifest).toHaveBeenCalledTimes(1)
      const [, manifest] = vi.mocked(manifestModule.writeManifest).mock.calls[0]!
      expect(manifest.packages['my-skill']!.pinned).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // 2. Pin not installed
  // -------------------------------------------------------------------------

  describe('pin not installed', () => {
    it('outputs error when package is not installed', async () => {
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'pin', '--json']

      // process.exit doesn't halt execution in tests, so catch the TypeError
      // that occurs when code continues past exit
      try {
        await runPin(['pin', 'nonexistent'])
      } catch {
        // Expected — code continues past mocked process.exit
      }

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'NOT_FOUND',
        expect.stringContaining('not installed')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -------------------------------------------------------------------------
  // 3. Already pinned
  // -------------------------------------------------------------------------

  describe('already pinned', () => {
    it('is idempotent — pinning an already pinned package succeeds', async () => {
      const pkg = createManifestPackage()
      pkg.pinned = true
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({ packages: { 'my-skill': pkg } })
      )

      await runPin(['pin', 'my-skill'])

      expect(manifestModule.writeManifest).toHaveBeenCalledTimes(1)
      const [, manifest] = vi.mocked(manifestModule.writeManifest).mock.calls[0]!
      expect(manifest.packages['my-skill']!.pinned).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // 4. Unpin happy path
  // -------------------------------------------------------------------------

  describe('unpin happy path', () => {
    it('removes the pinned flag from the manifest entry', async () => {
      const pkg = createManifestPackage()
      pkg.pinned = true
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({ packages: { 'my-skill': pkg } })
      )

      await runUnpin(['unpin', 'my-skill'])

      expect(manifestModule.writeManifest).toHaveBeenCalledTimes(1)
      const [, manifest] = vi.mocked(manifestModule.writeManifest).mock.calls[0]!
      expect(manifest.packages['my-skill']!.pinned).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // 5. Unpin not pinned
  // -------------------------------------------------------------------------

  describe('unpin not pinned', () => {
    it('handles gracefully when package is not pinned', async () => {
      const pkg = createManifestPackage()
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({ packages: { 'my-skill': pkg } })
      )

      await runUnpin(['unpin', 'my-skill'])

      expect(manifestModule.writeManifest).toHaveBeenCalledTimes(1)
      // Should still succeed — delete of undefined property is fine
      expect(process.exit).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 6. Unpin not installed
  // -------------------------------------------------------------------------

  describe('unpin not installed', () => {
    it('outputs error when package is not installed', async () => {
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'unpin', '--json']

      // process.exit doesn't halt execution in tests, so catch the TypeError
      // that occurs when code continues past exit
      try {
        await runUnpin(['unpin', 'nonexistent'])
      } catch {
        // Expected — code continues past mocked process.exit
      }

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'NOT_FOUND',
        expect.stringContaining('not installed')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -------------------------------------------------------------------------
  // 7. --json output for pin
  // -------------------------------------------------------------------------

  describe('--json output for pin', () => {
    it('outputs success with name and pinned: true', async () => {
      const pkg = createManifestPackage()
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({ packages: { 'my-skill': pkg } })
      )
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'pin', '--json']

      await runPin(['pin', 'my-skill'])

      expect(outputModule.outputSuccess).toHaveBeenCalledWith({
        name: 'my-skill',
        pinned: true,
      })
    })
  })

  // -------------------------------------------------------------------------
  // 8. --json output for unpin
  // -------------------------------------------------------------------------

  describe('--json output for unpin', () => {
    it('outputs success with name and pinned: false', async () => {
      const pkg = createManifestPackage()
      pkg.pinned = true
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({ packages: { 'my-skill': pkg } })
      )
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'unpin', '--json']

      await runUnpin(['unpin', 'my-skill'])

      expect(outputModule.outputSuccess).toHaveBeenCalledWith({
        name: 'my-skill',
        pinned: false,
      })
    })
  })

  // -------------------------------------------------------------------------
  // 9. Global scope pin
  // -------------------------------------------------------------------------

  describe('--global pin', () => {
    it('passes global scope to readManifest', async () => {
      const pkg = createManifestPackage()
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({ packages: { 'my-skill': pkg } })
      )

      await runPin(['pin', 'my-skill', '--global'])

      expect(manifestModule.readManifest).toHaveBeenCalledWith('/project', 'global')
    })

    it('passes global scope to writeManifest', async () => {
      const pkg = createManifestPackage()
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({ packages: { 'my-skill': pkg } })
      )

      await runPin(['pin', 'my-skill', '--global'])

      expect(manifestModule.writeManifest).toHaveBeenCalledWith(
        '/project',
        expect.any(Object),
        'global'
      )
    })

    it('sets pinned: true on global manifest entry', async () => {
      const pkg = createManifestPackage()
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({ packages: { 'my-skill': pkg } })
      )

      await runPin(['pin', 'my-skill', '--global'])

      const [, manifest] = vi.mocked(manifestModule.writeManifest).mock.calls[0]!
      expect(manifest.packages['my-skill']!.pinned).toBe(true)
    })

    it('errors when package not found in global scope', async () => {
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      try {
        await runPin(['pin', 'nonexistent', '--global'])
      } catch {
        // Expected — code continues past mocked process.exit
      }

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'NOT_FOUND',
        expect.stringContaining('not installed')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -------------------------------------------------------------------------
  // 10. Global scope unpin
  // -------------------------------------------------------------------------

  describe('--global unpin', () => {
    it('passes global scope to readManifest', async () => {
      const pkg = createManifestPackage()
      pkg.pinned = true
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({ packages: { 'my-skill': pkg } })
      )

      await runUnpin(['unpin', 'my-skill', '--global'])

      expect(manifestModule.readManifest).toHaveBeenCalledWith('/project', 'global')
    })

    it('passes global scope to writeManifest', async () => {
      const pkg = createManifestPackage()
      pkg.pinned = true
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({ packages: { 'my-skill': pkg } })
      )

      await runUnpin(['unpin', 'my-skill', '--global'])

      expect(manifestModule.writeManifest).toHaveBeenCalledWith(
        '/project',
        expect.any(Object),
        'global'
      )
    })

    it('removes pinned flag from global manifest entry', async () => {
      const pkg = createManifestPackage()
      pkg.pinned = true
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({ packages: { 'my-skill': pkg } })
      )

      await runUnpin(['unpin', 'my-skill', '--global'])

      const [, manifest] = vi.mocked(manifestModule.writeManifest).mock.calls[0]!
      expect(manifest.packages['my-skill']!.pinned).toBeUndefined()
    })

    it('errors when package not found in global scope', async () => {
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      try {
        await runUnpin(['unpin', 'nonexistent', '--global'])
      } catch {
        // Expected — code continues past mocked process.exit
      }

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'NOT_FOUND',
        expect.stringContaining('not installed')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })
})
