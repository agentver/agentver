'use server'

import { randomBytes } from 'node:crypto'
import { prisma } from '@agentver/database'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'

type AuthoriseCliInput = {
  codeChallenge: string
  state: string
  redirectUri: string
}

const ALLOWED_REDIRECT_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/callback$/

export async function authoriseCli(input: AuthoriseCliInput) {
  const session = await getSession()

  if (!session?.user) {
    throw new Error('Not authenticated')
  }

  // Validate redirect URI — only allow localhost / 127.0.0.1
  if (!ALLOWED_REDIRECT_PATTERN.test(input.redirectUri)) {
    throw new Error('Invalid redirect URI')
  }

  // Look up internal user
  const user = await prisma.user.findUnique({ where: { id: session.user.id } })
  if (!user) {
    throw new Error('User not found')
  }

  // Generate a random authorisation code
  const code = randomBytes(32).toString('base64url')

  // Store the auth code with 5-minute expiry
  await prisma.cliAuthCode.create({
    data: {
      code,
      codeChallenge: input.codeChallenge,
      redirectUri: input.redirectUri,
      state: input.state,
      userId: user.id,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    },
  })

  // Redirect to the CLI's callback
  const callbackUrl = new URL(input.redirectUri)
  callbackUrl.searchParams.set('code', code)
  callbackUrl.searchParams.set('state', input.state)

  redirect(callbackUrl.toString())
}
