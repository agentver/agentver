import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createLockfile,
  createLockfilePackage,
  createManifest,
  createManifestPackage,
  createSharedGitSource,
} from '../helpers/fixtures'
import { createNoopSpinner } from '../helpers/mock-spinner.js'

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../../storage/manifest', () => ({
  readManifest: vi.fn(),
  writeManifest: vi.fn(),
}))

vi.mock('../../storage/lockfile', () => ({
  readLockfile: vi.fn(),
  writeLockfile: vi.fn(),
}))

vi.mock('../../storage/canonical', () => ({
  getCanonicalSkillPath: vi.fn(),
  createAgentSymlinks: vi.fn(),
  isSymlinkedInstall: vi.fn(),
  removeAgentSymlinks: vi.fn(),
  removeCanonicalDirectory: vi.fn(),
}))

vi.mock('../../registry/reporter.js', () => ({
  reportInstallation: vi.fn(),
  reportRemoval: vi.fn(),
}))

vi.mock('../../output.js', () => ({
  isJSONMode: vi.fn().mockReturnValue(false),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
  createSpinner: vi.fn(),
}))

vi.mock('@agentver/agent-definitions', () => ({
  getSkillPlacementPath: vi.fn(),
  detectInstalledAgents: vi.fn(),
  getConfigFilePath: vi.fn(),
}))

vi.mock('prompts', () => ({
  default: vi.fn().mockResolvedValue({ confirmed: true }),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  lstatSync: vi.fn().mockReturnValue({ isSymbolicLink: () => false, isDirectory: () => true }),
  rmSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  renameSync: vi.fn(),
}))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import { registerRemoveCommand } from '../../commands/remove'

// ---------------------------------------------------------------------------
// Mock module imports
// ---------------------------------------------------------------------------

import * as agentDefs from '@agentver/agent-definitions'
import * as outputModule from '../../output.js'
import * as canonicalModule from '../../storage/canonical'
import * as lockfileModule from '../../storage/lockfile'
import * as manifestModule from '../../storage/manifest'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HOME = homedir()

class ExitError extends Error {
  code: number
  constructor(code: number) {
    super(`process.exit(${code})`)
    this.code = code
  }
}

type RemoveAction = (
  name: string,
  options: { dryRun?: boolean; global?: boolean; yes?: boolean }
) => Promise<void>

function getRemoveAction(): RemoveAction {
  const mockProgram = {
    command: vi.fn().mockReturnThis(),
    alias: vi.fn().mockReturnThis(),
    description: vi.fn().mockReturnThis(),
    option: vi.fn().mockReturnThis(),
    action: vi.fn().mockReturnThis(),
  }

  registerRemoveCommand(mockProgram as never)

  return mockProgram.action.mock.calls[0]![0] as RemoveAction
}

