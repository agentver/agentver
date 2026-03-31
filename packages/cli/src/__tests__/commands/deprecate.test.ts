import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}))

vi.mock('../../registry/platform.js', () => ({
  platformFetch: vi.fn(),
}))

vi.mock('../../storage/manifest.js', () => ({
  readManifest: vi.fn(),
}))

vi.mock('chalk', () => {
  const identity = (s: string) => s
  const fn = Object.assign(identity, {
    red: identity,
    green: identity,
    cyan: identity,
    dim: identity,
  })
  return { default: fn }
})

vi.mock('../../output.js', () => ({
  isJSONMode: vi.fn().mockReturnValue(false),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
  createSpinner: vi.fn(),
}))

import { existsSync, readFileSync } from 'node:fs'
import { Command } from 'commander'
import { registerDeprecateCommand } from '../../commands/deprecate.js'
import * as outputModule from '../../output.js'
import { platformFetch } from '../../registry/platform.js'
import { readManifest } from '../../storage/manifest.js'
import {
  createManifest,
  createManifestPackage,
  createSharedGitSource,
  createSkillMd,
} from '../helpers/fixtures'
import { createNoopSpinner } from '../helpers/mock-spinner.js'

function buildProgram(): Command {
  const program = new Command()
  program.exitOverride()
  registerDeprecateCommand(program)
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

function setupIdentity(): void {
  vi.mocked(existsSync).mockReturnValue(true)
  vi.mocked(readFileSync).mockReturnValue(
    createSkillMd({
      name: 'test-skill',
      description: 'A test skill',
      version: '1.0.0',
    })
  )
  vi.mocked(readManifest).mockReturnValue(
    createManifest({
      packages: {
        'test-skill': createManifestPackage({
          source: createSharedGitSource({
            uri: 'agentver://test-org',
          }),
        }),
      },
    })
  )
}

describe('deprecate command', () => {
  let processExitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as never)
    vi.mocked(outputModule.createSpinner).mockReturnValue(
      createNoopSpinner() as unknown as ReturnType<typeof outputModule.createSpinner>
    )
    vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('deprecates the current skill package', async () => {
    setupIdentity()
    vi.mocked(platformFetch).mockResolvedValue({
      status: 'DEPRECATED',
      message: 'Use @test-org/new-skill instead',
    })

    const { stdout } = captureOutput()
    const program = buildProgram()
    await program.parseAsync([
      'node',
      'agentver',
      'deprecate',
      '--message',
      'Use @test-org/new-skill instead',
    ])

    expect(platformFetch).toHaveBeenCalledWith('/skills/@test-org/test-skill/deprecate', {
      method: 'POST',
      body: { message: 'Use @test-org/new-skill instead' },
    })
    expect(stdout.join('')).toContain('Use @test-org/new-skill instead')
  })

  it('deprecates a published version', async () => {
    setupIdentity()
    vi.mocked(platformFetch).mockResolvedValue({
      version: '1.2.3',
      status: 'DEPRECATED',
      message: 'Superseded by 2.0.0',
    })

    const program = buildProgram()
    await program.parseAsync([
      'node',
      'agentver',
      'deprecate',
      '1.2.3',
      '--message',
      'Superseded by 2.0.0',
    ])

    expect(platformFetch).toHaveBeenCalledWith(
      '/skills/@test-org/test-skill/versions/1.2.3/deprecate',
      {
        method: 'POST',
        body: { message: 'Superseded by 2.0.0' },
      }
    )
  })

  it('outputs JSON for package deprecation', async () => {
    setupIdentity()
    vi.mocked(platformFetch).mockResolvedValue({
      status: 'DEPRECATED',
      message: 'Deprecated',
    })

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'deprecate', '--json'])

    expect(outputModule.outputSuccess).toHaveBeenCalledWith({
      skill: '@test-org/test-skill',
      target: 'package',
      status: 'DEPRECATED',
      message: 'Deprecated',
    })
  })

  it('outputs DEPRECATE_FAILED in JSON mode when the platform request fails', async () => {
    setupIdentity()
    vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
    vi.mocked(platformFetch).mockRejectedValue(new Error('platform offline'))

    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'deprecate', '--json'])).rejects.toThrow()

    expect(outputModule.outputError).toHaveBeenCalledWith('DEPRECATE_FAILED', 'platform offline')
    expect(processExitSpy).toHaveBeenCalledWith(1)
  })

  it('rejects invalid version strings', async () => {
    const { stderr } = captureOutput()

    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'deprecate', 'latest'])).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
    expect(stderr.join('')).toContain('Invalid semver')
    expect(platformFetch).not.toHaveBeenCalled()
  })

  it('fails cleanly when the skill identity cannot be resolved', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const { stderr } = captureOutput()

    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'deprecate'])).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
    expect(stderr.join('')).toContain('Could not determine skill identity')
  })
})
