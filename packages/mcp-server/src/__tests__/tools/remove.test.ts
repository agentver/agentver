import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPackageKey } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../../shared/context', () => ({
  getWorkingDirectory: vi.fn(),
  logDebug: vi.fn(),
}))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import * as contextModule from '../../shared/context'
import { registerRemoveTool } from '../../tools/remove'

// ---------------------------------------------------------------------------
// McpServer stub
// ---------------------------------------------------------------------------

type ToolHandler = (
  args: Record<string, unknown>
) => Promise<{ content: Array<{ type: string; text: string }> }>

function createMockServer(): {
  server: { registerTool: ReturnType<typeof vi.fn> }
  getHandler: () => ToolHandler
} {
  const handlers = new Map<string, ToolHandler>()

  const server = {
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(name, handler)
    }),
  }

  return {
    server,
    getHandler: () => {
      const handler = handlers.get('agentver_remove')
      if (!handler) throw new Error('Remove tool was not registered')
      return handler
    },
  }
}

describe('remove tool', () => {
  let tempDir: string
  let getWorkingDirectoryMock: Mock

  beforeEach(() => {
    vi.clearAllMocks()
    tempDir = join(
      tmpdir(),
      `agentver-remove-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    mkdirSync(tempDir, { recursive: true })
    getWorkingDirectoryMock = contextModule.getWorkingDirectory as unknown as Mock
    getWorkingDirectoryMock.mockReturnValue(tempDir)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('registers the agentver_remove tool on the server', () => {
    const { server } = createMockServer()
    registerRemoveTool(server as never)
    expect(server.registerTool).toHaveBeenCalledWith(
      'agentver_remove',
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('throws NOT_FOUND when the package is not installed', async () => {
    const { server, getHandler } = createMockServer()
    registerRemoveTool(server as never)

    const handler = getHandler()
    await expect(handler({ package: 'org/nonexistent' })).rejects.toThrow('not installed')
  })

  it('removes an installed package and updates manifest and lockfile', async () => {
    const agentverDir = join(tempDir, '.agentver')
    mkdirSync(agentverDir, { recursive: true })
    const packageKey = createPackageKey('org/skill', {
      type: 'git',
      uri: 'https://github.com/org/repo',
      path: 'skills/skill',
      ref: 'v1.0.0',
      commit: 'abc1234def',
    })

    const manifest = {
      version: 2,
      packages: {
        [packageKey]: {
          name: 'org/skill',
          source: {
            type: 'git',
            uri: 'https://github.com/org/repo',
            path: 'skills/skill',
            ref: 'v1.0.0',
            commit: 'abc1234def',
          },
          agents: ['claude-code'],
          installedAt: new Date().toISOString(),
          modified: false,
        },
      },
    }

    const lockfile = {
      version: 2,
      packages: {
        [packageKey]: {
          name: 'org/skill',
          source: {
            type: 'git',
            uri: 'https://github.com/org/repo',
            path: 'skills/skill',
            ref: 'v1.0.0',
            commit: 'abc1234def',
          },
          integrity: 'sha256-abc',
          agents: ['claude-code'],
        },
      },
    }

    writeFileSync(join(agentverDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8')
    writeFileSync(join(agentverDir, 'lockfile.json'), JSON.stringify(lockfile), 'utf-8')

    // Create the skill placement directory for claude-code
    const skillDir = join(tempDir, '.claude', 'skills', 'skill')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '# Skill', 'utf-8')

    const { server, getHandler } = createMockServer()
    registerRemoveTool(server as never)

    const handler = getHandler()
    const result = await handler({ package: 'org/skill' })

    expect(result.content[0]!.text).toContain('Removed org/skill')

    // Verify manifest was updated
    const updatedManifest = JSON.parse(readFileSync(join(agentverDir, 'manifest.json'), 'utf-8'))
    expect(updatedManifest.packages[packageKey]).toBeUndefined()

    // Verify lockfile was updated
    const updatedLockfile = JSON.parse(readFileSync(join(agentverDir, 'lockfile.json'), 'utf-8'))
    expect(updatedLockfile.packages[packageKey]).toBeUndefined()
  })

  it('handles removal when skill directory does not exist on disk', async () => {
    const agentverDir = join(tempDir, '.agentver')
    mkdirSync(agentverDir, { recursive: true })
    const packageKey = createPackageKey('org/skill', {
      type: 'git',
      uri: 'https://github.com/org/repo',
      path: 'skills/skill',
      ref: 'v1.0.0',
      commit: 'abc1234def',
    })

    const manifest = {
      version: 2,
      packages: {
        [packageKey]: {
          name: 'org/skill',
          source: {
            type: 'git',
            uri: 'https://github.com/org/repo',
            path: 'skills/skill',
            ref: 'v1.0.0',
            commit: 'abc1234def',
          },
          agents: ['claude-code'],
          installedAt: new Date().toISOString(),
          modified: false,
        },
      },
    }

    writeFileSync(join(agentverDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8')
    writeFileSync(
      join(agentverDir, 'lockfile.json'),
      JSON.stringify({ version: 2, packages: {} }),
      'utf-8'
    )

    const { server, getHandler } = createMockServer()
    registerRemoveTool(server as never)

    const handler = getHandler()
    const result = await handler({ package: 'org/skill' })

    expect(result.content[0]!.text).toContain('Removed org/skill')
    expect(result.content[0]!.text).toContain('No agent directories required cleanup')
  })
})
