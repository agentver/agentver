import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSkillMd } from '../helpers/fixtures'
import { cleanupTempDir, createTempDir, readProjectState } from '../helpers/mock-fs'
import { createNoopSpinner } from '../helpers/mock-spinner.js'

vi.mock('../../git/index.js', () => ({
  parseGitSource: vi.fn(),
  resolveRef: vi.fn(),
  fetchFiles: vi.fn(),
}))

vi.mock('../../security/index.js', () => ({
  scanFiles: vi.fn(),
  renderScanResult: vi.fn(),
  SCAN_RULES: [],
}))

vi.mock('../../registry/auth.js', () => ({
  getCredentials: vi.fn().mockResolvedValue(null),
  isAuthenticated: vi.fn().mockReturnValue(false),
}))

vi.mock('../../registry/config.js', () => ({
  readConfig: vi.fn().mockReturnValue({}),
  getPlatformUrl: vi.fn().mockReturnValue(null),
}))

vi.mock('../../registry/reporter.js', () => ({
  reportInstallation: vi.fn(),
  reportRemoval: vi.fn(),
}))

vi.mock('../../wellknown/index.js', () => ({
  looksLikeWellKnownUrl: vi.fn().mockReturnValue(false),
  parseWellKnownSource: vi.fn(),
  fetchWellKnownIndex: vi.fn(),
  fetchWellKnownSkill: vi.fn(),
}))

vi.mock('../../output.js', () => ({
  isJSONMode: vi.fn().mockReturnValue(false),
  isQuiet: vi.fn().mockReturnValue(false),
  isVerbose: vi.fn().mockReturnValue(false),
  getLogLevel: vi.fn().mockReturnValue(4),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
  createSpinner: vi.fn(),
}))

vi.mock('prompts', () => ({
  default: vi.fn().mockResolvedValue({ confirmed: true, proceed: true, action: 'replace' }),
}))

import { installPackage } from '../../commands/install'
import { registerRemoveCommand } from '../../commands/remove'
import { registerUpdateCommand } from '../../commands/update'
import * as gitIndex from '../../git/index.js'
import type { FetchResult, ResolvedRef } from '../../git/types'
import * as outputModule from '../../output.js'
import * as securityModule from '../../security/index.js'

type UpdateAction = (
  name: string | undefined,
  options: { dryRun?: boolean; global?: boolean; yes?: boolean }
) => Promise<void>

type RemoveAction = (
  name: string,
  options: { dryRun?: boolean; global?: boolean; yes?: boolean }
) => Promise<void>

function getUpdateAction(): UpdateAction {
  const program = {
    command: vi.fn().mockReturnThis(),
    description: vi.fn().mockReturnThis(),
    option: vi.fn().mockReturnThis(),
    action: vi.fn().mockReturnThis(),
  }

  registerUpdateCommand(program as never)

  return program.action.mock.calls[0]![0] as UpdateAction
}

function getRemoveAction(): RemoveAction {
  const program = {
    command: vi.fn().mockReturnThis(),
    alias: vi.fn().mockReturnThis(),
    description: vi.fn().mockReturnThis(),
    option: vi.fn().mockReturnThis(),
    action: vi.fn().mockReturnThis(),
  }

  registerRemoveCommand(program as never)

  return program.action.mock.calls[0]![0] as RemoveAction
}

const INITIAL_SHA = '1111111111111111111111111111111111111111'
const UPDATED_SHA = '2222222222222222222222222222222222222222'

let tempDir: string
let originalCwd: string

function setGitState(commitSha: string, skillContent: string): void {
  const source = {
    host: 'github.com',
    owner: 'test-owner',
    repo: 'test-repo',
    path: '',
    ref: 'main',
  }

  const files = [{ path: 'SKILL.md', content: skillContent, size: skillContent.length }]
  const resolved: ResolvedRef = { source, commitSha }
  const fetchResult: FetchResult = { files, commitSha, source }

  vi.mocked(gitIndex.parseGitSource).mockReturnValue(source)
  vi.mocked(gitIndex.resolveRef).mockResolvedValue(resolved)
  vi.mocked(gitIndex.fetchFiles).mockResolvedValue(fetchResult)
}

beforeEach(() => {
  tempDir = createTempDir()
  originalCwd = process.cwd()
  process.chdir(tempDir)

  mkdirSync(join(tempDir, '.claude'), { recursive: true })

  vi.mocked(outputModule.createSpinner).mockReturnValue(
    createNoopSpinner() as unknown as ReturnType<typeof outputModule.createSpinner>
  )
  vi.mocked(securityModule.scanFiles).mockResolvedValue({
    verdict: 'PASS',
    findings: [],
    scannedAt: new Date().toISOString(),
    duration: 1,
    provider: 'built-in',
  })
})

afterEach(() => {
  process.chdir(originalCwd)
  cleanupTempDir(tempDir)
  vi.restoreAllMocks()
})

describe('E2E: install -> update -> remove lifecycle', () => {
  it('preserves a coherent filesystem and metadata state across the full lifecycle', async () => {
    const initialContent = createSkillMd({ version: '1.0.0' })
    const updatedContent = createSkillMd({ version: '2.0.0', description: 'Updated skill' })

    setGitState(INITIAL_SHA, initialContent)

    await installPackage('github.com/test-owner/test-repo', { skipAudit: true })

    const initialState = readProjectState(tempDir)
    expect(initialState.manifest?.packages['test-repo']).toBeDefined()
    expect(initialState.lockfile?.packages['test-repo']).toBeDefined()
    expect(readFileSync(join(tempDir, '.agents/skills/test-repo/SKILL.md'), 'utf-8')).toBe(
      initialContent
    )

    setGitState(UPDATED_SHA, updatedContent)

    const updateAction = getUpdateAction()
    await updateAction(undefined, { yes: true })

    const updatedState = readProjectState(tempDir)
    const updatedPackage = updatedState.manifest?.packages['test-repo']
    expect(updatedPackage?.source.type).toBe('git')
    if (updatedPackage?.source.type === 'git') {
      expect(updatedPackage.source.commit).toBe(UPDATED_SHA)
    }
    expect(readFileSync(join(tempDir, '.agents/skills/test-repo/SKILL.md'), 'utf-8')).toBe(
      updatedContent
    )

    const removeAction = getRemoveAction()
    await removeAction('test-repo', { yes: true })

    const finalState = readProjectState(tempDir)
    expect(finalState.manifest?.packages ?? {}).toEqual({})
    expect(finalState.lockfile?.packages ?? {}).toEqual({})
    expect(finalState.skills).toHaveLength(0)
    expect(finalState.symlinks).toHaveLength(0)
  })
})
