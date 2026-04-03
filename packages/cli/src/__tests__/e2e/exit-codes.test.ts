/**
 * Systematic exit code verification for the CLI.
 *
 * Every command must reliably exit with the correct code so CI tooling and
 * shell scripts can trust the result. This file runs the real built binary
 * in isolated temp directories and asserts exit codes.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withTempDir } from '../helpers/mock-fs'
import { runCli, runCliJson } from './helpers'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seed a minimal valid manifest and lockfile so doctor passes all checks.
 */
function seedValidProject(dir: string): void {
  const agentverDir = join(dir, '.agentver')
  mkdirSync(agentverDir, { recursive: true })
  writeFileSync(
    join(agentverDir, 'manifest.json'),
    `${JSON.stringify({ version: 2, packages: {} }, null, 2)}\n`
  )
  writeFileSync(
    join(agentverDir, 'lockfile.json'),
    `${JSON.stringify({ version: 2, packages: {} }, null, 2)}\n`
  )
}

// ---------------------------------------------------------------------------
// Exit code 0 — success cases
// ---------------------------------------------------------------------------

describe('E2E: exit code 0 (success)', () => {
  it('agentver --version exits 0', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['--version'], { cwd: dir })
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
    })
  })

  it('agentver --help exits 0', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['--help'], { cwd: dir })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('agentver')
    })
  })

  it('agentver list exits 0 in an empty project', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['list'], { cwd: dir })
      expect(result.exitCode).toBe(0)
    })
  })

  it('agentver list --json exits 0 in an empty project', async () => {
    await withTempDir(async (dir) => {
      const { exitCode, success, data } = await runCliJson<{ packages: unknown[] }>(
        ['list', '--json'],
        { cwd: dir }
      )
      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.packages).toEqual([])
    })
  })

  it('agentver scan exits 0 in an empty project', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['scan'], { cwd: dir })
      expect(result.exitCode).toBe(0)
    })
  })

  it('agentver agents exits 0 when no agents are detected', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['agents'], { cwd: dir })
      expect(result.exitCode).toBe(0)
    })
  })

  it('agentver config list exits 0', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['config', 'list'], { cwd: dir })
      expect(result.exitCode).toBe(0)
    })
  })

  it('agentver doctor exits 0 when all checks pass', async () => {
    await withTempDir(async (dir) => {
      seedValidProject(dir)
      const result = await runCli(['doctor'], { cwd: dir, homeDir: dir })
      expect(result.exitCode).toBe(0)
    })
  })

  it('agentver status --offline exits 0 when empty', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['status', '--offline'], { cwd: dir })
      expect(result.exitCode).toBe(0)
    })
  })

  it('agentver status --json --offline exits 0 when empty', async () => {
    await withTempDir(async (dir) => {
      const { exitCode, success } = await runCliJson(['status', '--json', '--offline'], {
        cwd: dir,
      })
      expect(exitCode).toBe(0)
      expect(success).toBe(true)
    })
  })

  it('agentver whoami exits 0 when not authenticated', async () => {
    // whoami returns success: true with authenticated: false — it does not
    // treat "not logged in" as an error, just a state report.
    await withTempDir(async (dir) => {
      const { exitCode, success, data } = await runCliJson<{ authenticated: boolean }>(
        ['whoami', '--json'],
        { cwd: dir }
      )
      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.authenticated).toBe(false)
    })
  })

  it('agentver logout exits 0 even when not logged in', async () => {
    await withTempDir(async (dir) => {
      const { exitCode, success } = await runCliJson(['logout', '--json'], { cwd: dir })
      expect(exitCode).toBe(0)
      expect(success).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// Exit code non-zero — failure cases
// ---------------------------------------------------------------------------

describe('E2E: exit code non-zero (failure)', () => {
  it('agentver remove nonexistent-skill exits non-zero', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['remove', 'nonexistent-skill', '--yes'], { cwd: dir })
      expect(result.exitCode).not.toBe(0)
    })
  })

  it('agentver info nonexistent-skill exits non-zero', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['info', 'nonexistent-skill'], { cwd: dir })
      expect(result.exitCode).not.toBe(0)
    })
  })

  it('agentver diff nonexistent-skill exits non-zero', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['diff', 'nonexistent-skill'], { cwd: dir })
      expect(result.exitCode).not.toBe(0)
    })
  })

  it('agentver pin nonexistent-skill exits non-zero', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['pin', 'nonexistent-skill'], { cwd: dir })
      expect(result.exitCode).not.toBe(0)
    })
  })

  it('agentver unpin nonexistent-skill exits non-zero', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['unpin', 'nonexistent-skill'], { cwd: dir })
      expect(result.exitCode).not.toBe(0)
    })
  })

  it('agentver validate /nonexistent/path exits non-zero', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['validate', '/nonexistent/path/SKILL.md'], { cwd: dir })
      expect(result.exitCode).not.toBe(0)
    })
  })

  it('agentver publish exits non-zero with no SKILL.md', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['publish'], { cwd: dir })
      expect(result.exitCode).not.toBe(0)
    })
  })

  it('agentver unknown-command exits non-zero', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['unknown-command'], { cwd: dir })
      expect(result.exitCode).not.toBe(0)
    })
  })

  it('agentver verify nonexistent-skill exits non-zero', async () => {
    // verify with an invalid skill name (no @org/name format) sets exitCode = 1
    await withTempDir(async (dir) => {
      const result = await runCli(['verify', 'nonexistent-skill'], { cwd: dir })
      expect(result.exitCode).not.toBe(0)
    })
  })

  it('agentver remove (no name) exits non-zero', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['remove'], { cwd: dir })
      expect(result.exitCode).not.toBe(0)
    })
  })

  it('agentver init --json (no --name) exits non-zero', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['init', '--json'], { cwd: dir })
      expect(result.exitCode).not.toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// --json mode still exits non-zero on errors
