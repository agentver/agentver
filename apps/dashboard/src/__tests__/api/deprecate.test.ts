import { prisma } from '@agentver/database/client'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticateRequestWithDetails } from '@/lib/auth/api-auth'
import { POST as deprecateSkill } from '~/app/api/v1/skills/[org]/[name]/deprecate/route'
import { POST as deprecateVersion } from '~/app/api/v1/skills/[org]/[name]/versions/[version]/deprecate/route'
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

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(async () => {
  await cleanDatabase()
})

afterAll(async () => {
  await disconnectDatabase()
})

describe('POST /api/v1/skills/[org]/[name]/deprecate', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateRequestWithDetails).mockResolvedValue({
      ok: false,
      error: { status: 401, message: 'Unauthorised' },
    })

    const response = await deprecateSkill(makeRequest({}), {
      params: Promise.resolve({ org: 'test-org', name: 'my-skill' }),
    })

    expect(response.status).toBe(401)
  })

  it('deprecates the package for the author', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const pkg = await createTestPackage(org.id, user.id, {
      name: 'my-skill',
      slug: `${org.slug}/my-skill`,
      status: 'ACTIVE',
    })

    vi.mocked(authenticateRequestWithDetails).mockResolvedValue({
      ok: true,
      result: { userId: user.id, scopes: ['WRITE'] },
    })

    const response = await deprecateSkill(makeRequest({ message: 'Use the replacement skill' }), {
      params: Promise.resolve({ org: org.slug, name: 'my-skill' }),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('DEPRECATED')
    expect(body.message).toBe('Use the replacement skill')

    const updated = await prisma.package.findUnique({ where: { id: pkg.id } })
    expect(updated?.status).toBe('DEPRECATED')
    expect(updated?.deprecationNote).toBe('Use the replacement skill')
  })

  it('returns 403 for a non-maintainer', async () => {
    const { user, org } = await createTestOrgWithOwner()
    await createTestPackage(org.id, user.id, {
      name: 'my-skill',
      slug: `${org.slug}/my-skill`,
    })
    const outsider = await createTestUser()

    vi.mocked(authenticateRequestWithDetails).mockResolvedValue({
      ok: true,
      result: { userId: outsider.id, scopes: ['WRITE'] },
    })

    const response = await deprecateSkill(makeRequest({}), {
      params: Promise.resolve({ org: org.slug, name: 'my-skill' }),
    })

    expect(response.status).toBe(403)
  })
})

describe('POST /api/v1/skills/[org]/[name]/versions/[version]/deprecate', () => {
  it('returns 400 for an invalid semver version parameter', async () => {
    vi.mocked(authenticateRequestWithDetails).mockResolvedValue({
      ok: true,
      result: { userId: 'user-1', scopes: ['WRITE'] },
    })

    const response = await deprecateVersion(makeRequest({ message: 'Deprecated' }), {
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

  it('deprecates a published version and records the message as changelog', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const pkg = await createTestPackage(org.id, user.id, {
      name: 'my-skill',
      slug: `${org.slug}/my-skill`,
    })
    const version = await createTestVersion(pkg.id, {
      version: '1.2.3',
      status: 'PUBLISHED',
      changelog: 'Old notes',
    })

    vi.mocked(authenticateRequestWithDetails).mockResolvedValue({
      ok: true,
      result: { userId: user.id, scopes: ['WRITE'] },
    })

    const response = await deprecateVersion(
      makeRequest({ message: 'Deprecated in favour of 2.0.0' }),
      {
        params: Promise.resolve({ org: org.slug, name: 'my-skill', version: '1.2.3' }),
      }
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('DEPRECATED')
    expect(body.version).toBe('1.2.3')

    const updated = await prisma.packageVersion.findUnique({ where: { id: version.id } })
    expect(updated?.status).toBe('DEPRECATED')
    expect(updated?.changelog).toBe('Deprecated in favour of 2.0.0')
  })
})
