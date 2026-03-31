import { describe, expect, it, vi } from 'vitest'
import { authenticateRequest } from '@/lib/auth/api-auth'
import { GET } from '~/app/api/v1/resolve/route'

vi.mock('@/lib/auth/api-auth', () => ({
  authenticateRequest: vi.fn(),
}))

describe('GET /api/v1/resolve', () => {
  it('returns 400 for an invalid ref query parameter', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ userId: 'user-1', scopes: ['READ'] })

    const response = await GET(
      new Request('http://localhost/api/v1/resolve?name=test-org/my-skill&ref=feature..hidden')
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid ref query parameter. Expected a branch, tag, or 40-character commit SHA.',
    })
  })
})
