import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { logAudit } from '@/lib/audit/logger'
import { decryptToken, TokenDecryptionError } from '@/lib/crypto/token-encryption'
import { protectedProcedure, router } from '../init'

const logger = createLogger('connections-router')

const providerSchema = z.enum(['GITHUB', 'GITLAB', 'BITBUCKET', 'GOOGLE', 'MICROSOFT'])

type ProviderValue = z.infer<typeof providerSchema>

function getGitHubOAuthUrl(state: string): string {
  const clientId = process.env.GITHUB_CLIENT_ID
  if (!clientId) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'GitHub OAuth is not configured',
    })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
  const redirectUri = `${baseUrl}/api/auth/github/callback`
  const scopes = 'repo read:user user:email'

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    state,
  })

  return `https://github.com/login/oauth/authorize?${params.toString()}`
}

function getGitLabOAuthUrl(state: string): string {
  const clientId = process.env.GITLAB_CLIENT_ID
  if (!clientId) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'GitLab OAuth is not configured',
    })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
  const redirectUri = `${baseUrl}/api/auth/gitlab/callback`
  const scopes = 'read_user read_api read_repository'

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    state,
  })

  return `https://gitlab.com/oauth/authorize?${params.toString()}`
}

function getBitbucketOAuthUrl(state: string): string {
  const clientId = process.env.BITBUCKET_CLIENT_ID
  if (!clientId) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Bitbucket OAuth is not configured',
    })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
  const redirectUri = `${baseUrl}/api/auth/bitbucket/callback`
  const scopes = 'repository account'

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    state,
  })

  return `https://bitbucket.org/site/oauth2/authorize?${params.toString()}`
}

function getGoogleOAuthUrl(state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Google OAuth is not configured',
    })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? `${baseUrl}/api/auth/google/callback`

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.readonly openid email profile',
    state,
    access_type: 'offline',
    prompt: 'consent',
  })

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