// ---------------------------------------------------------------------------

describe('E2E: --json mode preserves non-zero exit codes', () => {
  it('agentver remove nonexistent-skill --json exits non-zero with JSON error', async () => {
    await withTempDir(async (dir) => {
      const { exitCode, success, error } = await runCliJson(
        ['remove', 'nonexistent-skill', '--json', '--yes'],
        { cwd: dir }
      )
      expect(exitCode).not.toBe(0)
      expect(success).toBe(false)
      expect(error).toBeDefined()
      expect(error!.code).toBe('NOT_FOUND')
      expect(typeof error!.message).toBe('string')
    })
  })

  it('agentver info nonexistent-skill --json exits non-zero with JSON error', async () => {
    await withTempDir(async (dir) => {
      const { exitCode, success, error } = await runCliJson(
        ['info', 'nonexistent-skill', '--json'],
        { cwd: dir }
      )
      expect(exitCode).not.toBe(0)
      expect(success).toBe(false)
      expect(error).toBeDefined()
      expect(error!.code).toBe('NOT_FOUND')
      expect(typeof error!.message).toBe('string')
    })
  })

  it('agentver pin nonexistent-skill --json exits non-zero with JSON error', async () => {
    await withTempDir(async (dir) => {
      const { exitCode, success, error } = await runCliJson(
        ['pin', 'nonexistent-skill', '--json'],
        { cwd: dir }
      )
      expect(exitCode).not.toBe(0)
      expect(success).toBe(false)
      expect(error).toBeDefined()
      expect(error!.code).toBe('NOT_FOUND')
    })
  })

  it('agentver unpin nonexistent-skill --json exits non-zero with JSON error', async () => {
    await withTempDir(async (dir) => {
      const { exitCode, success, error } = await runCliJson(
        ['unpin', 'nonexistent-skill', '--json'],
        { cwd: dir }
      )
      expect(exitCode).not.toBe(0)
      expect(success).toBe(false)
      expect(error).toBeDefined()
      expect(error!.code).toBe('NOT_FOUND')
    })
  })

  it('agentver validate /nonexistent/path --json exits non-zero with JSON error', async () => {
    await withTempDir(async (dir) => {
      const { exitCode, success, error } = await runCliJson(
        ['validate', '/nonexistent/path/SKILL.md', '--json'],
        { cwd: dir }
      )
      expect(exitCode).not.toBe(0)
      expect(success).toBe(false)
      expect(error).toBeDefined()
      expect(error!.code).toBe('NOT_FOUND')
    })
  })

  it('agentver unknown-command --json exits non-zero with JSON error', async () => {
    await withTempDir(async (dir) => {
      const { exitCode, success, error } = await runCliJson(['unknown-command', '--json'], {
        cwd: dir,
      })
      expect(exitCode).not.toBe(0)
      expect(success).toBe(false)
      expect(error).toBeDefined()
      expect(error!.code).toBe('UNKNOWN_COMMAND')
    })
  })

  it('agentver diff nonexistent-skill --json exits non-zero with JSON error', async () => {
    await withTempDir(async (dir) => {
      const { exitCode, success, error } = await runCliJson(
        ['diff', 'nonexistent-skill', '--json'],
        { cwd: dir }
      )
      expect(exitCode).not.toBe(0)
      expect(success).toBe(false)
      expect(error).toBeDefined()
      expect(error!.code).toBe('NOT_FOUND')
    })
  })
})

// ---------------------------------------------------------------------------
// doctor exit code reflects check results
// ---------------------------------------------------------------------------

describe('E2E: doctor exit codes', () => {
  it('agentver doctor --json exits 0 when all checks pass', async () => {
    await withTempDir(async (dir) => {
      seedValidProject(dir)
      const { exitCode, success, data } = await runCliJson<{
        passed: number
        failed: number
        warnings: number
      }>(['doctor', '--json'], { cwd: dir, homeDir: dir })
      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.failed).toBe(0)
    })
  })
})
