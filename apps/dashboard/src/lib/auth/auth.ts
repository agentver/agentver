import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { nextCookies } from 'better-auth/next-js'
import { getEmailProvider } from '../email'
import { buildPasswordResetEmail } from '../email/templates/password-reset'

const logger = createLogger('auth')

const PASSWORD_RESET_TOKEN_EXPIRES_IN_SECONDS = 3600

const allowedDomains = process.env.ALLOWED_SIGNUP_DOMAINS
  ? process.env.ALLOWED_SIGNUP_DOMAINS.split(',').map((d) => d.trim().toLowerCase())
  : null

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  baseURL: process.env.APP_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    resetPasswordTokenExpiresIn: PASSWORD_RESET_TOKEN_EXPIRES_IN_SECONDS,
    sendResetPassword: async ({ user, url }) => {
      const emailProvider = getEmailProvider()
      const message = buildPasswordResetEmail({
        recipientEmail: user.email,
        resetUrl: url,
        expiresInMinutes: PASSWORD_RESET_TOKEN_EXPIRES_IN_SECONDS / 60,
      })
      try {
        await emailProvider.send(message)
      } catch (error) {
        logger.error('Failed to send password reset email', { email: user.email, error })
      }
    },
    ...(allowedDomains
      ? {
          signUp: {
            enabled: true,
          },
        }
      : {}),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (!allowedDomains) return true
          const domain = user.email.split('@')[1]?.toLowerCase()
          if (domain && allowedDomains.includes(domain)) return true
          return false
        },
      },
    },
  },
  socialProviders: {
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  plugins: [nextCookies()],
})

export type Session = typeof auth.$Infer.Session
