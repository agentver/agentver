/**
 * E2E tests for draft (branch) management and version tagging commands.
 *
 * These tests run the built CLI binary as a child process against a mock
 * platform server with real filesystem state. No in-process mocking —
 * exercises the full codepath end-to-end including auth, skill identity
 * resolution, lockfile tracking, and platform API interaction.
 *
 * The CLI resolves skill identity from SKILL.md in cwd and the manifest at
 * cwd/.agentver/manifest.json. All commands use process.cwd() as both the
 * skill directory and the project root, so we place SKILL.md at the project
 * root alongside the manifest and lockfile.
 *
 * Note: Draft commands only check `options.json` (not `isJSONMode()`) for
 * JSON output, so the --json flag on the parent program silences the spinner
 * but doesn't trigger JSON output from the draft subcommands. These tests
 * therefore verify draft behaviour via exit codes, text output, and mock
 * server request assertions. Version commands properly check `isJSONMode()`
 * and produce JSON output.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LockfileV2 } from '@agentver/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createPlatformSource, createSkillMd } from '../helpers/fixtures'
import { cleanupTempDir, createTempDir } from '../helpers/mock-fs'
import {
  createMockPlatformServer,
  type MockPlatformServer,
  writeMockConfig,
  writeMockCredentials,
} from '../helpers/mock-server'
import { runCli, runCliJson, setupInstalledSkill } from './helpers'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKILL_NAME = 'test-skill'
const ORG_SLUG = 'test-org'
const COMMIT_SHA = 'abc1234567890abcdef1234567890abcdef123456'
const DRAFT_NAME = 'my-feature'
const DRAFT_REF = `draft/${SKILL_NAME}/${DRAFT_NAME}`

const SKILL_MD_CONTENT = createSkillMd({
  name: SKILL_NAME,
  description: 'A test skill for E2E draft/version tests',
  version: '1.0.0',
})

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server: MockPlatformServer

beforeAll(async () => {
  server = await createMockPlatformServer()
})

afterAll(async () => {
  await server.close()
})

beforeEach(() => {
  server.clearRequests()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a temp project with HOME isolation, mock credentials, and a seeded
 * platform skill installed at project scope.
 *
 * A SKILL.md is also written at the project root so that
 * `resolveCurrentSkillIdentity()` can detect the skill name when cwd is the
 * project root (which is how the CLI resolves both identity and storage).
 */
function createProjectWithPlatformSkill(options?: { ref?: string; noCredentials?: boolean }): {
  projectRoot: string
  homeDir: string
  cleanup: () => void
} {
  const projectRoot = createTempDir()
  const homeDir = createTempDir()

  if (!options?.noCredentials) {
    writeMockCredentials(homeDir, {
      platformUrl: server.url,
      token: 'e2e-test-token',
      defaultOrg: ORG_SLUG,
    })
  } else {
    writeMockConfig(homeDir, {
      platformUrl: server.url,
      defaultOrg: ORG_SLUG,
    })
  }

  const source = createPlatformSource({
    uri: `agentver://${ORG_SLUG}`,
    path: '',
    ref: options?.ref ?? 'main',
    commit: COMMIT_SHA,
  })

  setupInstalledSkill(projectRoot, {
    name: SKILL_NAME,
    files: { 'SKILL.md': SKILL_MD_CONTENT },
    agents: ['claude-code'],
    source,
  })

  // Place SKILL.md at the project root so the CLI can detect the skill name
  // when running with cwd = projectRoot (identity resolution reads from cwd).
  writeFileSync(join(projectRoot, 'SKILL.md'), SKILL_MD_CONTENT, 'utf-8')

  return {
    projectRoot,
    homeDir,
    cleanup: () => {
      cleanupTempDir(projectRoot)
      cleanupTempDir(homeDir)
    },
  }
}

/** Reads the lockfile back from disk. */
function readLockfileFromDisk(projectRoot: string): LockfileV2 {
  const lockfilePath = join(projectRoot, '.agentver', 'lockfile.json')
  return JSON.parse(readFileSync(lockfilePath, 'utf-8')) as LockfileV2
}

// ---------------------------------------------------------------------------
// Draft commands
// ---------------------------------------------------------------------------

