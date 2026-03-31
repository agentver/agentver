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
import { registerUnpublishCommand } from '../../commands/unpublish.js'
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
  registerUnpublishCommand(program)
  return program
}

function captureOutput(): { stderr: string[] } {
  const stderr: string[] = []
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk))
    return true
  })
  return { stderr }
}

function setupIdentity(): void {
  vi.mocked(existsSync).mockReturnValue(true)
  vi.mocked(readFileSync).mockReturnValue(createSkillMd())
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

describe('unpublish command', () => {
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

  it('unpublishes a published version', async () => {
    setupIdentity()
    vi.mocked(platformFetch).mockResolvedValue({
      version: '1.2.3',
      status: 'YANKED',
    })

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'unpublish', '1.2.3'])

    expect(platformFetch).toHaveBeenCalledWith(
      '/skills/@test-org/test-skill/versions/1.2.3/unpublish',
      {
        method: 'POST',
      }
    )
  })

  it('outputs JSON on success', async () => {
    setupIdentity()
    vi.mocked(platformFetch).mockResolvedValue({
      version: '1.2.3',
      status: 'YANKED',
    })

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'unpublish', '1.2.3', '--json'])

    expect(outputModule.outputSuccess).toHaveBeenCalledWith({
      skill: '@test-org/test-skill',
      version: '1.2.3',
      status: 'YANKED',
    })
  })

  it('rejects invalid version strings', async () => {
    const { stderr } = captureOutput()

    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'unpublish', 'latest'])).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
    expect(stderr.join('')).toContain('Invalid semver')
    expect(platformFetch).not.toHaveBeenCalled()
  })

  it('fails cleanly when the skill identity cannot be resolved', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const { stderr } = captureOutput()

    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'unpublish', '1.2.3'])).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
    expect(stderr.join('')).toContain('Could not determine skill identity')
  })
})
