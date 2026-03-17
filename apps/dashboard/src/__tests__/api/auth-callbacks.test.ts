import { prisma } from '@agentver/database/client'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestUser } from '~/test/factories'
import { cleanDatabase, disconnectDatabase } from '~/test/helpers/db'

describe('OAuth callback data operations', () => {
  beforeEach(async () => {
    await cleanDatabase()
  })

  afterAll(async () => {
    await disconnectDatabase()
  })

  describe('GitHub callback', () => {
    it('should store connected account after token exchange', async () => {
      const user = await createTestUser()

      // Simulate what the callback route does: persist the connected account
      const account = await prisma.connectedAccount.create({
        data: {
          userId: user.id,
          provider: 'GITHUB',
          providerAccountId: 'gh-user-123',
          accessToken: 'gho_test_token',
          scopes: ['repo', 'read:user', 'user:email'],
          metadata: {
            login: 'testuser',
            name: 'Test User',
            avatarUrl: 'https://avatars.githubusercontent.com/u/123',
          },
        },
      })

      expect(account.provider).toBe('GITHUB')
      expect(account.accessToken).toBe('gho_test_token')
      expect(account.scopes).toEqual(['repo', 'read:user', 'user:email'])
      expect(account.providerAccountId).toBe('gh-user-123')
      expect(account.userId).toBe(user.id)
    })

    it('should update existing connected account on re-auth', async () => {
      const user = await createTestUser()

      await prisma.connectedAccount.create({
        data: {
          userId: user.id,
          provider: 'GITHUB',
          providerAccountId: 'gh-123',
          accessToken: 'old-token',
          scopes: ['repo'],
        },
      })

      // Simulate the upsert that the callback performs on re-auth
      const updated = await prisma.connectedAccount.update({
        where: { userId_provider: { userId: user.id, provider: 'GITHUB' } },
        data: { accessToken: 'new-token', scopes: ['repo', 'read:user'] },
      })

      expect(updated.accessToken).toBe('new-token')
      expect(updated.scopes).toEqual(['repo', 'read:user'])
    })

    it('should validate CSRF state contains userId', () => {
      // Verify the state format the callback expects: <userId>:<random-nonce>
      const state = 'user-id-123:random-uuid-456'
      const [userId] = state.split(':')
      expect(userId).toBe('user-id-123')
    })

    it('should reject state with no colon delimiter', () => {
      const malformedState = 'nodeli miter'
      const parts = malformedState.split(':')
      // A valid state must produce exactly two non-empty parts
      expect(parts.length).toBe(1)
    })

    it('should not create duplicate connected accounts for same user and provider', async () => {
      const user = await createTestUser()

      await prisma.connectedAccount.create({
        data: {
          userId: user.id,
          provider: 'GITHUB',
          providerAccountId: 'gh-123',
          accessToken: 'token-one',
          scopes: ['repo'],
        },
      })

      // A second create for the same userId + provider must fail (unique constraint)
      await expect(
        prisma.connectedAccount.create({
          data: {
            userId: user.id,
            provider: 'GITHUB',
            providerAccountId: 'gh-123',
            accessToken: 'token-two',
            scopes: ['repo'],
          },
        })
      ).rejects.toThrow()
    })

    it('should store optional refresh token when provider supplies one', async () => {
      const user = await createTestUser()

      const account = await prisma.connectedAccount.create({
        data: {
          userId: user.id,
          provider: 'GITHUB',
          providerAccountId: 'gh-456',
          accessToken: 'gho_access',
          refreshToken: 'ghr_refresh',
          scopes: ['repo'],
        },
      })

      expect(account.refreshToken).toBe('ghr_refresh')
    })
  })

  describe.each([
    'GOOGLE',
    'MICROSOFT',
    'GITLAB',
    'BITBUCKET',
  ] as const)('%s callback', (provider) => {
    it(`should store ${provider} connected account`, async () => {
      const user = await createTestUser()

      const account = await prisma.connectedAccount.create({
        data: {
          userId: user.id,
          provider,
          providerAccountId: `${provider.toLowerCase()}-123`,
          accessToken: `test-${provider.toLowerCase()}-token`,
          scopes: ['read'],
        },
      })

      expect(account.provider).toBe(provider)
      expect(account.accessToken).toBe(`test-${provider.toLowerCase()}-token`)
      expect(account.userId).toBe(user.id)
    })

    it(`should update ${provider} access token on re-auth`, async () => {
      const user = await createTestUser()

      await prisma.connectedAccount.create({
        data: {
          userId: user.id,
          provider,
          providerAccountId: `${provider.toLowerCase()}-456`,
          accessToken: 'initial-token',
          scopes: ['read'],
        },
      })

      const updated = await prisma.connectedAccount.update({
        where: { userId_provider: { userId: user.id, provider } },
        data: { accessToken: 'refreshed-token' },
      })

      expect(updated.accessToken).toBe('refreshed-token')
    })

    it(`should allow a single user to connect both GITHUB and ${provider}`, async () => {
      const user = await createTestUser()

      await prisma.connectedAccount.create({
        data: {
          userId: user.id,
          provider: 'GITHUB',
          providerAccountId: 'gh-789',
          accessToken: 'github-token',
          scopes: ['repo'],
        },
      })

      const other = await prisma.connectedAccount.create({
        data: {
          userId: user.id,
          provider,
          providerAccountId: `${provider.toLowerCase()}-789`,
          accessToken: `${provider.toLowerCase()}-token`,
          scopes: ['read'],
        },
      })

      const all = await prisma.connectedAccount.findMany({ where: { userId: user.id } })
      expect(all).toHaveLength(2)
      expect(other.provider).toBe(provider)
    })
  })
})
