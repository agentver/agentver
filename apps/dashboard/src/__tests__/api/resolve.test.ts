import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticateRequest } from '@/lib/auth/api-auth'
import { GET } from '~/app/api/v1/resolve/route'
import { createTestOrgWithOwner, createTestPackage } from '~/test/factories'
import { cleanDatabase, disconnectDatabase } from '~/test/helpers/db'

vi.mock('@/lib/auth/api-auth', () => ({
  authenticateRequest: vi.fn(),
}))

beforeEach(async () => {
  await cleanDatabase()
})

afterAll(async () => {
  await disconnectDatabase()
})

describe('GET /api/v1/resolve', () => {
  it.each([
    'feature..hidden',
    '.main',
    'main.',
    'feature//hidden',
  ])('returns 400 for an invalid ref query parameter: %s', async (ref) => {
    vi.mocked(authenticateRequest).mockResolvedValue({ userId: 'user-1', scopes: ['READ'] })

    const response = await GET(
      new Request(`http://localhost/api/v1/resolve?name=test-org/my-skill&ref=${ref}`)
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid ref query parameter. Expected a branch, tag, or 40-character commit SHA.',
    })
  })

  it('accepts a valid branch ref', async () => {
    const { user, org } = await createTestOrgWithOwner()
    await createTestPackage(org.id, user.id, {
      name: 'my-skill',
      slug: `${org.slug}/my-skill`,
    })
    vi.mocked(authenticateRequest).mockResolvedValue({ userId: user.id, scopes: ['READ'] })

    const response = await GET(
      new Request(`http://localhost/api/v1/resolve?name=${org.slug}/my-skill&ref=main`)
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      gitRef: 'main',
      source: 'git',
    })
  })

  it('accepts a valid 40-character commit SHA ref', async () => {
    const commitSha = '0123456789abcdef0123456789abcdef01234567'
    const { user, org } = await createTestOrgWithOwner()
    await createTestPackage(org.id, user.id, {
      name: 'my-skill',
      slug: `${org.slug}/my-skill`,
    })
    vi.mocked(authenticateRequest).mockResolvedValue({ userId: user.id, scopes: ['READ'] })

    const response = await GET(
      new Request(`http://localhost/api/v1/resolve?name=${org.slug}/my-skill&ref=${commitSha}`)
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      gitRef: commitSha,
      source: 'git',
    })
  })
})
