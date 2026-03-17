import { createLogger } from '@agentver/shared'
import { z } from 'zod'

const logger = createLogger('env')

const isProduction = process.env.NODE_ENV === 'production'

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  TOKEN_ENCRYPTION_KEY: isProduction
    ? z.string().min(1, 'TOKEN_ENCRYPTION_KEY is required in production')
    : z.string().optional(),
  ALLOWED_SIGNUP_DOMAINS: z.string().optional(), // Comma-separated list of allowed email domains
  // Optional but validated if present
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITLAB_CLIENT_ID: z.string().optional(),
  GITLAB_CLIENT_SECRET: z.string().optional(),
  BITBUCKET_CLIENT_ID: z.string().optional(),
  BITBUCKET_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  STORAGE_ADAPTER: z.enum(['gcs', 's3', 'azure', 'local']).optional(),
  STORAGE_PATH: z.string().optional(),
  EMAIL_PROVIDER: z.enum(['console', 'smtp']).optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  PLATFORM_ADMIN_EMAILS: z.string().optional(),
  // Stripe (cloud edition only)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

const oauthProviders = [
  { name: 'GitHub', idKey: 'GITHUB_CLIENT_ID', secretKey: 'GITHUB_CLIENT_SECRET' },
  { name: 'GitLab', idKey: 'GITLAB_CLIENT_ID', secretKey: 'GITLAB_CLIENT_SECRET' },
  { name: 'Bitbucket', idKey: 'BITBUCKET_CLIENT_ID', secretKey: 'BITBUCKET_CLIENT_SECRET' },
  { name: 'Google', idKey: 'GOOGLE_CLIENT_ID', secretKey: 'GOOGLE_CLIENT_SECRET' },
  { name: 'Microsoft', idKey: 'MICROSOFT_CLIENT_ID', secretKey: 'MICROSOFT_CLIENT_SECRET' },
] as const

function validateOAuthProviders(envVars: Record<string, string | undefined>): void {
  for (const provider of oauthProviders) {
    const hasId = Boolean(envVars[provider.idKey])
    const hasSecret = Boolean(envVars[provider.secretKey])

    if (hasId && !hasSecret) {
      logger.warn(
        `${provider.name} OAuth is partially configured: ${provider.idKey} is set but ${provider.secretKey} is missing`
      )
    } else if (!hasId && hasSecret) {
      logger.warn(
        `${provider.name} OAuth is partially configured: ${provider.secretKey} is set but ${provider.idKey} is missing`
      )
    }
  }
}

let _env: Env | null = null

/**
 * Lazily validated environment variables.
 * Validation runs on first access rather than module load,
 * allowing builds to succeed without server-side secrets.
 */
export function getEnv(): Env {
  if (_env) return _env

  const parsed = envSchema.safeParse(process.env)

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors
    const formatted = Object.entries(errors)
      .map(([key, messages]) => `  ${key}: ${messages?.join(', ')}`)
      .join('\n')

    logger.error(`Environment variable validation failed:\n${formatted}`)
    throw new Error(`Missing or invalid environment variables:\n${formatted}`)
  }

  validateOAuthProviders(process.env as Record<string, string | undefined>)

  _env = parsed.data
  return _env
}

/**
 * Proxy that lazily validates on first property access.
 * Drop-in replacement for the previous eagerly-validated `env` export.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    return getEnv()[prop as keyof Env]
  },
})
