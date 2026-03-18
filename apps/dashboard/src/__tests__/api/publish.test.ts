import { prisma } from '@agentver/database/client'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticateRequest } from '@/lib/auth/api-auth'
import { getGitProvider } from '@/lib/git'
import { POST } from '~/app/api/v1/skills/[org]/[name]/publish/route'
import { createTestOrgWithOwner, createTestPackage, createTestUser } from '~/test/factories'
import { cleanDatabase, disconnectDatabase } from '~/test/helpers/db'

vi.mock('@/lib/auth/api-auth', () => ({
  authenticateRequest: vi.fn(),
}))

vi.mock('@/lib/git', () => ({
  getGitProvider: vi.fn(),
}))

const mockGitService = {
  createSkill: vi.fn().mockResolvedValue({ commitSha: 'abc123def456' }),
  createVersion: vi.fn().mockResolvedValue(undefined),
}

const SKILL_MD_CONTENT = `---
name: my-skill
description: A test skill for publishing
version: 1.0.0
tags:
  - testing
  - automation
compatibility:
  - claude
---

# My Skill

This is a test skill.
`

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/skills/test-org/my-skill/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeParams(org: string, name: string) {
  return { params: Promise.resolve({ org, name }) }
}

beforeEach(async () => {
  await cleanDatabase()
  vi.mocked(getGitProvider).mockReturnValue(mockGitService as never)
  mockGitService.createSkill.mockResolvedValue({ commitSha: 'abc123def456' })
  mockGitService.createVersion.mockResolvedValue(undefined)
})

afterAll(async () => {
  await disconnectDatabase()
})

// ---------------------------------------------------------------------------
// POST /api/v1/skills/[org]/[name]/publish
// ---------------------------------------------------------------------------