describe('E2E: draft commands', () => {
  // =========================================================================
  // draft create
  // =========================================================================

  describe('draft create', () => {
    it('sends a POST to the drafts endpoint and exits successfully', async () => {
      const { projectRoot, homeDir, cleanup } = createProjectWithPlatformSkill()

      try {
        const result = await runCli(['draft', 'create', DRAFT_NAME], {
          cwd: projectRoot,
          homeDir,
        })

        expect(result.exitCode).toBe(0)

        // Verify the correct API endpoint was called
        const requests = server.getRequestsFor(
          'POST',
          `/api/v1/skills/@${ORG_SLUG}/${SKILL_NAME}/drafts`
        )
        expect(requests).toHaveLength(1)
        expect(requests[0]!.body).toMatchObject({ name: DRAFT_NAME })

        // Verify auth header was sent
        expect(requests[0]!.headers.authorization).toBe('Bearer e2e-test-token')
      } finally {
        cleanup()
      }
    })

    it('fails without authentication', async () => {
      const { projectRoot, homeDir, cleanup } = createProjectWithPlatformSkill({
        noCredentials: true,
      })

      try {
        const result = await runCli(['draft', 'create', DRAFT_NAME], {
          cwd: projectRoot,
          homeDir,
        })

        expect(result.exitCode).not.toBe(0)

        // Verify no API call was made to the drafts endpoint
        const requests = server.getRequestsFor(
          'POST',
          `/api/v1/skills/@${ORG_SLUG}/${SKILL_NAME}/drafts`
        )
        expect(requests).toHaveLength(0)
      } finally {
        cleanup()
      }
    })

    it('fails when not in a skill directory (no SKILL.md, no manifest entry)', async () => {
      const emptyDir = createTempDir()
      const homeDir = createTempDir()

      try {
        writeMockCredentials(homeDir, {
          platformUrl: server.url,
          token: 'e2e-test-token',
        })

        const result = await runCli(['draft', 'create', DRAFT_NAME], {
          cwd: emptyDir,
          homeDir,
        })

        expect(result.exitCode).not.toBe(0)
        expect(result.stderr).toContain('Could not determine skill identity')
      } finally {
        cleanupTempDir(emptyDir)
        cleanupTempDir(homeDir)
      }
    })
  })

  // =========================================================================
  // draft list
  // =========================================================================

  describe('draft list', () => {
    it('fetches and displays drafts from the platform API', async () => {
      const { projectRoot, homeDir, cleanup } = createProjectWithPlatformSkill()

      // Override the default empty draft list with populated data
      server.addRoute('GET', /^\/api\/v1\/skills\/@[^/]+\/[^/]+\/drafts$/, (_req, res) => {
        res.json(200, [
          {
            name: 'feature-alpha',
            branchName: `draft/${SKILL_NAME}/feature-alpha`,
            latestCommitId: 'aaa1111111',
            latestMessage: 'Add new prompt template',
          },
          {
            name: 'feature-beta',
            branchName: `draft/${SKILL_NAME}/feature-beta`,
            latestCommitId: 'bbb2222222',
            latestMessage: 'Refactor instructions',
          },
        ])
      })

      try {
        const result = await runCli(['draft', 'list'], { cwd: projectRoot, homeDir })

        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('feature-alpha')
        expect(result.stdout).toContain('feature-beta')

        // Verify the correct API endpoint was called
        const requests = server.getRequestsFor(
          'GET',
          `/api/v1/skills/@${ORG_SLUG}/${SKILL_NAME}/drafts`
        )
        expect(requests).toHaveLength(1)
      } finally {
        cleanup()
      }
    })
  })

  // =========================================================================
  // draft switch
  // =========================================================================

  describe('draft switch', () => {
    it('switches to a draft branch and updates the lockfile ref', async () => {
      const { projectRoot, homeDir, cleanup } = createProjectWithPlatformSkill()

      try {
        const result = await runCli(['draft', 'switch', DRAFT_NAME], {
          cwd: projectRoot,
          homeDir,
        })

        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain(DRAFT_REF)

        // Verify the lockfile on disk was updated with the draft ref
        const lockfile = readLockfileFromDisk(projectRoot)
        const lockfilePackage = Object.values(lockfile.packages)[0]
        expect(lockfilePackage).toBeDefined()
        expect(lockfilePackage!.source.type === 'platform' && lockfilePackage!.source.ref).toBe(
          DRAFT_REF
        )

        // Verify a resolve request was made to the platform
        const requests = server.getRequestsFor('GET', '/api/v1/resolve')
        expect(requests.length).toBeGreaterThanOrEqual(1)
      } finally {
        cleanup()
      }
    })
  })

  // =========================================================================
  // draft publish
  // =========================================================================

  describe('draft publish', () => {
    it('merges the current draft to main and updates the lockfile', async () => {
      const { projectRoot, homeDir, cleanup } = createProjectWithPlatformSkill({
        ref: DRAFT_REF,
      })

      try {
        const result = await runCli(['draft', 'publish'], {
          cwd: projectRoot,
          homeDir,
        })

        expect(result.exitCode).toBe(0)

        // Verify the platform received the merge request
        const requests = server.getRequestsFor(
          'POST',
          `/api/v1/skills/@${ORG_SLUG}/${SKILL_NAME}/drafts`
        )
        expect(requests).toHaveLength(1)
        expect(requests[0]!.body).toMatchObject({
          action: 'merge',
          branchName: DRAFT_REF,
        })

        // Verify lockfile ref was reset to main
        const lockfile = readLockfileFromDisk(projectRoot)
        const lockfilePackage = Object.values(lockfile.packages)[0]
        expect(lockfilePackage).toBeDefined()
        expect(lockfilePackage!.source.type === 'platform' && lockfilePackage!.source.ref).toBe(
          'main'
        )
      } finally {
        cleanup()
      }
    })

    it('fails when not on a draft branch', async () => {
      const { projectRoot, homeDir, cleanup } = createProjectWithPlatformSkill({ ref: 'main' })

      try {
        const result = await runCli(['draft', 'publish'], { cwd: projectRoot, homeDir })

        expect(result.exitCode).not.toBe(0)
        expect(result.stderr).toContain('Not on a draft branch')

        // Verify no API call was made to the drafts endpoint
        const requests = server.getRequestsFor(
          'POST',
          `/api/v1/skills/@${ORG_SLUG}/${SKILL_NAME}/drafts`
        )
        expect(requests).toHaveLength(0)
      } finally {
        cleanup()
      }
    })
  })

  // =========================================================================
  // draft discard
  // =========================================================================

  describe('draft discard', () => {
    it('discards the current draft and reverts lockfile to main', async () => {
      const { projectRoot, homeDir, cleanup } = createProjectWithPlatformSkill({
        ref: DRAFT_REF,
      })

      try {
        const result = await runCli(['draft', 'discard'], {
          cwd: projectRoot,
          homeDir,
        })

        expect(result.exitCode).toBe(0)

        // Verify the platform received the delete request
        const requests = server.getRequestsFor(
          'POST',
          `/api/v1/skills/@${ORG_SLUG}/${SKILL_NAME}/drafts`
        )
        expect(requests).toHaveLength(1)
        expect(requests[0]!.body).toMatchObject({
          action: 'delete',
          branchName: DRAFT_REF,
        })

        // Verify lockfile ref was reset to main
        const lockfile = readLockfileFromDisk(projectRoot)
        const lockfilePackage = Object.values(lockfile.packages)[0]
        expect(lockfilePackage).toBeDefined()
        expect(lockfilePackage!.source.type === 'platform' && lockfilePackage!.source.ref).toBe(
          'main'
        )
      } finally {
        cleanup()
      }
    })

    it('fails when not on a draft branch', async () => {
      const { projectRoot, homeDir, cleanup } = createProjectWithPlatformSkill({ ref: 'main' })

      try {
        const result = await runCli(['draft', 'discard'], { cwd: projectRoot, homeDir })

        expect(result.exitCode).not.toBe(0)
        expect(result.stderr).toContain('Not on a draft branch')

        // Verify no API call was made to the drafts endpoint
        const requests = server.getRequestsFor(
          'POST',
          `/api/v1/skills/@${ORG_SLUG}/${SKILL_NAME}/drafts`
        )
        expect(requests).toHaveLength(0)
      } finally {
        cleanup()
      }
    })
  })
})

