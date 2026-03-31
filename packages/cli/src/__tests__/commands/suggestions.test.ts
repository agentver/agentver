import { createCLIOutputSchema, proposalsResultSchema } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCredentials } from '../helpers/fixtures'
import type { PlatformMockHandle } from '../helpers/mock-platform'
import { mockFetchResponse, setupPlatformMock } from '../helpers/mock-platform'
import { createNoopSpinner } from '../helpers/mock-spinner.js'

vi.mock('../../registry/auth.js', () => ({
  getCredentials: vi.fn(),
  isAuthenticated: vi.fn(),
}))

vi.mock('../../registry/config.js', () => ({
  getPlatformUrl: vi.fn(),
  readConfig: vi.fn(),
}))

vi.mock('../../output.js', () => ({
  isJSONMode: vi.fn().mockReturnValue(false),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
  createSpinner: vi.fn(),
}))

import { Command } from 'commander'
import { registerSuggestionsCommand } from '../../commands/suggestions'
import * as outputModule from '../../output.js'
import * as authModule from '../../registry/auth.js'
import * as configModule from '../../registry/config.js'

function createSuggestionsProgram(): Command {
  const program = new Command()
  program.exitOverride()
  registerSuggestionsCommand(program)
  return program
}

async function runSuggestions(args: string[]): Promise<void> {
  const program = createSuggestionsProgram()
  await program.parseAsync(['node', 'agentver', ...args])
}

describe('commands/suggestions', () => {
  const originalCwd = process.cwd
  const originalArgv = process.argv
  const originalExit = process.exit
  let platformMock: PlatformMockHandle

  beforeEach(() => {
    vi.clearAllMocks()
    process.cwd = vi.fn().mockReturnValue('/project')
    process.argv = ['node', 'agentver', 'suggestions']
    process.exit = vi.fn() as never

    vi.mocked(outputModule.createSpinner).mockReturnValue(
      createNoopSpinner() as unknown as ReturnType<typeof outputModule.createSpinner>
    )
    vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

    platformMock = setupPlatformMock()
  })

  afterEach(() => {
    process.cwd = originalCwd
    process.argv = originalArgv
    process.exit = originalExit
    vi.unstubAllGlobals()
  })

  it('lists suggestions with status from platform', async () => {
    vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())

    platformMock.addRoute({
      method: 'GET',
      path: /\/proposals/,
      handler: () =>
        mockFetchResponse(200, {
          suggestions: [
            {
              id: 'sug-1',
              title: 'Fix typo',
              packageSlug: 'my-skill',
              status: 'OPEN',
              author: 'testuser',
              createdAt: '2025-01-15T10:30:00.000Z',
            },
          ],
        }),
    })

    vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
    process.argv = ['node', 'agentver', 'suggestions', '--json']

    await runSuggestions(['suggestions'])

    expect(outputModule.outputSuccess).toHaveBeenCalled()
    const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
    const typed = data as { proposals: Array<Record<string, unknown>> }
    expect(typed.proposals).toHaveLength(1)
    expect(typed.proposals[0]!.id).toBe('sug-1')
    expect(typed.proposals[0]!.status).toBe('OPEN')
  })

  it('passes the status filter to the platform query', async () => {
    vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())

    let capturedUrl = ''
    platformMock.addRoute({
      method: 'GET',
      path: /\/proposals/,
      handler: (url) => {
        capturedUrl = url
        return mockFetchResponse(200, { suggestions: [] })
      },
    })

    vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
    process.argv = ['node', 'agentver', 'suggestions', '--json']

    await runSuggestions(['suggestions', '--status', 'merged'])

    expect(capturedUrl).toContain('status=MERGED')
  })

  it('returns an empty proposals array when no suggestions are found', async () => {
    vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())

    platformMock.addRoute({
      method: 'GET',
      path: /\/proposals/,
      handler: () => mockFetchResponse(200, { suggestions: [] }),
    })

    vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
    process.argv = ['node', 'agentver', 'suggestions', '--json']

    await runSuggestions(['suggestions'])

    expect(outputModule.outputSuccess).toHaveBeenCalled()
    const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
    const typed = data as { proposals: unknown[] }
    expect(typed.proposals).toHaveLength(0)
  })

  it('validates JSON output against proposalsResultSchema', async () => {
    vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())

    platformMock.addRoute({
      method: 'GET',
      path: /\/proposals/,
      handler: () =>
        mockFetchResponse(200, {
          suggestions: [
            {
              id: 'sug-2',
              title: 'Add example',
              packageSlug: 'other-skill',
              status: 'MERGED',
              author: 'testuser',
              createdAt: '2025-02-01T12:00:00.000Z',
            },
          ],
        }),
    })

    vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
    process.argv = ['node', 'agentver', 'suggestions', '--json']

    await runSuggestions(['suggestions'])

    expect(outputModule.outputSuccess).toHaveBeenCalled()
    const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
    const envelope = { success: true, data }
    const outputSchema = createCLIOutputSchema(proposalsResultSchema)
    const result = outputSchema.safeParse(envelope)
    expect(result.success).toBe(true)
  })

  it('outputs AUTH_REQUIRED when not connected', async () => {
    vi.mocked(configModule.getPlatformUrl).mockReturnValue(null)
    vi.mocked(authModule.getCredentials).mockResolvedValue(null)

    vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
    process.argv = ['node', 'agentver', 'suggestions', '--json']

    await runSuggestions(['suggestions'])

    expect(outputModule.outputError).toHaveBeenCalledWith(
      'AUTH_REQUIRED',
      expect.stringContaining('Not connected')
    )
    expect(process.exit).toHaveBeenCalledWith(1)
  })

  it('outputs FETCH_FAILED when the platform request fails', async () => {
    vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())

    platformMock.addRoute({
      method: 'GET',
      path: /\/proposals/,
      handler: () => mockFetchResponse(500, 'Internal server error'),
    })

    vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
    process.argv = ['node', 'agentver', 'suggestions', '--json']

    await runSuggestions(['suggestions'])

    expect(outputModule.outputError).toHaveBeenCalledWith(
      'FETCH_FAILED',
      expect.stringContaining('500')
    )
    expect(process.exit).toHaveBeenCalledWith(1)
  })

  it('omits the status filter when --status is all', async () => {
    vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())

    let capturedUrl = ''
    platformMock.addRoute({
      method: 'GET',
      path: /\/proposals/,
      handler: (url) => {
        capturedUrl = url
        return mockFetchResponse(200, { suggestions: [] })
      },
    })

    vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
    process.argv = ['node', 'agentver', 'suggestions', '--json']

    await runSuggestions(['suggestions', '--status', 'all'])

    expect(capturedUrl).not.toContain('status=')
  })

  it('sends the package filter when a name argument is provided', async () => {
    vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
    vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())

    let capturedUrl = ''
    platformMock.addRoute({
      method: 'GET',
      path: /\/proposals/,
      handler: (url) => {
        capturedUrl = url
        return mockFetchResponse(200, { suggestions: [] })
      },
    })

    vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
    process.argv = ['node', 'agentver', 'suggestions', '--json']

    await runSuggestions(['suggestions', 'my-skill'])

    expect(capturedUrl).toContain('package=my-skill')
  })
})