describe('POST /api/v1/skills/[org]/[name]/publish', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue(null)

    const response = await POST(
      makeRequest({ files: [{ path: 'SKILL.md', content: SKILL_MD_CONTENT }] }),
      makeParams('test-org', 'my-skill')
    )

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.error).toBe('Unauthorised')
  })

  it('returns 403 when token lacks WRITE scope', async () => {
    const { user } = await createTestOrgWithOwner()
    vi.mocked(authenticateRequest).mockResolvedValue({ userId: user.id, scopes: ['READ'] })

    const response = await POST(
      makeRequest({ files: [{ path: 'SKILL.md', content: SKILL_MD_CONTENT }] }),
      makeParams('test-org', 'my-skill')
    )

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error).toBe('Insufficient permissions')
  })

  it('returns 403 when user is not a member of the org', async () => {
    const { org } = await createTestOrgWithOwner()
    const outsider = await createTestUser()
    vi.mocked(authenticateRequest).mockResolvedValue({ userId: outsider.id, scopes: ['WRITE'] })

    const response = await POST(
      makeRequest({ files: [{ path: 'SKILL.md', content: SKILL_MD_CONTENT }] }),
      makeParams(org.slug, 'my-skill')
    )

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error).toBe('Not a member of this organisation')
  })

  it('returns 400 when SKILL.md is missing for a new package', async () => {
    const { user, org } = await createTestOrgWithOwner()
    vi.mocked(authenticateRequest).mockResolvedValue({ userId: user.id, scopes: ['WRITE'] })

    const response = await POST(
      makeRequest({ files: [{ path: 'README.md', content: '# readme' }] }),
      makeParams(org.slug, 'brand-new-skill')
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('SKILL.md required for new packages')
  })

  it('auto-creates package on first publish', async () => {
    const { user, org } = await createTestOrgWithOwner()
    vi.mocked(authenticateRequest).mockResolvedValue({ userId: user.id, scopes: ['WRITE'] })

    const response = await POST(
      makeRequest({ files: [{ path: 'SKILL.md', content: SKILL_MD_CONTENT }] }),
      makeParams(org.slug, 'my-skill')
    )

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.commitSha).toBe('abc123def456')

    const pkg = await prisma.package.findFirst({
      where: { organisationId: org.id, name: 'my-skill' },
    })
    expect(pkg).not.toBeNull()
    expect(pkg?.name).toBe('my-skill')
    expect(pkg?.organisationId).toBe(org.id)
    expect(pkg?.authorId).toBe(user.id)
  })

  it('sets visibility to PUBLIC when --public is passed', async () => {
    const { user, org } = await createTestOrgWithOwner()
    vi.mocked(authenticateRequest).mockResolvedValue({ userId: user.id, scopes: ['WRITE'] })

    await POST(
      makeRequest({
        files: [{ path: 'SKILL.md', content: SKILL_MD_CONTENT }],
        visibility: 'PUBLIC',
      }),
      makeParams(org.slug, 'my-skill')
    )

    const pkg = await prisma.package.findFirst({
      where: { organisationId: org.id, name: 'my-skill' },
    })
    expect(pkg?.visibility).toBe('PUBLIC')
  })

  it('sets visibility to PRIVATE by default', async () => {
    const { user, org } = await createTestOrgWithOwner()
    vi.mocked(authenticateRequest).mockResolvedValue({ userId: user.id, scopes: ['WRITE'] })

    await POST(
      makeRequest({ files: [{ path: 'SKILL.md', content: SKILL_MD_CONTENT }] }),
      makeParams(org.slug, 'my-skill')
    )

    const pkg = await prisma.package.findFirst({
      where: { organisationId: org.id, name: 'my-skill' },
    })
    expect(pkg?.visibility).toBe('PRIVATE')
  })

  it('updates visibility on an existing package when specified', async () => {
    const { user, org } = await createTestOrgWithOwner()
    vi.mocked(authenticateRequest).mockResolvedValue({ userId: user.id, scopes: ['WRITE'] })

    const existing = await createTestPackage(org.id, user.id, {
      name: 'my-skill',
      slug: `${org.slug}/my-skill`,
      visibility: 'PRIVATE',
    })

    await POST(
      makeRequest({
        files: [{ path: 'SKILL.md', content: SKILL_MD_CONTENT }],
        visibility: 'PUBLIC',
      }),
      makeParams(org.slug, 'my-skill')
    )

    const updated = await prisma.package.findUnique({ where: { id: existing.id } })
    expect(updated?.visibility).toBe('PUBLIC')
  })

  it('publishes without SKILL.md when package already exists', async () => {
    const { user, org } = await createTestOrgWithOwner()
    vi.mocked(authenticateRequest).mockResolvedValue({ userId: user.id, scopes: ['WRITE'] })

    await createTestPackage(org.id, user.id, {
      name: 'my-skill',
      slug: `${org.slug}/my-skill`,
    })

    const response = await POST(
      makeRequest({ files: [{ path: 'extra-context.md', content: '# extra' }] }),
      makeParams(org.slug, 'my-skill')
    )

    expect(response.status).toBe(201)
  })

  it('creates a PackageVersion record when version is specified', async () => {
    const { user, org } = await createTestOrgWithOwner()
    vi.mocked(authenticateRequest).mockResolvedValue({ userId: user.id, scopes: ['WRITE'] })

    const response = await POST(
      makeRequest({
        files: [{ path: 'SKILL.md', content: SKILL_MD_CONTENT }],
        version: '1.0.0',
      }),
      makeParams(org.slug, 'my-skill')
    )

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.version).toBe('1.0.0')

    const pkg = await prisma.package.findFirst({
      where: { organisationId: org.id, name: 'my-skill' },
    })
    expect(pkg).not.toBeNull()

    const version = await prisma.packageVersion.findFirst({
      where: { packageId: pkg!.id, version: '1.0.0' },
    })
    expect(version).not.toBeNull()
    expect(version?.gitCommitSha).toBe('abc123def456')
    expect(version?.gitRef).toBe('v/my-skill/1.0.0')
    expect(typeof version?.sha256).toBe('string')
    expect(version?.sha256).toHaveLength(64)
  })

  it('returns 400 for an invalid JSON body', async () => {
    const { user } = await createTestOrgWithOwner()
    vi.mocked(authenticateRequest).mockResolvedValue({ userId: user.id, scopes: ['WRITE'] })

    const request = new Request('http://localhost/api/v1/skills/test-org/my-skill/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json{{{',
    })

    const response = await POST(request, makeParams('test-org', 'my-skill'))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Invalid JSON body')
  })
})
