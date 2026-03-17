import { prisma } from '@agentver/database/client'
import { TRPCError } from '@trpc/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestUser } from '~/test/factories'
import { cleanDatabase, disconnectDatabase } from '~/test/helpers/db'
import { createTestCaller } from '~/test/helpers/trpc'

beforeEach(async () => {
  await cleanDatabase()
})

afterAll(async () => {
  await disconnectDatabase()
})

describe('connections router', () => {
  describe('list', () => {
    it('returns an empty array when the user has no connected accounts', async () => {
      const user = await createTestUser()
      const caller = createTestCaller(user.id)

      const result = await caller.connections.list()

      expect(result).toEqual([])
    })

    it('returns connected accounts with metadata', async () => {
      const user = await createTestUser()

      await prisma.connectedAccount.create({
        data: {
          userId: user.id,
          provider: 'GITHUB',
          providerAccountId: 'gh-123',
          accessToken: 'test-token',
          scopes: ['repo', 'read:user'],
          metadata: { login: 'testuser', avatarUrl: 'https://example.com/avatar.png' },
        },
      })

      const caller = createTestCaller(user.id)
      const result = await caller.connections.list()

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        provider: 'GITHUB',
        providerAccountId: 'gh-123',
      })
    })

    it('returns multiple connected accounts for a user', async () => {
      const user = await createTestUser()

      await prisma.connectedAccount.create({
        data: {
          userId: user.id,
          provider: 'GITHUB',
          providerAccountId: 'gh-123',
          accessToken: 'github-token',
          scopes: ['repo', 'read:user'],
          metadata: { login: 'testuser', avatarUrl: 'https://example.com/avatar.png' },
        },
      })

      await prisma.connectedAccount.create({
        data: {
          userId: user.id,
          provider: 'GITLAB',
          providerAccountId: 'gl-456',
          accessToken: 'gitlab-token',
          scopes: ['read_user'],
          metadata: { login: 'testuser-gl', avatarUrl: 'https://gitlab.com/avatar.png' },
        },
      })

      const caller = createTestCaller(user.id)
      const result = await caller.connections.list()

      expect(result).toHaveLength(2)

      const providers = result.map((account) => account.provider)
      expect(providers).toContain('GITHUB')
      expect(providers).toContain('GITLAB')
    })

    it('only returns accounts belonging to the authenticated user', async () => {
      const user = await createTestUser()
      const otherUser = await createTestUser()

      await prisma.connectedAccount.create({
        data: {
          userId: otherUser.id,
          provider: 'GITHUB',
          providerAccountId: 'gh-other',
          accessToken: 'other-token',
          scopes: ['repo'],
          metadata: { login: 'otheruser', avatarUrl: 'https://example.com/other.png' },
        },
      })

      const caller = createTestCaller(user.id)
      const result = await caller.connections.list()

      expect(result).toHaveLength(0)
    })
  })

  describe('connect', () => {
    it('returns an OAuth URL for GitHub', async () => {
      const user = await createTestUser()
      const caller = createTestCaller(user.id)

      const result = await caller.connections.connect({ provider: 'GITHUB' })

      expect(result).toHaveProperty('url')
      expect(typeof result.url).toBe('string')
      expect(result.url).toContain('github.com')
    })

    it('returns an OAuth URL for GitLab', async () => {
      const user = await createTestUser()
      const caller = createTestCaller(user.id)

      const result = await caller.connections.connect({ provider: 'GITLAB' })

      expect(result).toHaveProperty('url')
      expect(typeof result.url).toBe('string')
      expect(result.url).toContain('gitlab.com')
    })

    it('returns an OAuth URL for Bitbucket', async () => {
      const user = await createTestUser()
      const caller = createTestCaller(user.id)

      const result = await caller.connections.connect({ provider: 'BITBUCKET' })

      expect(result).toHaveProperty('url')
      expect(typeof result.url).toBe('string')
      expect(result.url).toContain('bitbucket.org')
    })

    it('returns an OAuth URL for Google', async () => {
      const user = await createTestUser()
      const caller = createTestCaller(user.id)

      const result = await caller.connections.connect({ provider: 'GOOGLE' })

      expect(result).toHaveProperty('url')
      expect(typeof result.url).toBe('string')
      expect(result.url).toContain('google.com')
    })

    it('returns an OAuth URL for Microsoft', async () => {
      const user = await createTestUser()
      const caller = createTestCaller(user.id)

      const result = await caller.connections.connect({ provider: 'MICROSOFT' })

      expect(result).toHaveProperty('url')
      expect(typeof result.url).toBe('string')
      expect(result.url).toContain('microsoftonline.com')
    })

    it('includes a state parameter in the OAuth URL', async () => {
      const user = await createTestUser()
      const caller = createTestCaller(user.id)

      const result = await caller.connections.connect({ provider: 'GITHUB' })

      const url = new URL(result.url)
      expect(url.searchParams.has('state')).toBe(true)
      expect(url.searchParams.get('state')).toBeTruthy()
    })

    it('includes the client_id in the OAuth URL', async () => {
      const user = await createTestUser()
      const caller = createTestCaller(user.id)

      const result = await caller.connections.connect({ provider: 'GITHUB' })

      const url = new URL(result.url)
      expect(url.searchParams.has('client_id')).toBe(true)
    })
  })

  describe('disconnect', () => {
    it('disconnects a connected account and attempts token revocation', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

      const user = await createTestUser()

      await prisma.connectedAccount.create({
        data: {
          userId: user.id,
          provider: 'GITHUB',
          providerAccountId: 'gh-123',
          accessToken: 'test-token',
          scopes: ['repo', 'read:user'],
          metadata: { login: 'testuser', avatarUrl: 'https://example.com/avatar.png' },
        },
      })

      const caller = createTestCaller(user.id)
      await caller.connections.disconnect({ provider: 'GITHUB' })

      const account = await prisma.connectedAccount.findFirst({
        where: { userId: user.id, provider: 'GITHUB' },
      })

      expect(account).toBeNull()

      vi.unstubAllGlobals()
    })

    it('throws NOT_FOUND when the account is not connected', async () => {
      const user = await createTestUser()
      const caller = createTestCaller(user.id)

      await expect(caller.connections.disconnect({ provider: 'GITHUB' })).rejects.toThrow(TRPCError)

      await expect(caller.connections.disconnect({ provider: 'GITHUB' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })

    it('deletes the account even when token revocation fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

      const user = await createTestUser()

      await prisma.connectedAccount.create({
        data: {
          userId: user.id,
          provider: 'GITHUB',
          providerAccountId: 'gh-123',
          accessToken: 'test-token',
          scopes: ['repo', 'read:user'],
          metadata: { login: 'testuser', avatarUrl: 'https://example.com/avatar.png' },
        },
      })

      const caller = createTestCaller(user.id)
      await caller.connections.disconnect({ provider: 'GITHUB' })

      const account = await prisma.connectedAccount.findFirst({
        where: { userId: user.id, provider: 'GITHUB' },
      })

      expect(account).toBeNull()

      vi.unstubAllGlobals()
    })

    it('only disconnects the account belonging to the authenticated user', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

      const user = await createTestUser()
      const otherUser = await createTestUser()

      await prisma.connectedAccount.create({
        data: {
          userId: otherUser.id,
          provider: 'GITHUB',
          providerAccountId: 'gh-other',
          accessToken: 'other-token',
          scopes: ['repo'],
          metadata: { login: 'otheruser', avatarUrl: 'https://example.com/other.png' },
        },
      })

      const caller = createTestCaller(user.id)

      await expect(caller.connections.disconnect({ provider: 'GITHUB' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })

      const account = await prisma.connectedAccount.findFirst({
        where: { userId: otherUser.id, provider: 'GITHUB' },
      })

      expect(account).not.toBeNull()

      vi.unstubAllGlobals()
    })
  })

  describe('validateToken', () => {
    it('returns valid: true when the provider confirms the token is valid', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))

      const user = await createTestUser()

      await prisma.connectedAccount.create({
        data: {
          userId: user.id,
          provider: 'GITHUB',
          providerAccountId: 'gh-123',
          accessToken: 'valid-token',
          scopes: ['repo', 'read:user'],
          metadata: { login: 'testuser', avatarUrl: 'https://example.com/avatar.png' },
        },
      })

      const caller = createTestCaller(user.id)
      const result = await caller.connections.validateToken({ provider: 'GITHUB' })

      expect(result).toEqual({ valid: true })

      vi.unstubAllGlobals()
    })

    it('returns valid: false with an error when the provider rejects the token', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))

      const user = await createTestUser()

      await prisma.connectedAccount.create({
        data: {
          userId: user.id,
          provider: 'GITHUB',
          providerAccountId: 'gh-123',
          accessToken: 'expired-token',
          scopes: ['repo', 'read:user'],
          metadata: { login: 'testuser', avatarUrl: 'https://example.com/avatar.png' },
        },
      })

      const caller = createTestCaller(user.id)
      const result = await caller.connections.validateToken({ provider: 'GITHUB' })

      expect(result.valid).toBe(false)
      expect(result).toHaveProperty('error')
      expect(typeof (result as { valid: false; error: string }).error).toBe('string')

      vi.unstubAllGlobals()
    })

    it('throws NOT_FOUND when the provider account does not exist', async () => {
      const user = await createTestUser()
      const caller = createTestCaller(user.id)

      await expect(caller.connections.validateToken({ provider: 'GITHUB' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })

    it('returns valid: false when fetch throws a network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')))

      const user = await createTestUser()

      await prisma.connectedAccount.create({
        data: {
          userId: user.id,
          provider: 'GITHUB',
          providerAccountId: 'gh-123',
          accessToken: 'test-token',
          scopes: ['repo', 'read:user'],
          metadata: { login: 'testuser', avatarUrl: 'https://example.com/avatar.png' },
        },
      })

      const caller = createTestCaller(user.id)
      const result = await caller.connections.validateToken({ provider: 'GITHUB' })

      expect(result.valid).toBe(false)
      expect(result).toHaveProperty('error')

      vi.unstubAllGlobals()
    })
  })

  describe('getStatus', () => {
    it('returns connected: true with account details when connected', async () => {
      const user = await createTestUser()

      await prisma.connectedAccount.create({
        data: {
          userId: user.id,
          provider: 'GITHUB',
          providerAccountId: 'gh-123',
          accessToken: 'test-token',
          scopes: ['repo', 'read:user'],
          metadata: { login: 'testuser', avatarUrl: 'https://example.com/avatar.png' },
        },
      })

      const caller = createTestCaller(user.id)
      const result = await caller.connections.getStatus({ provider: 'GITHUB' })

      expect(result.connected).toBe(true)

      if (result.connected) {
        expect(result).toHaveProperty('providerAccountId')
      }
    })

    it('returns connected: false when the account is not connected', async () => {
      const user = await createTestUser()
      const caller = createTestCaller(user.id)

      const result = await caller.connections.getStatus({ provider: 'GITHUB' })

      expect(result.connected).toBe(false)
    })

    it('returns connected: false for a provider the user has not connected', async () => {
      const user = await createTestUser()

      await prisma.connectedAccount.create({
        data: {
          userId: user.id,
          provider: 'GITHUB',
          providerAccountId: 'gh-123',
          accessToken: 'test-token',
          scopes: ['repo', 'read:user'],
          metadata: { login: 'testuser', avatarUrl: 'https://example.com/avatar.png' },
        },
      })

      const caller = createTestCaller(user.id)
      const result = await caller.connections.getStatus({ provider: 'GITLAB' })

      expect(result.connected).toBe(false)
    })

    it(`does not return status for another user's connected account`, async () => {
      const user = await createTestUser()
      const otherUser = await createTestUser()

      await prisma.connectedAccount.create({
        data: {
          userId: otherUser.id,
          provider: 'GITHUB',
          providerAccountId: 'gh-other',
          accessToken: 'other-token',
          scopes: ['repo'],
          metadata: { login: 'otheruser', avatarUrl: 'https://example.com/other.png' },
        },
      })

      const caller = createTestCaller(user.id)
      const result = await caller.connections.getStatus({ provider: 'GITHUB' })

      expect(result.connected).toBe(false)
    })
  })
})