function getMicrosoftOAuthUrl(state: string): string {
  const clientId = process.env.MICROSOFT_CLIENT_ID
  if (!clientId) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Microsoft OAuth is not configured',
    })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI ?? `${baseUrl}/api/auth/microsoft/callback`

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'Files.Read.All offline_access User.Read',
    state,
  })

  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`
}

function getOAuthUrl(provider: ProviderValue, state: string): string {
  switch (provider) {
    case 'GITHUB':
      return getGitHubOAuthUrl(state)
    case 'GITLAB':
      return getGitLabOAuthUrl(state)
    case 'BITBUCKET':
      return getBitbucketOAuthUrl(state)
    case 'GOOGLE':
      return getGoogleOAuthUrl(state)
    case 'MICROSOFT':
      return getMicrosoftOAuthUrl(state)
  }
}

export const connectionsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const accounts = await prisma.connectedAccount.findMany({
      where: { userId: ctx.user.id },
      select: {
        id: true,
        provider: true,
        providerAccountId: true,
        scopes: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    return accounts.map((account) => {
      const metadata = account.metadata as Record<string, unknown> | null

      return {
        id: account.id,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        providerAccountName: (metadata?.login as string) ?? (metadata?.name as string) ?? null,
        avatarUrl: (metadata?.avatarUrl as string) ?? null,
        scopes: account.scopes,
        connectedAt: account.createdAt,
        updatedAt: account.updatedAt,
      }
    })
  }),

  connect: protectedProcedure
    .input(z.object({ provider: providerSchema }))
    .mutation(async ({ ctx, input }) => {
      const state = `${ctx.user.id}:${crypto.randomUUID()}`

      logger.info('Initiating OAuth connection', {
        userId: ctx.user.id,
        provider: input.provider,
      })

      const url = getOAuthUrl(input.provider, state)

      return { url, state }
    }),

  disconnect: protectedProcedure
    .input(z.object({ provider: providerSchema }))
    .mutation(async ({ ctx, input }) => {
      const account = await prisma.connectedAccount.findUnique({
        where: {
          userId_provider: {
            userId: ctx.user.id,
            provider: input.provider,
          },
        },
      })

      if (!account) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `No ${input.provider} account connected`,
        })
      }

      let plainToken: string | null = null
      try {
        plainToken = decryptToken(account.accessToken)
      } catch (error) {
        if (error instanceof TokenDecryptionError) {
          logger.warn('Could not decrypt token for revocation — proceeding with disconnect', {
            userId: ctx.user.id,
            provider: input.provider,
          })
        } else {
          throw error
        }
      }

      if (plainToken && input.provider === 'GITHUB') {
        try {
          const clientId = process.env.GITHUB_CLIENT_ID
          const clientSecret = process.env.GITHUB_CLIENT_SECRET

          if (clientId && clientSecret) {
            await fetch(`https://api.github.com/applications/${clientId}/token`, {
              method: 'DELETE',
              headers: {
                Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
                Accept: 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ access_token: plainToken }),
            })
          }
        } catch (error) {
          logger.warn('Failed to revoke GitHub token', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      if (plainToken && input.provider === 'BITBUCKET') {
        try {
          const clientId = process.env.BITBUCKET_CLIENT_ID
          const clientSecret = process.env.BITBUCKET_CLIENT_SECRET

          if (clientId && clientSecret) {
            await fetch('https://bitbucket.org/site/oauth2/revoke', {
              method: 'POST',
              headers: {
                Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({ token: plainToken }),
            })
          }
        } catch (error) {
          logger.warn('Failed to revoke Bitbucket token', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      if (plainToken && input.provider === 'GITLAB') {
        try {
          const clientId = process.env.GITLAB_CLIENT_ID
          const clientSecret = process.env.GITLAB_CLIENT_SECRET

          if (clientId && clientSecret) {
            await fetch('https://gitlab.com/oauth/revoke', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                client_id: clientId,
                client_secret: clientSecret,
                token: plainToken,
              }),
            })
          }
        } catch (error) {
          logger.warn('Failed to revoke GitLab token', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      if (plainToken && input.provider === 'GOOGLE') {
        try {
          await fetch(
            `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(plainToken)}`,
            { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
          )
        } catch (error) {
          logger.warn('Failed to revoke Google token', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      if (input.provider === 'MICROSOFT') {
        // Microsoft does not expose a universal token revocation endpoint for
        // consumer accounts; simply deleting the stored tokens is the standard
        // approach for disconnecting OneDrive integrations.
        logger.info('Microsoft token removed (no revocation endpoint)', {
          userId: ctx.user.id,
        })
      }

      await prisma.connectedAccount.delete({
        where: { id: account.id },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'CONNECTION_DISCONNECTED',
        resource: 'ConnectedAccount',
        resourceId: account.id,
        metadata: { provider: input.provider },
      })

      logger.info('Disconnected account', {
        userId: ctx.user.id,
        provider: input.provider,
      })

      return { success: true }
    }),

  validateToken: protectedProcedure
    .input(z.object({ provider: providerSchema }))
    .mutation(async ({ ctx, input }) => {
      const account = await prisma.connectedAccount.findUnique({
        where: {
          userId_provider: {
            userId: ctx.user.id,
            provider: input.provider,
          },
        },
        select: { accessToken: true },
      })

      if (!account) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `No ${input.provider} account connected`,
        })
      }

      let validationToken: string
      try {
        validationToken = decryptToken(account.accessToken)
      } catch (error) {
        if (error instanceof TokenDecryptionError) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Connected account credentials are invalid. Please reconnect your account.',
          })
        }
        throw error
      }

      try {
        let response: Response

        switch (input.provider) {
          case 'GITHUB':
            response = await fetch('https://api.github.com/user', {
              headers: {
                Authorization: `Bearer ${validationToken}`,
                Accept: 'application/vnd.github.v3+json',
              },
            })
            break
          case 'GITLAB':
            response = await fetch('https://gitlab.com/api/v4/user', {
              headers: { Authorization: `Bearer ${validationToken}` },
            })
            break
          case 'BITBUCKET':
            response = await fetch('https://api.bitbucket.org/2.0/user', {
              headers: {
                Authorization: `Bearer ${validationToken}`,
                Accept: 'application/json',
              },
            })
            break
          case 'GOOGLE':
            response = await fetch(
              `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(validationToken)}`
            )
            break
          case 'MICROSOFT':
            response = await fetch('https://graph.microsoft.com/v1.0/me', {
              headers: {
                Authorization: `Bearer ${validationToken}`,
                Accept: 'application/json',
              },
            })
            break
        }

        if (response.ok) {
          return { valid: true }
        }

        logger.warn('Token validation failed', {
          userId: ctx.user.id,
          provider: input.provider,
          status: response.status,
        })

        return { valid: false, error: `Token returned ${response.status}` }
      } catch (error) {
        logger.error('Token validation error', {
          userId: ctx.user.id,
          provider: input.provider,
          error: error instanceof Error ? error.message : String(error),
        })

        return { valid: false, error: 'Failed to reach provider' }
      }
    }),

  getStatus: protectedProcedure
    .input(z.object({ provider: providerSchema }))
    .query(async ({ ctx, input }) => {
      const account = await prisma.connectedAccount.findUnique({
        where: {
          userId_provider: {
            userId: ctx.user.id,
            provider: input.provider,
          },
        },
        select: {
          id: true,
          providerAccountId: true,
          metadata: true,
          scopes: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      if (!account) {
        return { connected: false as const, provider: input.provider }
      }

      const metadata = account.metadata as Record<string, unknown> | null

      return {
        connected: true as const,
        provider: input.provider,
        providerAccountId: account.providerAccountId,
        providerAccountName: (metadata?.login as string) ?? (metadata?.name as string) ?? null,
        avatarUrl: (metadata?.avatarUrl as string) ?? null,
        scopes: account.scopes,
        connectedAt: account.createdAt,
        updatedAt: account.updatedAt,
      }
    }),
})
