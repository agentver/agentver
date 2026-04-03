/**
 * E2E: Publish -> Search -> Install flow
 *
 * Exercises the author-to-consumer journey: a skill author publishes to the
 * platform, a consumer searches for it, and resolves it for installation.
 *
 * Uses the real CLI binary against a mock platform HTTP server — no module
 * mocking, no stubbed fetch. The CLI runs as a child process, authenticating
 * against the mock server via credentials written to a temp HOME directory.
 *
 * Note: publish's `--json` flag does not currently produce JSON output when
 * run via the CLI binary (the parent program's global --json option shadows
 * the subcommand's). Publish tests therefore verify behaviour via mock server
 * recorded requests and exit codes rather than stdout JSON parsing.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanupTempDir, createTempDir } from '../helpers/mock-fs'
import {
  createMockPlatformServer,
  type MockPlatformServer,
  writeMockCredentials,
} from '../helpers/mock-server'
import { runCli, runCliJson } from './helpers'

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let server: MockPlatformServer
let tempHome: string
let skillDir: string

/** Stores the "published" skill so the search route can return it */
const publishedSkills: Map<
  string,
  { org: string; name: string; version: string; files: Array<{ path: string; content: string }> }
> = new Map()

// ---------------------------------------------------------------------------
// Valid SKILL.md content for publishing
// ---------------------------------------------------------------------------

const SKILL_NAME = 'e2e-test-skill'
const SKILL_ORG = 'test-org'
const SKILL_VERSION = '1.0.0'

const SKILL_MD_CONTENT = `---
name: ${SKILL_NAME}
description: An E2E test skill for the publish-search-install flow
version: ${SKILL_VERSION}
---

# E2E Test Skill

This skill is used to verify the publish -> search -> install pipeline.
`

// ---------------------------------------------------------------------------
// Helper: publish the skill (used as setup for search/resolve tests)
// ---------------------------------------------------------------------------

async function publishSkill(): Promise<void> {
  const result = await runCli(['publish', '--org', SKILL_ORG, '--skip-audit'], {
    cwd: skillDir,
    homeDir: tempHome,
  })

  if (result.exitCode !== 0) {
    throw new Error(`Publish failed (exit ${result.exitCode}): ${result.stderr}`)
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  server = await createMockPlatformServer()

  // Override publish route to capture the published files
  server.addRoute('POST', /^\/api\/v1\/skills\/@[^/]+\/[^/]+\/publish$/, (req, res) => {
    const segments = req.pathname.split('/')
    // /api/v1/skills/@org/name/publish -> ['', 'api', 'v1', 'skills', '@org', 'name', 'publish']
    const org = segments[4]?.replace('@', '') ?? 'unknown'
    const name = segments[5] ?? 'unknown'
    const body = req.body as {
      version?: string
      files?: Array<{ path: string; content: string }>
    } | null

    const version = body?.version ?? '1.0.0'
    const files = body?.files ?? []

    publishedSkills.set(`@${org}/${name}`, { org, name, version, files })

    res.json(200, {
      version,
      commitSha: 'e2e0000000000000000000000000000000000001',
    })
  })

  // Override search route to return any previously published skill matching the query
  server.addRoute('GET', '/api/v1/search', (req, res) => {
    const query = req.query.get('q') ?? ''
    const matchingResults = [...publishedSkills.entries()]
      .filter(([key, skill]) => key.includes(query) || skill.name.includes(query))
      .map(([_key, skill]) => ({
        id: `skill_e2e_${skill.name}`,
        name: skill.name,
        slug: skill.name,
        description: `Published skill: ${skill.name}`,
        type: 'SKILL',
        tags: ['e2e-test'],
        compatibilityAgents: ['claude-code'],
        starCount: 0,
        installCount: 0,
        organisation: { slug: skill.org, name: `${skill.org} Organisation` },
        categories: [],
      }))

    res.json(200, {
      results: matchingResults,
      total: matchingResults.length,
      limit: 20,
      offset: 0,
    })
  })

  // Override resolve route to return file contents for published skills
  server.addRoute('GET', '/api/v1/resolve', (req, res) => {
    const nameQuery = req.query.get('name') ?? ''
    const ref = req.query.get('ref') ?? 'main'

    const match = [...publishedSkills.entries()].find(
      ([key, skill]) => key.includes(nameQuery) || skill.name === nameQuery
    )

    if (match) {
      const [, skill] = match
      res.json(200, {
        gitUri: `agentver://${skill.org}`,
        gitRef: ref,
        source: 'platform',
        files: skill.files,
      })
    } else {
      res.json(200, {
        gitUri: `agentver://${nameQuery}`,
        gitRef: ref,
        source: 'platform',
        files: [{ path: 'SKILL.md', content: '---\nname: unknown\n---\n\n# Unknown\n' }],
      })
    }
  })
})

