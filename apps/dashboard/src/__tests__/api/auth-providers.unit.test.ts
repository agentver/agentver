import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('GET /api/auth/providers', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET
    delete process.env.GITHUB_CLIENT_ID
    delete process.env.GITHUB_CLIENT_SECRET
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  async function callHandler() {
    // Re-import to pick up current env state
    const { GET } = await import('@/app/api/auth/providers/route')
    const response = GET()
    return response.json()
  }

  it('returns both providers as true when all env vars are set', async () => {
    process.env.GOOGLE_CLIENT_ID = 'google-id'
    process.env.GOOGLE_CLIENT_SECRET = 'google-secret'
    process.env.GITHUB_CLIENT_ID = 'github-id'
    process.env.GITHUB_CLIENT_SECRET = 'github-secret'

    const body = await callHandler()
    expect(body).toEqual({ github: true, google: true })
  })

  it('returns both providers as false when no env vars are set', async () => {
    const body = await callHandler()
    expect(body).toEqual({ github: false, google: false })
  })

  it('returns google true and github false when only Google is configured', async () => {
    process.env.GOOGLE_CLIENT_ID = 'google-id'
    process.env.GOOGLE_CLIENT_SECRET = 'google-secret'

    const body = await callHandler()
    expect(body).toEqual({ github: false, google: true })
  })

  it('returns github true and google false when only GitHub is configured', async () => {
    process.env.GITHUB_CLIENT_ID = 'github-id'
    process.env.GITHUB_CLIENT_SECRET = 'github-secret'

    const body = await callHandler()
    expect(body).toEqual({ github: true, google: false })
  })

  it('returns false when only client ID is set without secret', async () => {
    process.env.GOOGLE_CLIENT_ID = 'google-id'
    process.env.GITHUB_CLIENT_ID = 'github-id'

    const body = await callHandler()
    expect(body).toEqual({ github: false, google: false })
  })
})