// ---------------------------------------------------------------------------
// Version commands
// ---------------------------------------------------------------------------

describe('E2E: version commands', () => {
  // =========================================================================
  // version create
  // =========================================================================

  describe('version create', () => {
    it('creates a version tag via the platform API', async () => {
      const { projectRoot, homeDir, cleanup } = createProjectWithPlatformSkill()

      try {
        const result = await runCliJson<{
          skill: string
          version: string
          tag: string
          commitSha: string
        }>(['version', 'create', '1.0.0', '--json'], { cwd: projectRoot, homeDir })

        expect(result.success).toBe(true)
        expect(result.exitCode).toBe(0)
        expect(result.data.skill).toBe(`@${ORG_SLUG}/${SKILL_NAME}`)
        expect(result.data.version).toBe('1.0.0')
        expect(result.data.tag).toBe('v/1.0.0')
        expect(result.data.commitSha).toBeDefined()

        // Verify the correct API endpoint was called
        const requests = server.getRequestsFor(
          'POST',
          `/api/v1/skills/@${ORG_SLUG}/${SKILL_NAME}/versions`
        )
        expect(requests).toHaveLength(1)
        expect(requests[0]!.body).toMatchObject({
          version: '1.0.0',
          commitSha: COMMIT_SHA,
        })

        // Verify auth header was sent
        expect(requests[0]!.headers.authorization).toBe('Bearer e2e-test-token')
      } finally {
        cleanup()
      }
    })

    it('sends release notes when --notes is provided', async () => {
      const { projectRoot, homeDir, cleanup } = createProjectWithPlatformSkill()

      try {
        const result = await runCliJson<{
          skill: string
          version: string
          tag: string
          commitSha: string
        }>(['version', 'create', '1.0.0', '--notes', 'Initial release', '--json'], {
          cwd: projectRoot,
          homeDir,
        })

        expect(result.success).toBe(true)
        expect(result.exitCode).toBe(0)

        // Verify notes were included in the request body
        const requests = server.getRequestsFor(
          'POST',
          `/api/v1/skills/@${ORG_SLUG}/${SKILL_NAME}/versions`
        )
        expect(requests).toHaveLength(1)
        expect(requests[0]!.body).toMatchObject({
          version: '1.0.0',
          notes: 'Initial release',
          commitSha: COMMIT_SHA,
        })
      } finally {
        cleanup()
      }
    })

    it('rejects invalid semver strings', async () => {
      const { projectRoot, homeDir, cleanup } = createProjectWithPlatformSkill()

      try {
        const result = await runCli(['version', 'create', 'not-a-version', '--json'], {
          cwd: projectRoot,
          homeDir,
        })

        expect(result.exitCode).not.toBe(0)

        // Parse the JSON output to check the error code
        const jsonLine = result.stdout
          .trim()
          .split('\n')
          .find((line) => line.startsWith('{'))
        expect(jsonLine).toBeDefined()

        const parsed = JSON.parse(jsonLine!) as {
          success: boolean
          error?: { code: string; message: string }
        }
        expect(parsed.success).toBe(false)
        expect(parsed.error?.code).toBe('VALIDATION_ERROR')

        // Verify no API call was made
        const requests = server.getRequestsFor(
          'POST',
          `/api/v1/skills/@${ORG_SLUG}/${SKILL_NAME}/versions`
        )
        expect(requests).toHaveLength(0)
      } finally {
        cleanup()
      }
    })

    it('fails without authentication', async () => {
      const { projectRoot, homeDir, cleanup } = createProjectWithPlatformSkill({
        noCredentials: true,
      })

      try {
        const result = await runCli(['version', 'create', '1.0.0', '--json'], {
          cwd: projectRoot,
          homeDir,
        })

        expect(result.exitCode).not.toBe(0)

        // Should output a JSON error
        const jsonLine = result.stdout
          .trim()
          .split('\n')
          .find((line) => line.startsWith('{'))
        if (jsonLine) {
          const parsed = JSON.parse(jsonLine) as {
            success: boolean
            error?: { code: string }
          }
          expect(parsed.success).toBe(false)
        }
      } finally {
        cleanup()
      }
    })
  })

  // =========================================================================
  // version list
  // =========================================================================

  describe('version list', () => {
    it('lists versions from the platform API as JSON', async () => {
      const { projectRoot, homeDir, cleanup } = createProjectWithPlatformSkill()

      try {
        const result = await runCliJson<{
          versions: Array<{
            name: string
            tag: string
            commitSha: string
            message: string
          }>
        }>(['version', 'list', '--json'], { cwd: projectRoot, homeDir })

        expect(result.success).toBe(true)
        expect(result.exitCode).toBe(0)
        expect(result.data.versions).toBeDefined()
        expect(Array.isArray(result.data.versions)).toBe(true)
        expect(result.data.versions.length).toBeGreaterThanOrEqual(1)

        const first = result.data.versions[0]!
        expect(first.tag).toBe('v/1.0.0')
        expect(first.commitSha).toBeDefined()

        // Verify the correct API endpoint was called
        const requests = server.getRequestsFor(
          'GET',
          `/api/v1/skills/@${ORG_SLUG}/${SKILL_NAME}/versions`
        )
        expect(requests).toHaveLength(1)
      } finally {
        cleanup()
      }
    })

    it('supports the top-level "versions" alias', async () => {
      const { projectRoot, homeDir, cleanup } = createProjectWithPlatformSkill()

      try {
        const result = await runCliJson<{
          versions: Array<{ name: string; tag: string }>
        }>(['versions', '--json'], { cwd: projectRoot, homeDir })

        expect(result.success).toBe(true)
        expect(result.exitCode).toBe(0)
        expect(result.data.versions).toBeDefined()

        // Verify the correct API endpoint was called
        const requests = server.getRequestsFor(
          'GET',
          `/api/v1/skills/@${ORG_SLUG}/${SKILL_NAME}/versions`
        )
        expect(requests).toHaveLength(1)
      } finally {
        cleanup()
      }
    })
  })
})
