import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports that reference them
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  lstatSync: vi.fn(),
  readlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  readdirSync: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}))

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

vi.mock('../../storage/manifest.js', () => ({
  readManifest: vi.fn().mockReturnValue({ version: 2, packages: {} }),
}))

vi.mock('../../storage/lockfile.js', () => ({
  readLockfile: vi.fn().mockReturnValue({ version: 2, packages: {} }),
}))

vi.mock('../../storage/canonical.js', () => ({
  getCanonicalSkillPath: vi.fn(
    (projectRoot: string, name: string) => `${projectRoot}/.agents/skills/${name}`
  ),
}))

vi.mock('@agentver/agent-definitions', () => ({
  getSkillPlacementPath: vi.fn().mockReturnValue(null),
}))

vi.mock('@agentver/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentver/shared')>()
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  }
})

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
    text: '',
  }
  return { default: () => spinner }
})

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { execSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { getSkillPlacementPath } from '@agentver/agent-definitions'
import { createCLIOutputSchema, doctorResultSchema } from '@agentver/shared'
import { Command } from 'commander'
import { registerDoctorCommand } from '../../commands/doctor.js'
import { getCredentials } from '../../registry/auth.js'
import { getPlatformUrl } from '../../registry/config.js'
import { readLockfile } from '../../storage/lockfile.js'
import { readManifest } from '../../storage/manifest.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildProgram(): Command {
  const program = new Command()
  program.exitOverride()
  registerDoctorCommand(program)
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

/** Set up mocks for a fully healthy project. */
function setupHealthyProject(): void {
  // Manifest file exists and is valid
  vi.mocked(existsSync).mockImplementation((p: unknown) => {
    const path = String(p)
    if (path.includes('manifest.json')) return true
    if (path.includes('lockfile.json')) return true
    return false
  })

  vi.mocked(readFileSync).mockImplementation((p: unknown) => {
    const path = String(p)
    if (path.includes('manifest.json')) {
      return JSON.stringify({ version: 2, packages: {} })
    }
    if (path.includes('lockfile.json')) {
      return JSON.stringify({ version: 2, packages: {} })
    }
    return ''
  })

  // Manifest and lockfile are in sync (both empty)
  vi.mocked(readManifest).mockReturnValue({ version: 2, packages: {} })
  vi.mocked(readLockfile).mockReturnValue({ version: 2, packages: {} })

  // Git is available
  vi.mocked(execSync).mockReturnValue('git version 2.43.0\n' as never)

  // Authenticated and platform reachable
  vi.mocked(getCredentials).mockResolvedValue({ token: 'test-token' })
  vi.mocked(getPlatformUrl).mockReturnValue('https://app.agentver.com')
}

type DoctorCheck = { name: string; status: string; message: string }
type DoctorOutput = {
  success: boolean
  data: { checks: DoctorCheck[]; passed: number; failed: number; warnings: number }
}

function findCheck(checks: DoctorCheck[], name: string): DoctorCheck | undefined {
  return checks.find((c) => c.name === name)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('doctor command', () => {
  let processExitSpy: ReturnType<typeof vi.spyOn>
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let originalNodeVersion: string

  beforeEach(() => {
    vi.clearAllMocks()
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as never)
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    // Mock fetch for authentication health check
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(null, { status: 200 })
      })
    )

    process.argv = ['node', 'agentver', 'doctor']
    originalNodeVersion = process.versions.node
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(process.versions, 'node', {
      value: originalNodeVersion,
      writable: true,
      configurable: true,
    })
  })

  // -------------------------------------------------------------------------
  // 1. All healthy — all checks PASS
  // -------------------------------------------------------------------------

  it('reports all checks as passing when everything is healthy', async () => {
    process.argv = ['node', 'agentver', 'doctor', '--json']
    setupHealthyProject()
    const { stdout } = captureOutput()

    const program = buildProgram()

    await expect(program.parseAsync(['node', 'agentver', 'doctor', '--json'])).rejects.toThrow(
      'process.exit called'
    )

    // exit(0) for all passing
    expect(processExitSpy).toHaveBeenCalledWith(0)

    const parsed = JSON.parse(stdout.join('')) as DoctorOutput
    expect(parsed.success).toBe(true)
    expect(parsed.data.failed).toBe(0)
    expect(parsed.data.passed).toBeGreaterThan(0)

    const manifestCheck = findCheck(parsed.data.checks, 'manifest-integrity')
    expect(manifestCheck?.status).toBe('pass')

    const lockfileCheck = findCheck(parsed.data.checks, 'lockfile-integrity')
    expect(lockfileCheck?.status).toBe('pass')

    const syncCheck = findCheck(parsed.data.checks, 'manifest-lockfile-sync')
    expect(syncCheck?.status).toBe('pass')

    const gitCheck = findCheck(parsed.data.checks, 'git-available')
    expect(gitCheck?.status).toBe('pass')

    const nodeCheck = findCheck(parsed.data.checks, 'node-version')
    expect(nodeCheck?.status).toBe('pass')
  })

  // -------------------------------------------------------------------------
  // 2. Missing manifest — reports warning
  // -------------------------------------------------------------------------

  it('reports warning when manifest file does not exist', async () => {
    process.argv = ['node', 'agentver', 'doctor', '--json']
    setupHealthyProject()

    vi.mocked(existsSync).mockImplementation((p: unknown) => {
      const path = String(p)
      if (path.includes('manifest.json')) return false
      if (path.includes('lockfile.json')) return true
      return false
    })

    const { stdout } = captureOutput()
    const program = buildProgram()

    await expect(program.parseAsync(['node', 'agentver', 'doctor', '--json'])).rejects.toThrow(
      'process.exit called'
    )

    const parsed = JSON.parse(stdout.join('')) as DoctorOutput
    const manifestCheck = findCheck(parsed.data.checks, 'manifest-integrity')
    expect(manifestCheck?.status).toBe('warn')
    expect(manifestCheck?.message).toContain('not found')
  })

  // -------------------------------------------------------------------------
  // 3. Invalid manifest JSON — reports FAIL
  // -------------------------------------------------------------------------

  it('reports fail when manifest contains invalid JSON', async () => {
    process.argv = ['node', 'agentver', 'doctor', '--json']
    setupHealthyProject()

    vi.mocked(existsSync).mockImplementation((p: unknown) => {
      const path = String(p)
      if (path.includes('manifest.json')) return true
      if (path.includes('lockfile.json')) return true
      return false
    })

    vi.mocked(readFileSync).mockImplementation((p: unknown) => {
      const path = String(p)
      if (path.includes('manifest.json')) return '{ invalid json }'
      if (path.includes('lockfile.json')) return JSON.stringify({ version: 2, packages: {} })
      return ''
    })

    const { stdout } = captureOutput()
    const program = buildProgram()

    await expect(program.parseAsync(['node', 'agentver', 'doctor', '--json'])).rejects.toThrow(
      'process.exit called'
    )

    const parsed = JSON.parse(stdout.join('')) as DoctorOutput
    const manifestCheck = findCheck(parsed.data.checks, 'manifest-integrity')
    expect(manifestCheck?.status).toBe('fail')
    expect(manifestCheck?.message).toContain('invalid JSON')
  })

  // -------------------------------------------------------------------------
  // 4. Manifest/lockfile out of sync — reports FAIL
  // -------------------------------------------------------------------------

  it('reports fail when manifest and lockfile are out of sync', async () => {
    process.argv = ['node', 'agentver', 'doctor', '--json']
    setupHealthyProject()

    vi.mocked(readManifest).mockReturnValue({
      version: 2,
      packages: {
        'package-a': {
          source: {
            type: 'git',
            uri: 'https://github.com/test/repo',
            path: '',
            ref: 'main',
            commit: 'abc123',
          },
          agents: ['claude-code'],
          installedAt: '2025-01-01T00:00:00.000Z',
          modified: false,
        },
      },
    })
    vi.mocked(readLockfile).mockReturnValue({ version: 2, packages: {} })

    const { stdout } = captureOutput()
    const program = buildProgram()

    await expect(program.parseAsync(['node', 'agentver', 'doctor', '--json'])).rejects.toThrow(
      'process.exit called'
    )

    expect(processExitSpy).toHaveBeenCalledWith(1)

    const parsed = JSON.parse(stdout.join('')) as DoctorOutput
    const syncCheck = findCheck(parsed.data.checks, 'manifest-lockfile-sync')
    expect(syncCheck?.status).toBe('fail')
    expect(syncCheck?.message).toContain('Out of sync')
    expect(syncCheck?.message).toContain('package-a')
  })

  // -------------------------------------------------------------------------
  // 5. Missing skill directory — reports FAIL
  // -------------------------------------------------------------------------

  it('reports fail when skill directory does not exist', async () => {
    process.argv = ['node', 'agentver', 'doctor', '--json']
    setupHealthyProject()

    vi.mocked(readManifest).mockReturnValue({
      version: 2,
      packages: {
        'package-a': {
          source: {
            type: 'git',
            uri: 'https://github.com/test/repo',
            path: '',
            ref: 'main',
            commit: 'abc123',
          },
          agents: ['claude-code'],
          installedAt: '2025-01-01T00:00:00.000Z',
          modified: false,
        },
      },
    })
    vi.mocked(readLockfile).mockReturnValue({
      version: 2,
      packages: {
        'package-a': {
          source: {
            type: 'git',
            uri: 'https://github.com/test/repo',
            path: '',
            ref: 'main',
            commit: 'abc123',
          },
          integrity: 'sha256-abc123',
          agents: ['claude-code'],
        },
      },
    })

    // The canonical skill path does not exist
    vi.mocked(existsSync).mockImplementation((p: unknown) => {
      const path = String(p)
      if (path.includes('manifest.json')) return true
      if (path.includes('lockfile.json')) return true
      if (path.includes('.agents/skills/package-a')) return false
      return false
    })

    const { stdout } = captureOutput()
    const program = buildProgram()

    await expect(program.parseAsync(['node', 'agentver', 'doctor', '--json'])).rejects.toThrow(
      'process.exit called'
    )

    expect(processExitSpy).toHaveBeenCalledWith(1)

    const parsed = JSON.parse(stdout.join('')) as DoctorOutput
    const filesCheck = findCheck(parsed.data.checks, 'skill-files-exist')
    expect(filesCheck?.status).toBe('fail')
    expect(filesCheck?.message).toContain('package-a')
  })

  // -------------------------------------------------------------------------
  // 6. Broken symlink — reports FAIL
  // -------------------------------------------------------------------------

  it('reports fail when agent symlink points to non-existent path', async () => {
    process.argv = ['node', 'agentver', 'doctor', '--json']
    setupHealthyProject()

    const agentPlacementPath = '.claude/skills/package-a'
    vi.mocked(getSkillPlacementPath).mockReturnValue(agentPlacementPath)

    vi.mocked(readManifest).mockReturnValue({
      version: 2,
      packages: {
        'package-a': {
          source: {
            type: 'git',
            uri: 'https://github.com/test/repo',
            path: '',
            ref: 'main',
            commit: 'abc123',
          },
          agents: ['claude-code'],
          installedAt: '2025-01-01T00:00:00.000Z',
          modified: false,
        },
      },
    })
    vi.mocked(readLockfile).mockReturnValue({
      version: 2,
      packages: {
        'package-a': {
          source: {
            type: 'git',
            uri: 'https://github.com/test/repo',
            path: '',
            ref: 'main',
            commit: 'abc123',
          },
          integrity: 'sha256-abc123',
          agents: ['claude-code'],
        },
      },
    })

    // Track how many times existsSync is called with the agent path
    // to distinguish between the "does the symlink path exist?" check
    // and the "does the resolved target exist?" check.
    const agentPathCalls: string[] = []

    vi.mocked(existsSync).mockImplementation((p: unknown) => {
      const path = String(p)
      if (path.includes('manifest.json')) return true
      if (path.includes('lockfile.json')) return true
      // For skill-files-exist: the canonical skill dir exists
      if (path.endsWith('.agents/skills/package-a')) return true
      // For symlinks-valid: the agent placement path exists (first call)
      if (path.includes('.claude/skills/package-a')) {
        agentPathCalls.push(path)
        // First call from existsSync(agentSkillPath) — path exists
        if (agentPathCalls.length === 1) return true
        // Subsequent calls (resolvedTarget) — doesn't exist
        return false
      }
      return false
    })

    vi.mocked(lstatSync).mockImplementation((p: unknown) => {
      const path = String(p)
      if (path.endsWith('.agents/skills/package-a')) {
        return { isDirectory: () => true, isSymbolicLink: () => false } as never
      }
      if (path.includes('.claude/skills/package-a')) {
        return { isDirectory: () => false, isSymbolicLink: () => true } as never
      }
      return { isDirectory: () => false, isSymbolicLink: () => false } as never
    })

    // The symlink points to a relative path that won't resolve
    vi.mocked(readlinkSync).mockReturnValue('../../../nonexistent/target')

    const { stdout } = captureOutput()
    const program = buildProgram()

    await expect(program.parseAsync(['node', 'agentver', 'doctor', '--json'])).rejects.toThrow(
      'process.exit called'
    )

    const parsed = JSON.parse(stdout.join('')) as DoctorOutput
    const symlinksCheck = findCheck(parsed.data.checks, 'symlinks-valid')
    expect(symlinksCheck?.status).toBe('fail')
    expect(symlinksCheck?.message).toContain('broken symlink')
  })

  // -------------------------------------------------------------------------
  // 7. Not authenticated — reports as WARN
  // -------------------------------------------------------------------------

  it('reports warning when not authenticated', async () => {
    process.argv = ['node', 'agentver', 'doctor', '--json']
    setupHealthyProject()

    vi.mocked(getCredentials).mockResolvedValue(null)
    vi.mocked(getPlatformUrl).mockReturnValue(null)

    const { stdout } = captureOutput()
    const program = buildProgram()

    await expect(program.parseAsync(['node', 'agentver', 'doctor', '--json'])).rejects.toThrow(
      'process.exit called'
    )

    // Should not fail (exit 0) — auth is just a warning
    expect(processExitSpy).toHaveBeenCalledWith(0)

    const parsed = JSON.parse(stdout.join('')) as DoctorOutput
    const authCheck = findCheck(parsed.data.checks, 'authentication')
    expect(authCheck?.status).toBe('warn')
    expect(authCheck?.message).toContain('No credentials')
  })

  it('reports warning when credentials exist but no platform URL', async () => {
    process.argv = ['node', 'agentver', 'doctor', '--json']
    setupHealthyProject()

    vi.mocked(getCredentials).mockResolvedValue({ token: 'valid-token' })
    vi.mocked(getPlatformUrl).mockReturnValue(null)

    const { stdout } = captureOutput()
    const program = buildProgram()

    await expect(program.parseAsync(['node', 'agentver', 'doctor', '--json'])).rejects.toThrow(
      'process.exit called'
    )

    const parsed = JSON.parse(stdout.join('')) as DoctorOutput
    const authCheck = findCheck(parsed.data.checks, 'authentication')
    expect(authCheck?.status).toBe('warn')
    expect(authCheck?.message).toContain('no platform URL')
  })

  // -------------------------------------------------------------------------
  // 8. Git not available — reports FAIL
  // -------------------------------------------------------------------------

  it('reports fail when git is not installed', async () => {
    process.argv = ['node', 'agentver', 'doctor', '--json']
    setupHealthyProject()

    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('git not found')
    })

    const { stdout } = captureOutput()
    const program = buildProgram()

    await expect(program.parseAsync(['node', 'agentver', 'doctor', '--json'])).rejects.toThrow(
      'process.exit called'
    )

    expect(processExitSpy).toHaveBeenCalledWith(1)

    const parsed = JSON.parse(stdout.join('')) as DoctorOutput
    const gitCheck = findCheck(parsed.data.checks, 'git-available')
    expect(gitCheck?.status).toBe('fail')
    expect(gitCheck?.message).toContain('not installed')
  })

  // -------------------------------------------------------------------------
  // 9. Node version < 20 — reports FAIL
  // -------------------------------------------------------------------------

  it('reports fail when Node version is below 20', async () => {
    process.argv = ['node', 'agentver', 'doctor', '--json']
    setupHealthyProject()

    Object.defineProperty(process.versions, 'node', {
      value: '18.19.0',
      writable: true,
      configurable: true,
    })

    const { stdout } = captureOutput()
    const program = buildProgram()

    await expect(program.parseAsync(['node', 'agentver', 'doctor', '--json'])).rejects.toThrow(
      'process.exit called'
    )

    expect(processExitSpy).toHaveBeenCalledWith(1)

    const parsed = JSON.parse(stdout.join('')) as DoctorOutput
    const nodeCheck = findCheck(parsed.data.checks, 'node-version')
    expect(nodeCheck?.status).toBe('fail')
    expect(nodeCheck?.message).toContain('below minimum')
  })

  // -------------------------------------------------------------------------
  // 10. --json output validates against doctorResultSchema
  // -------------------------------------------------------------------------

  it('validates JSON output against doctorResultSchema', async () => {
    process.argv = ['node', 'agentver', 'doctor', '--json']
    setupHealthyProject()
    const { stdout } = captureOutput()

    const program = buildProgram()

    await expect(program.parseAsync(['node', 'agentver', 'doctor', '--json'])).rejects.toThrow(
      'process.exit called'
    )

    const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>
    expect(parsed.success).toBe(true)

    const outputSchema = createCLIOutputSchema(doctorResultSchema)
    const result = outputSchema.safeParse(parsed)
    expect(result.success).toBe(true)
  })

  it('includes all expected check names in output', async () => {
    process.argv = ['node', 'agentver', 'doctor', '--json']
    setupHealthyProject()
    const { stdout } = captureOutput()

    const program = buildProgram()

    await expect(program.parseAsync(['node', 'agentver', 'doctor', '--json'])).rejects.toThrow(
      'process.exit called'
    )

    const parsed = JSON.parse(stdout.join('')) as DoctorOutput
    const checkNames = parsed.data.checks.map((c) => c.name)

    expect(checkNames).toContain('manifest-integrity')
    expect(checkNames).toContain('lockfile-integrity')
    expect(checkNames).toContain('manifest-lockfile-sync')
    expect(checkNames).toContain('skill-files-exist')
    expect(checkNames).toContain('symlinks-valid')
    expect(checkNames).toContain('authentication')
    expect(checkNames).toContain('git-available')
    expect(checkNames).toContain('node-version')
  })

  // -------------------------------------------------------------------------
  // 11. Exit code — 0 when all pass, non-zero when any FAIL
  // -------------------------------------------------------------------------

  it('exits with code 0 when all checks pass', async () => {
    process.argv = ['node', 'agentver', 'doctor', '--json']
    setupHealthyProject()
    captureOutput()

    const program = buildProgram()

    await expect(program.parseAsync(['node', 'agentver', 'doctor', '--json'])).rejects.toThrow(
      'process.exit called'
    )

    expect(processExitSpy).toHaveBeenCalledWith(0)
  })

  it('exits with non-zero code when any check fails', async () => {
    process.argv = ['node', 'agentver', 'doctor', '--json']
    setupHealthyProject()

    // Make git unavailable to cause a fail
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('git not found')
    })

    captureOutput()
    const program = buildProgram()

    await expect(program.parseAsync(['node', 'agentver', 'doctor', '--json'])).rejects.toThrow(
      'process.exit called'
    )

    expect(processExitSpy).toHaveBeenCalledWith(1)
  })

  // -------------------------------------------------------------------------
  // Non-JSON mode — text output
  // -------------------------------------------------------------------------

  it('prints formatted text output in non-JSON mode', async () => {
    setupHealthyProject()

    const program = buildProgram()

    await expect(program.parseAsync(['node', 'agentver', 'doctor'])).rejects.toThrow(
      'process.exit called'
    )

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Health checks'))
  })

  // -------------------------------------------------------------------------
  // Lockfile-specific checks
  // -------------------------------------------------------------------------

  it('reports warning when lockfile does not exist', async () => {
    process.argv = ['node', 'agentver', 'doctor', '--json']
    setupHealthyProject()

    vi.mocked(existsSync).mockImplementation((p: unknown) => {
      const path = String(p)
      if (path.includes('manifest.json')) return true
      if (path.includes('lockfile.json')) return false
      return false
    })

    const { stdout } = captureOutput()
    const program = buildProgram()

    await expect(program.parseAsync(['node', 'agentver', 'doctor', '--json'])).rejects.toThrow(
      'process.exit called'
    )

    const parsed = JSON.parse(stdout.join('')) as DoctorOutput
    const lockfileCheck = findCheck(parsed.data.checks, 'lockfile-integrity')
    expect(lockfileCheck?.status).toBe('warn')
    expect(lockfileCheck?.message).toContain('not found')
  })

  it('reports fail when lockfile contains invalid JSON', async () => {
    process.argv = ['node', 'agentver', 'doctor', '--json']
    setupHealthyProject()

    vi.mocked(existsSync).mockImplementation((p: unknown) => {
      const path = String(p)
      if (path.includes('manifest.json')) return true
      if (path.includes('lockfile.json')) return true
      return false
    })

    vi.mocked(readFileSync).mockImplementation((p: unknown) => {
      const path = String(p)
      if (path.includes('manifest.json')) return JSON.stringify({ version: 2, packages: {} })
      if (path.includes('lockfile.json')) return '{ not valid }'
      return ''
    })

    const { stdout } = captureOutput()
    const program = buildProgram()

    await expect(program.parseAsync(['node', 'agentver', 'doctor', '--json'])).rejects.toThrow(
      'process.exit called'
    )

    const parsed = JSON.parse(stdout.join('')) as DoctorOutput
    const lockfileCheck = findCheck(parsed.data.checks, 'lockfile-integrity')
    expect(lockfileCheck?.status).toBe('fail')
    expect(lockfileCheck?.message).toContain('invalid JSON')
  })

  // -------------------------------------------------------------------------
  // Platform unreachable — reports WARN
  // -------------------------------------------------------------------------

  it('reports warning when platform is unreachable', async () => {
    process.argv = ['node', 'agentver', 'doctor', '--json']
    setupHealthyProject()

    vi.mocked(getCredentials).mockResolvedValue({ token: 'valid-token' })
    vi.mocked(getPlatformUrl).mockReturnValue('https://app.agentver.com')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Network error')
      })
    )

    const { stdout } = captureOutput()
    const program = buildProgram()

    await expect(program.parseAsync(['node', 'agentver', 'doctor', '--json'])).rejects.toThrow(
      'process.exit called'
    )

    const parsed = JSON.parse(stdout.join('')) as DoctorOutput
    const authCheck = findCheck(parsed.data.checks, 'authentication')
    expect(authCheck?.status).toBe('warn')
    expect(authCheck?.message).toContain('unreachable')
  })
})
