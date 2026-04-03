/**
 * Canonical user journey E2E test — exercises the full lifecycle of a skill
 * from init through to removal, with real filesystem operations.
 *
 * Steps:
 *   1.  init (skill) — verify SKILL.md created with correct frontmatter
 *   2.  validate — verify the init output passes validation
 *   3.  install (from git, mocked) — verify disk state
 *   4.  list --json — verify installed skill appears
 *   5.  status --offline — verify up-to-date
 *   6.  Modify installed skill on disk
 *   7.  status --offline — verify locally modified
 *   8.  diff (in-process, mocked upstream) — verify shows modification
 *   9.  update (in-process, mocked new upstream) — verify files updated
 *   10. list --json — still shows skill
 *   11. remove — verify clean removal
 *   12. list --json — empty
 *   13. doctor — all local checks passing
 *
 * Git/network layer is mocked; filesystem is real (temp directories).
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  type DiffResult,
  type DoctorResult,
  diffResultSchema,
  doctorResultSchema,
  type ListResult,
  listResultSchema,
  lockfileV2Schema,
  manifestV2Schema,
  type StatusResult,
  statusResultSchema,
} from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGitSource, createSkillMd } from '../helpers/fixtures'
import { cleanupTempDir, createTempDir, readProjectState } from '../helpers/mock-fs'
import { createNoopSpinner } from '../helpers/mock-spinner.js'
import { runCliJson } from './helpers'

// ---------------------------------------------------------------------------
// Mock only git/network layer — keep real filesystem
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SUT imports (after mocks)
// ---------------------------------------------------------------------------

import { registerDiffCommand } from '../../commands/diff'
import { installPackage } from '../../commands/install'
import { registerRemoveCommand } from '../../commands/remove'
import { registerUpdateCommand } from '../../commands/update'
import * as gitIndex from '../../git/index.js'
import type { FetchResult, ResolvedRef } from '../../git/types'
import * as outputModule from '../../output.js'
import * as securityModule from '../../security/index.js'

// ---------------------------------------------------------------------------
// Action extractors — pull the handler out of a Commander registration
// ---------------------------------------------------------------------------

type UpdateAction = (
  name: string | undefined,
  options: { dryRun?: boolean; global?: boolean; yes?: boolean }
) => Promise<void>

type RemoveAction = (
  name: string,
  options: { dryRun?: boolean; global?: boolean; yes?: boolean }
) => Promise<void>

type DiffAction = (name: string, options: { global?: boolean }) => Promise<void>

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

function getDiffAction(): DiffAction {
  const program = {
    command: vi.fn().mockReturnThis(),
    description: vi.fn().mockReturnThis(),
    option: vi.fn().mockReturnThis(),
    action: vi.fn().mockReturnThis(),
  }

  registerDiffCommand(program as never)

  return program.action.mock.calls[0]![0] as DiffAction
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_SHA = 'aaa1111111111111111111111111111111111111'
const UPDATED_SHA = 'bbb2222222222222222222222222222222222222'

const INITIAL_CONTENT = createSkillMd({
  name: 'journey-skill',
  description: 'A skill for the canonical journey test',
  version: '1.0.0',
})

const UPDATED_CONTENT = createSkillMd({
  name: 'journey-skill',
  description: 'Updated skill for the canonical journey test',
  version: '2.0.0',
})

// ---------------------------------------------------------------------------
// Git mock helper
// ---------------------------------------------------------------------------

function setGitState(commitSha: string, skillContent: string): void {
  const source = createGitSource({
    host: 'github.com',
    owner: 'journey-org',
    repo: 'journey-repo',
    path: '',
    ref: 'main',
  })

  const files = [{ path: 'SKILL.md', content: skillContent, size: skillContent.length }]
  const resolved: ResolvedRef = { source, commitSha }
  const fetchResult: FetchResult = { files, commitSha, source }

  vi.mocked(gitIndex.parseGitSource).mockReturnValue(source)
  vi.mocked(gitIndex.resolveRef).mockResolvedValue(resolved)
  vi.mocked(gitIndex.fetchFiles).mockResolvedValue(fetchResult)
}

// ---------------------------------------------------------------------------
// JSON output types for CLI binary calls
// ---------------------------------------------------------------------------

type InitResult = {
  name: string
  type: string
  path: string
  files: string[]
}

type ValidateResult = {
  path: string
  valid: boolean
  specCompliant: boolean
  errors: string[]
  warnings: string[]
  agentverExtensions: string[]
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tempDir: string

beforeEach(() => {
  tempDir = createTempDir()
  vi.spyOn(process, 'cwd').mockReturnValue(tempDir)

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
  vi.restoreAllMocks()
  cleanupTempDir(tempDir)
})

// ---------------------------------------------------------------------------
// Canonical journey
// ---------------------------------------------------------------------------

describe('E2E: canonical user journey', () => {
  it('exercises the full skill lifecycle: init -> validate -> install -> list -> status -> modify -> status -> diff -> update -> list -> remove -> list -> doctor', async () => {
    // -----------------------------------------------------------------
    // Step 1: init — scaffold a new skill project
    // -----------------------------------------------------------------
    const {
      data: initData,
      exitCode: initExit,
      success: initSuccess,
    } = await runCliJson<InitResult>(
      [
        'init',
        '--name',
        'journey-skill',
        '--description',
        'A skill for the canonical journey test',
        '--json',
      ],
      { cwd: tempDir }
    )

    expect(initExit).toBe(0)
    expect(initSuccess).toBe(true)
    expect(initData.name).toBe('journey-skill')
    expect(initData.type).toBe('skill')
    expect(initData.files).toContain('SKILL.md')

    const initSkillMdPath = join(tempDir, 'journey-skill', 'SKILL.md')
    expect(existsSync(initSkillMdPath)).toBe(true)

    const initContent = readFileSync(initSkillMdPath, 'utf-8')
    expect(initContent).toContain('name: journey-skill')
    expect(initContent).toContain('description: A skill for the canonical journey test')
    expect(initContent).toContain('version: 0.1.0')

    // Verify frontmatter delimiters present
    const frontmatterDelimiters = initContent.match(/^---/gm)
    expect(frontmatterDelimiters).not.toBeNull()
    expect(frontmatterDelimiters!.length).toBeGreaterThanOrEqual(2)

    // -----------------------------------------------------------------
    // Step 2: validate — verify the scaffolded SKILL.md passes validation
    // -----------------------------------------------------------------
    const {
      data: validateData,
      exitCode: validateExit,
      success: validateSuccess,
    } = await runCliJson<ValidateResult>(['validate', '--json'], {
      cwd: join(tempDir, 'journey-skill'),
    })

    expect(validateExit).toBe(0)
    expect(validateSuccess).toBe(true)
    expect(validateData.valid).toBe(true)
    expect(validateData.errors).toHaveLength(0)

    // -----------------------------------------------------------------
    // Step 3: install — install a git-sourced skill (mocked git layer)
    // -----------------------------------------------------------------
    setGitState(INITIAL_SHA, INITIAL_CONTENT)

    const installResult = await installPackage('github.com/journey-org/journey-repo', {
      skipAudit: true,
    })

    expect(installResult.name).toBe('journey-repo')
    expect(installResult.agents).toContain('claude-code')

    // Verify canonical directory
    const canonicalPath = join(tempDir, '.agents/skills/journey-repo')
    expect(existsSync(canonicalPath)).toBe(true)

    const installedSkillMdPath = join(canonicalPath, 'SKILL.md')
    expect(existsSync(installedSkillMdPath)).toBe(true)
    expect(readFileSync(installedSkillMdPath, 'utf-8')).toBe(INITIAL_CONTENT)

    // Verify agent symlink is relative
    const symlinkPath = join(tempDir, '.claude/skills/journey-repo')
    expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true)
    const symlinkTarget = readlinkSync(symlinkPath)
    expect(symlinkTarget.startsWith('/')).toBe(false)
    expect(symlinkTarget).toContain('.agents/skills/journey-repo')

    // Validate manifest against Zod schema
    const manifestPath = join(tempDir, '.agentver/manifest.json')
    expect(existsSync(manifestPath)).toBe(true)
    const manifestRaw = readFileSync(manifestPath, 'utf-8')
    const manifestParsed = manifestV2Schema.safeParse(JSON.parse(manifestRaw) as unknown)
    expect(manifestParsed.success).toBe(true)
    if (manifestParsed.success) {
      const pkgEntries = Object.entries(manifestParsed.data.packages)
      expect(pkgEntries).toHaveLength(1)
      expect(pkgEntries[0]![1].agents).toContain('claude-code')
    }

    // Validate lockfile against Zod schema
    const lockfilePath = join(tempDir, '.agentver/lockfile.json')
    expect(existsSync(lockfilePath)).toBe(true)
    const lockfileRaw = readFileSync(lockfilePath, 'utf-8')
    const lockfileParsed = lockfileV2Schema.safeParse(JSON.parse(lockfileRaw) as unknown)
    expect(lockfileParsed.success).toBe(true)
    if (lockfileParsed.success) {
      const lockEntries = Object.values(lockfileParsed.data.packages)
      expect(lockEntries).toHaveLength(1)
      expect(lockEntries[0]!.integrity).toMatch(/^sha256-/)
    }

    // -----------------------------------------------------------------
    // Step 4: list --json — verify the installed skill appears
    // -----------------------------------------------------------------
    const {
      data: listData1,
      exitCode: listExit1,
      success: listSuccess1,
    } = await runCliJson<ListResult>(['list', '--json'], { cwd: tempDir })

    expect(listExit1).toBe(0)
    expect(listSuccess1).toBe(true)

    // Validate against shared schema
    const listParsed1 = listResultSchema.safeParse(listData1)
    expect(listParsed1.success).toBe(true)

    expect(listData1.packages).toHaveLength(1)
    expect(listData1.packages[0]!.name).toContain('journey-repo')
    expect(listData1.packages[0]!.scope).toBe('project')
    expect(listData1.packages[0]!.package.agents).toContain('claude-code')

    // -----------------------------------------------------------------
    // Step 5: status --offline — verify up-to-date
    // -----------------------------------------------------------------
    const { data: statusData1, exitCode: statusExit1 } = await runCliJson<StatusResult>(
      ['status', '--offline', '--json'],
      { cwd: tempDir }
    )

    expect(statusExit1).toBe(0)

    const statusParsed1 = statusResultSchema.safeParse(statusData1)
    expect(statusParsed1.success).toBe(true)

    expect(statusData1.packages).toHaveLength(1)
    expect(statusData1.packages[0]!.status).toBe('up-to-date')
    expect(statusData1.packages[0]!.modified).toBe(false)
    expect(statusData1.summary.total).toBe(1)
    expect(statusData1.summary.upToDate).toBe(1)
    expect(statusData1.summary.modified).toBe(0)

    // -----------------------------------------------------------------
    // Step 6: Modify the installed skill file on disk
    // -----------------------------------------------------------------
    const modifiedContent = INITIAL_CONTENT.replace(
      'This is a test skill used for unit testing.',
      'This skill has been locally modified for the journey test.'
    )
    writeFileSync(installedSkillMdPath, modifiedContent)

    // -----------------------------------------------------------------
    // Step 7: status --offline — verify locally modified
    // -----------------------------------------------------------------
    const { data: statusData2, exitCode: statusExit2 } = await runCliJson<StatusResult>(
      ['status', '--offline', '--json'],
      { cwd: tempDir }
    )

    expect(statusExit2).toBe(0)

    const statusParsed2 = statusResultSchema.safeParse(statusData2)
    expect(statusParsed2.success).toBe(true)

    expect(statusData2.packages).toHaveLength(1)
    expect(statusData2.packages[0]!.status).toBe('modified')
    expect(statusData2.packages[0]!.modified).toBe(true)
    expect(statusData2.summary.modified).toBe(1)
    expect(statusData2.summary.upToDate).toBe(0)

    // -----------------------------------------------------------------
    // Step 8: diff (in-process) — verify shows the modification
    // -----------------------------------------------------------------
    // Configure mocked output to capture the diff result
    vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

    let capturedDiffResult: DiffResult | null = null
    vi.mocked(outputModule.outputSuccess).mockImplementation((data: unknown) => {
      capturedDiffResult = data as DiffResult
    })

    // Mock fetchFiles to return the ORIGINAL content (upstream)
    setGitState(INITIAL_SHA, INITIAL_CONTENT)

    const diffAction = getDiffAction()
    await diffAction('journey-repo', {})

    expect(capturedDiffResult).not.toBeNull()
    const diffParsed = diffResultSchema.safeParse(capturedDiffResult)
    expect(diffParsed.success).toBe(true)

    expect(capturedDiffResult!.name).toContain('journey-repo')
    expect(capturedDiffResult!.hunks.length).toBeGreaterThan(0)

    // The diff should contain lines showing the modification
    const diffContent = capturedDiffResult!.hunks.map((h) => h.content).join('\n')
    expect(diffContent).toContain('locally modified for the journey test')

    // Reset output mock
    vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
    vi.mocked(outputModule.outputSuccess).mockReset()

    // -----------------------------------------------------------------
    // Step 9: update (in-process) — update to new upstream version
    // -----------------------------------------------------------------
    // Set upstream to a new commit with updated content
    setGitState(UPDATED_SHA, UPDATED_CONTENT)

    const updateAction = getUpdateAction()
    await updateAction(undefined, { yes: true })

    // Verify the file was updated on disk
    const updatedFileContent = readFileSync(installedSkillMdPath, 'utf-8')
    expect(updatedFileContent).toBe(UPDATED_CONTENT)
    expect(updatedFileContent).toContain('version: 2.0.0')
    expect(updatedFileContent).toContain('Updated skill for the canonical journey test')

    // Verify manifest was updated with new commit
    const updatedManifestRaw = readFileSync(manifestPath, 'utf-8')
    const updatedManifest = manifestV2Schema.safeParse(JSON.parse(updatedManifestRaw) as unknown)
    expect(updatedManifest.success).toBe(true)
    if (updatedManifest.success) {
      const updatedPkg = Object.values(updatedManifest.data.packages)[0]
      expect(updatedPkg).toBeDefined()
      if (updatedPkg?.source.type === 'git') {
        expect(updatedPkg.source.commit).toBe(UPDATED_SHA)
      }
    }

    // Verify lockfile integrity was recalculated
    const updatedLockfileRaw = readFileSync(lockfilePath, 'utf-8')
    const updatedLockfile = lockfileV2Schema.safeParse(JSON.parse(updatedLockfileRaw) as unknown)
    expect(updatedLockfile.success).toBe(true)
    if (updatedLockfile.success) {
      const updatedLockPkg = Object.values(updatedLockfile.data.packages)[0]
      expect(updatedLockPkg).toBeDefined()
      expect(updatedLockPkg!.integrity).toMatch(/^sha256-/)
    }

    // -----------------------------------------------------------------
    // Step 10: list --json — skill still present after update
    // -----------------------------------------------------------------
    const { data: listData2, exitCode: listExit2 } = await runCliJson<ListResult>(
      ['list', '--json'],
      { cwd: tempDir }
    )

    expect(listExit2).toBe(0)
    expect(listData2.packages).toHaveLength(1)
    expect(listData2.packages[0]!.name).toContain('journey-repo')

    // -----------------------------------------------------------------
    // Step 11: remove — clean removal of the skill
    // -----------------------------------------------------------------
    const removeAction = getRemoveAction()
    await removeAction('journey-repo', { yes: true })

    // Verify canonical directory removed
    expect(existsSync(canonicalPath)).toBe(false)

    // Verify symlink removed (lstatSync throws if inode is gone)
    expect(() => lstatSync(symlinkPath)).toThrow()

    // Verify manifest and lockfile are now empty
    const finalState = readProjectState(tempDir)
    expect(Object.keys(finalState.manifest?.packages ?? {})).toHaveLength(0)
    expect(Object.keys(finalState.lockfile?.packages ?? {})).toHaveLength(0)
    expect(finalState.skills).toHaveLength(0)
    expect(finalState.symlinks).toHaveLength(0)

    // Validate manifest schema after removal
    const postRemoveManifestRaw = readFileSync(manifestPath, 'utf-8')
    const postRemoveManifest = manifestV2Schema.safeParse(
      JSON.parse(postRemoveManifestRaw) as unknown
    )
    expect(postRemoveManifest.success).toBe(true)

    // Validate lockfile schema after removal
    const postRemoveLockfileRaw = readFileSync(lockfilePath, 'utf-8')
    const postRemoveLockfile = lockfileV2Schema.safeParse(
      JSON.parse(postRemoveLockfileRaw) as unknown
    )
    expect(postRemoveLockfile.success).toBe(true)

    // -----------------------------------------------------------------
    // Step 12: list --json — empty after removal
    // -----------------------------------------------------------------
    const { data: listData3, exitCode: listExit3 } = await runCliJson<ListResult>(
      ['list', '--json'],
      { cwd: tempDir }
    )

    expect(listExit3).toBe(0)
    expect(listData3.packages).toHaveLength(0)

    // -----------------------------------------------------------------
    // Step 13: doctor — all local checks passing on clean state
    // -----------------------------------------------------------------
    const { data: doctorData, exitCode: doctorExit } = await runCliJson<DoctorResult>(
      ['doctor', '--json'],
      { cwd: tempDir }
    )

    expect(doctorExit).toBe(0)

    const doctorParsed = doctorResultSchema.safeParse(doctorData)
    expect(doctorParsed.success).toBe(true)

    // All local checks should pass (authentication may warn, which is expected)
    const localChecks = doctorData.checks.filter((c) => c.name !== 'authentication')
    for (const check of localChecks) {
      expect(
        check.status,
        `doctor check "${check.name}" should not fail — got status "${check.status}" with message: ${check.message}`
      ).not.toBe('fail')
    }
  })
})
