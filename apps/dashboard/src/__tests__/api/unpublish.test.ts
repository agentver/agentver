import { prisma } from '@agentver/database/client'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticateRequestWithDetails } from '@/lib/auth/api-auth'
import { POST } from '~/app/api/v1/skills/[org]/[name]/versions/[version]/unpublish/route'
import {
  createTestOrgWithOwner,
  createTestPackage,
  createTestUser,
  createTestVersion,
} from '~/test/factories'
import { cleanDatabase, disconnectDatabase } from '~/test/helpers/db'

vi.mock('@/lib/auth/api-auth', () => ({
  authenticateRequestWithDetails: vi.fn(),
}))

function makeRequest(): Request {
  return new Request('http://localhost/api/v1/test', {
    method: 'POST',
  })
}

beforeEach(async () => {
  await cleanDatabase()
})

afterAll(async () => {
  await disconnectDatabase()
})

describe('POST /api/v1/skills/[org]/[name]/versions/[version]/unpublish', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateRequestWithDetails).mockResolvedValue({
      ok: false,
      error: { status: 401, message: 'Unauthorised' },
    })

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ org: 'test-org', name: 'my-skill', version: '1.2.3' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorised' })
  })

  it('returns 400 for an invalid semver version parameter', async () => {
    vi.mocked(authenticateRequestWithDetails).mockResolvedValue({
      ok: true,
      result: { userId: 'user-1', scopes: ['WRITE'] },
    })

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ org: 'test-org', name: 'my-skill', version: 'latest' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Validation failed',
      details: {
        version: ['Must be valid semver'],
      },
    })
  })

  it('yanks a published version for the author', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const pkg = await createTestPackage(org.id, user.id, {
      name: 'my-skill',
      slug: `${org.slug}/my-skill`,
    })
    const version = await createTestVersion(pkg.id, {
      version: '1.2.3',
      status: 'PUBLISHED',
    })

    vi.mocked(authenticateRequestWithDetails).mockResolvedValue({
      ok: true,
      result: { userId: user.id, scopes: ['WRITE'] },
    })

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ org: org.slug, name: 'my-skill', version: '1.2.3' }),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('YANKED')
    expect(body.version).toBe('1.2.3')

    const updated = await prisma.packageVersion.findUnique({ where: { id: version.id } })
    expect(updated?.status).toBe('YANKED')
  })

  it('returns 403 for a non-maintainer', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const pkg = await createTestPackage(org.id, user.id, {
      name: 'my-skill',
      slug: `${org.slug}/my-skill`,
    })
    await createTestVersion(pkg.id, {
      version: '1.2.3',
      status: 'PUBLISHED',
    })
    const outsider = await createTestUser()

    vi.mocked(authenticateRequestWithDetails).mockResolvedValue({
      ok: true,
      result: { userId: outsider.id, scopes: ['WRITE'] },
    })

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ org: org.slug, name: 'my-skill', version: '1.2.3' }),
    })

    expect(response.status).toBe(403)
  })
})
