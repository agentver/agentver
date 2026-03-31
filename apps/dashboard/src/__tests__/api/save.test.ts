import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticateRequest } from '@/lib/auth/api-auth'
import { POST } from '~/app/api/v1/skills/[org]/[name]/save/route'
import { createTestOrgWithOwner } from '~/test/factories'
import { cleanDatabase, disconnectDatabase } from '~/test/helpers/db'

vi.mock('@/lib/auth/api-auth', () => ({
  authenticateRequest: vi.fn(),
}))

vi.mock('@/lib/git', () => ({
  getGitProvider: vi.fn(),
}))

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/skills/test-org/my-skill/save', {
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

describe('POST /api/v1/skills/[org]/[name]/save', () => {
  it('returns 400 for an invalid git ref', async () => {
    const { user, org } = await createTestOrgWithOwner()

    vi.mocked(authenticateRequest).mockResolvedValue({ userId: user.id, scopes: ['WRITE'] })

    const response = await POST(
      makeRequest({
        message: 'Save skill',
        ref: 'refs/../../secrets',
        files: [{ path: 'SKILL.md', content: '# Skill' }],
      }),
      { params: Promise.resolve({ org: org.slug, name: 'my-skill' }) }
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Validation failed',
      details: {
        ref: ['Invalid ref format'],
      },
    })
  })
})
