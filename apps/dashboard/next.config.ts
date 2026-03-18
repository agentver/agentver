import type { NextConfig } from 'next'

const config: NextConfig = {
  output: 'standalone',
  serverExternalPackages: [
    '@prisma/client',
    'pg',
    '@agentver/database',
    'ioredis',
    'nodemailer',
    'postmark',
  ],
  env: {
    NEXT_PUBLIC_AGENTVER_CLOUD: process.env.AGENTVER_CLOUD ?? '',
    NEXT_PUBLIC_PLATFORM_ADMIN_EMAILS: process.env.PLATFORM_ADMIN_EMAILS ?? '',
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ]
  },
}

export default config