function setupInstalledPackage(
  name: string,
  options: { scope: 'project' | 'global'; agents?: string[] } = { scope: 'project' }
) {
  const agents = options.agents ?? ['claude-code']
  const source = createSharedGitSource()
  const manifest = createManifest({
    packages: {
      [name]: createManifestPackage({ source, agents }),
    },
  })
  const lockfile = createLockfile({
    packages: {
      [name]: createLockfilePackage({ source, agents }),
    },
  })

  vi.mocked(manifestModule.readManifest).mockReturnValue(manifest)
  vi.mocked(lockfileModule.readLockfile).mockReturnValue(lockfile)
  vi.mocked(canonicalModule.isSymlinkedInstall).mockReturnValue(true)

  const basePath =
    options.scope === 'global'
      ? join(HOME, `.agents/skills/${name}`)
      : `/project/.agents/skills/${name}`

  vi.mocked(canonicalModule.getCanonicalSkillPath).mockReturnValue(basePath)
  vi.mocked(agentDefs.getSkillPlacementPath).mockImplementation(
    (id: string, skillName: string) => `.${id}/skills/${skillName}`
  )

  return { manifest, lockfile }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('global scope — remove command', () => {
  const originalCwd = process.cwd
  const originalArgv = process.argv
  const originalExit = process.exit

  let removeAction: RemoveAction

  beforeEach(() => {
    vi.clearAllMocks()

    process.cwd = vi.fn().mockReturnValue('/project')
    process.argv = ['node', 'agentver', 'remove']
    process.exit = vi.fn().mockImplementation((code: number) => {
      throw new ExitError(code)
    }) as never

    vi.mocked(outputModule.createSpinner).mockReturnValue(createNoopSpinner() as unknown as ReturnType<typeof outputModule.createSpinner>)
    vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

    removeAction = getRemoveAction()
  })

  afterEach(() => {
    process.cwd = originalCwd
    process.argv = originalArgv
    process.exit = originalExit
  })

  // -------------------------------------------------------------------------
  // --global passes scope to manifest/lockfile
  // -------------------------------------------------------------------------

  it('passes global scope to readManifest', async () => {
    setupInstalledPackage('my-skill', { scope: 'global' })

    await removeAction('my-skill', { global: true })

    expect(manifestModule.readManifest).toHaveBeenCalledWith('/project', 'global')
  })

  it('passes global scope to writeManifest', async () => {
    setupInstalledPackage('my-skill', { scope: 'global' })

    await removeAction('my-skill', { global: true })

    expect(manifestModule.writeManifest).toHaveBeenCalledWith(
      '/project',
      expect.objectContaining({ version: 2 }),
      'global'
    )
  })

  it('passes global scope to readLockfile and writeLockfile', async () => {
    setupInstalledPackage('my-skill', { scope: 'global' })

    await removeAction('my-skill', { global: true })

    expect(lockfileModule.readLockfile).toHaveBeenCalledWith('/project', 'global')
    expect(lockfileModule.writeLockfile).toHaveBeenCalledWith(
      '/project',
      expect.any(Object),
      'global'
    )
  })

  // -------------------------------------------------------------------------
  // Default (project) scope
  // -------------------------------------------------------------------------

  it('uses project scope by default (no --global)', async () => {
    setupInstalledPackage('my-skill', { scope: 'project' })

    await removeAction('my-skill', {})

    expect(manifestModule.readManifest).toHaveBeenCalledWith('/project', 'project')
    expect(manifestModule.writeManifest).toHaveBeenCalledWith(
      '/project',
      expect.any(Object),
      'project'
    )
    expect(lockfileModule.readLockfile).toHaveBeenCalledWith('/project', 'project')
    expect(lockfileModule.writeLockfile).toHaveBeenCalledWith(
      '/project',
      expect.any(Object),
      'project'
    )
  })

  // -------------------------------------------------------------------------
  // Scope independence
  // -------------------------------------------------------------------------

  it('global remove does not interact with project scope', async () => {
    setupInstalledPackage('my-skill', { scope: 'global' })

    await removeAction('my-skill', { global: true })

    const manifestReadCalls = vi.mocked(manifestModule.readManifest).mock.calls
    const manifestWriteCalls = vi.mocked(manifestModule.writeManifest).mock.calls
    const lockfileReadCalls = vi.mocked(lockfileModule.readLockfile).mock.calls
    const lockfileWriteCalls = vi.mocked(lockfileModule.writeLockfile).mock.calls

    for (const call of manifestReadCalls) {
      expect(call[1]).toBe('global')
    }
    for (const call of manifestWriteCalls) {
      expect(call[2]).toBe('global')
    }
    for (const call of lockfileReadCalls) {
      expect(call[1]).toBe('global')
    }
    for (const call of lockfileWriteCalls) {
      expect(call[2]).toBe('global')
    }
  })

  it('project remove does not interact with global scope', async () => {
    setupInstalledPackage('my-skill', { scope: 'project' })

    await removeAction('my-skill', {})

    const manifestReadCalls = vi.mocked(manifestModule.readManifest).mock.calls
    const manifestWriteCalls = vi.mocked(manifestModule.writeManifest).mock.calls
    const lockfileReadCalls = vi.mocked(lockfileModule.readLockfile).mock.calls
    const lockfileWriteCalls = vi.mocked(lockfileModule.writeLockfile).mock.calls

    for (const call of manifestReadCalls) {
      expect(call[1]).toBe('project')
    }
    for (const call of manifestWriteCalls) {
      expect(call[2]).toBe('project')
    }
    for (const call of lockfileReadCalls) {
      expect(call[1]).toBe('project')
    }
    for (const call of lockfileWriteCalls) {
      expect(call[2]).toBe('project')
    }
  })
})