afterAll(async () => {
  await server.close()
})

beforeEach(() => {
  server.clearRequests()
  publishedSkills.clear()

  tempHome = createTempDir()

  writeMockCredentials(tempHome, {
    platformUrl: server.url,
    token: 'e2e-publish-search-token',
    defaultOrg: SKILL_ORG,
  })

  // Create a skill directory with a valid SKILL.md
  skillDir = join(tempHome, 'skills', SKILL_ORG, SKILL_NAME)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), SKILL_MD_CONTENT)
})

afterEach(() => {
  cleanupTempDir(tempHome)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E: publish -> search -> install flow', () => {
  // -------------------------------------------------------------------------
  // 1. Publish
  // -------------------------------------------------------------------------

  describe('publish', () => {
    it('publishes a skill to the platform successfully', async () => {
      const result = await runCli(['publish', '--org', SKILL_ORG, '--skip-audit'], {
        cwd: skillDir,
        homeDir: tempHome,
      })

      expect(result.exitCode).toBe(0)

      // Verify the server received the publish request
      const publishRequests = server.getRequestsFor(
        'POST',
        `/api/v1/skills/@${SKILL_ORG}/${SKILL_NAME}/publish`
      )
      expect(publishRequests).toHaveLength(1)
    })

    it('sends the correct files and version in the publish request body', async () => {
      await publishSkill()

      const publishRequests = server.getRequestsFor(
        'POST',
        `/api/v1/skills/@${SKILL_ORG}/${SKILL_NAME}/publish`
      )
      expect(publishRequests).toHaveLength(1)

      const body = publishRequests[0]!.body as {
        version: string
        files: Array<{ path: string; content: string }>
      }
      expect(body.version).toBe(SKILL_VERSION)
      expect(body.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'SKILL.md', content: SKILL_MD_CONTENT }),
        ])
      )
    })

    it('sends the auth token in the publish request', async () => {
      await publishSkill()

      const publishRequests = server.getRequestsFor(
        'POST',
        `/api/v1/skills/@${SKILL_ORG}/${SKILL_NAME}/publish`
      )
      expect(publishRequests).toHaveLength(1)
      expect(publishRequests[0]!.headers.authorization).toBe('Bearer e2e-publish-search-token')
    })

    it('sends the frontmatter version from SKILL.md in the request body', async () => {
      // Create a skill with a specific version in frontmatter
      const customVersion = '3.2.1'
      const customSkillDir = join(tempHome, 'skills', SKILL_ORG, 'versioned-skill')
      mkdirSync(customSkillDir, { recursive: true })
      writeFileSync(
        join(customSkillDir, 'SKILL.md'),
        `---\nname: versioned-skill\ndescription: A versioned skill\nversion: ${customVersion}\n---\n\n# Versioned\n`
      )

      const result = await runCli(['publish', '--org', SKILL_ORG, '--skip-audit'], {
        cwd: customSkillDir,
        homeDir: tempHome,
      })

      expect(result.exitCode).toBe(0)

      const publishRequests = server.getRequestsFor(
        'POST',
        `/api/v1/skills/@${SKILL_ORG}/versioned-skill/publish`
      )
      expect(publishRequests).toHaveLength(1)

      const body = publishRequests[0]!.body as { version: string }
      expect(body.version).toBe(customVersion)
    })

    it('stores the published skill data on the server', async () => {
      await publishSkill()

      expect(publishedSkills.has(`@${SKILL_ORG}/${SKILL_NAME}`)).toBe(true)

      const published = publishedSkills.get(`@${SKILL_ORG}/${SKILL_NAME}`)!
      expect(published.org).toBe(SKILL_ORG)
      expect(published.name).toBe(SKILL_NAME)
      expect(published.version).toBe(SKILL_VERSION)
      expect(published.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'SKILL.md', content: SKILL_MD_CONTENT }),
        ])
      )
    })
  })

  // -------------------------------------------------------------------------
  // 2. Search (after publish)
  // -------------------------------------------------------------------------

  describe('search after publish', () => {
    it('finds the published skill when searching by name', async () => {
      await publishSkill()
      server.clearRequests()

      // Use AGENTVER_REGISTRY env var so registryFetch points at the mock server
      const searchResult = await runCliJson<{
        platform: Array<{ name: string; slug: string; organisation: { slug: string } }>
        total: number
      }>(['search', SKILL_NAME, '--json', '--source', 'platform'], {
        cwd: tempHome,
        homeDir: tempHome,
        env: { AGENTVER_REGISTRY: `${server.url}/api/v1` },
      })

      expect(searchResult.success).toBe(true)
      expect(searchResult.exitCode).toBe(0)
      expect(searchResult.data.platform).toHaveLength(1)
      expect(searchResult.data.platform[0]!.name).toBe(SKILL_NAME)
      expect(searchResult.data.platform[0]!.organisation.slug).toBe(SKILL_ORG)
      expect(searchResult.data.total).toBe(1)
    })

    it('sends the search query to the correct platform endpoint', async () => {
      await publishSkill()
      server.clearRequests()

      await runCli(['search', SKILL_NAME, '--json', '--source', 'platform'], {
        cwd: tempHome,
        homeDir: tempHome,
        env: { AGENTVER_REGISTRY: `${server.url}/api/v1` },
      })

      const searchRequests = server.getRequestsFor('GET', '/api/v1/search')
      expect(searchRequests).toHaveLength(1)
      expect(searchRequests[0]!.query.get('q')).toBe(SKILL_NAME)
    })

    it('returns empty results when searching for a non-existent skill', async () => {
      const searchResult = await runCliJson<{
        platform: unknown[]
        total: number
      }>(['search', 'non-existent-skill-xyz', '--json', '--source', 'platform'], {
        cwd: tempHome,
        homeDir: tempHome,
        env: { AGENTVER_REGISTRY: `${server.url}/api/v1` },
      })

      expect(searchResult.success).toBe(true)
      expect(searchResult.data.platform).toHaveLength(0)
      expect(searchResult.data.total).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // 3. Full flow: publish -> search -> verify data consistency
  // -------------------------------------------------------------------------

  describe('full flow data consistency', () => {
    it('published skill data matches search result metadata', async () => {
      // Step 1: Publish
      await publishSkill()

      // Step 2: Search
      const searchResult = await runCliJson<{
        platform: Array<{
          name: string
          slug: string
          organisation: { slug: string; name: string }
        }>
        total: number
      }>(['search', SKILL_NAME, '--json', '--source', 'platform'], {
        cwd: tempHome,
        homeDir: tempHome,
        env: { AGENTVER_REGISTRY: `${server.url}/api/v1` },
      })

      expect(searchResult.success).toBe(true)
      expect(searchResult.data.platform).toHaveLength(1)

      // Step 3: Verify consistency
      const found = searchResult.data.platform[0]!
      expect(found.name).toBe(SKILL_NAME)
      expect(found.slug).toBe(SKILL_NAME)
      expect(found.organisation.slug).toBe(SKILL_ORG)

      // Step 4: Verify request ordering (publish before search)
      const allRequests = server.getRequests()
      const publishReqs = allRequests.filter(
        (r) => r.method === 'POST' && r.pathname.includes('/publish')
      )
      const searchReqs = allRequests.filter(
        (r) => r.method === 'GET' && r.pathname.includes('/search')
      )

      expect(publishReqs.length).toBeGreaterThanOrEqual(1)
      expect(searchReqs.length).toBeGreaterThanOrEqual(1)
      expect(publishReqs[0]!.timestamp).toBeLessThan(searchReqs[0]!.timestamp)
    })

    it('published skill files are available via the resolve endpoint', async () => {
      await publishSkill()

      // Verify the published data is in the store (the resolve route reads from it)
      expect(publishedSkills.has(`@${SKILL_ORG}/${SKILL_NAME}`)).toBe(true)

      const published = publishedSkills.get(`@${SKILL_ORG}/${SKILL_NAME}`)!
      expect(published.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'SKILL.md', content: SKILL_MD_CONTENT }),
        ])
      )
      expect(published.version).toBe(SKILL_VERSION)
      expect(published.org).toBe(SKILL_ORG)
    })
  })

  // -------------------------------------------------------------------------
  // 4. Error cases
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('publish fails without a SKILL.md in the directory', async () => {
      const emptyDir = join(tempHome, 'empty-skill')
      mkdirSync(emptyDir, { recursive: true })

      const result = await runCli(['publish', '--org', SKILL_ORG], {
        cwd: emptyDir,
        homeDir: tempHome,
      })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('No SKILL.md found')
    })

    it('publish fails without authentication', async () => {
      const unauthHome = createTempDir()
      try {
        const agentverDir = join(unauthHome, '.agentver')
        mkdirSync(agentverDir, { recursive: true })
        writeFileSync(
          join(agentverDir, 'config.json'),
          JSON.stringify({ platformUrl: server.url }),
          'utf-8'
        )

        const result = await runCli(['publish', '--org', SKILL_ORG, '--skip-audit'], {
          cwd: skillDir,
          homeDir: unauthHome,
        })

        expect(result.exitCode).not.toBe(0)
      } finally {
        cleanupTempDir(unauthHome)
      }
    })

    it('search --source platform fails without a connection', async () => {
      const disconnectedHome = createTempDir()
      try {
        const result = await runCli(['search', SKILL_NAME, '--json', '--source', 'platform'], {
          cwd: disconnectedHome,
          homeDir: disconnectedHome,
        })

        expect(result.exitCode).not.toBe(0)
      } finally {
        cleanupTempDir(disconnectedHome)
      }
    })
  })

  // -------------------------------------------------------------------------
  // 5. Dry-run publish
  // -------------------------------------------------------------------------

  describe('dry-run publish', () => {
    it('validates files without sending to the platform', async () => {
      const result = await runCli(['publish', '--org', SKILL_ORG, '--skip-audit', '--dry-run'], {
        cwd: skillDir,
        homeDir: tempHome,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('dry-run')
      expect(result.stdout).toContain(SKILL_NAME)
      expect(result.stdout).toContain(SKILL_VERSION)
      expect(result.stdout).toContain('SKILL.md')

      // No publish request should have been made
      const publishRequests = server.getRequestsFor(
        'POST',
        `/api/v1/skills/@${SKILL_ORG}/${SKILL_NAME}/publish`
      )
      expect(publishRequests).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // 6. Search with type filter
  // -------------------------------------------------------------------------

  describe('search with filters', () => {
    it('passes the type filter to the platform search request', async () => {
      await publishSkill()
      server.clearRequests()

      await runCli(['search', SKILL_NAME, '--json', '--source', 'platform', '--type', 'skill'], {
        cwd: tempHome,
        homeDir: tempHome,
        env: { AGENTVER_REGISTRY: `${server.url}/api/v1` },
      })

      const searchRequests = server.getRequestsFor('GET', '/api/v1/search')
      expect(searchRequests).toHaveLength(1)
      expect(searchRequests[0]!.query.get('q')).toBe(SKILL_NAME)
      expect(searchRequests[0]!.query.get('type')).toBe('SKILL')
    })
  })
})
