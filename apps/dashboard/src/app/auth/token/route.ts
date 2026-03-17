import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '@agentver/database'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const tokenExchangeSchema = z.object({
  grant_type: z.literal('authorization_code'),
  code: z.string().min(1),
  code_verifier: z.string().min(1),
  redirect_uri: z.string().min(1),
})

const ALLOWED_REDIRECT_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/callback$/

function sha256Base64Url(input: string): string {
  return createHash('sha256').update(input).digest('base64url')
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = tokenExchangeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { code, code_verifier, redirect_uri } = parsed.data

  // Validate redirect URI — only allow localhost / 127.0.0.1
  if (!ALLOWED_REDIRECT_PATTERN.test(redirect_uri)) {
    return NextResponse.json({ error: 'Invalid redirect URI' }, { status: 400 })
  }

  // Find the auth code
  const authCode = await prisma.cliAuthCode.findUnique({ where: { code } })

  if (!authCode) {
    return NextResponse.json({ error: 'Invalid authorisation code' }, { status: 400 })
  }

  // Check expiry
  if (authCode.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Authorisation code has expired' }, { status: 400 })
  }

  // Check if already used
  if (authCode.usedAt) {
    return NextResponse.json({ error: 'Authorisation code has already been used' }, { status: 400 })
  }

  // Verify redirect URI matches
  if (authCode.redirectUri !== redirect_uri) {
    return NextResponse.json({ error: 'Redirect URI mismatch' }, { status: 400 })
  }

  // PKCE verification: hash the code_verifier and compare to stored code_challenge
  const computedChallenge = sha256Base64Url(code_verifier)
  if (computedChallenge !== authCode.codeChallenge) {
    return NextResponse.json({ error: 'PKCE verification failed' }, { status: 400 })
  }

  // Mark code as used
  await prisma.cliAuthCode.update({
    where: { id: authCode.id },
    data: { usedAt: new Date() },
  })

  // Generate a session token
  const token = randomBytes(48).toString('base64url')
  const tokenHash = hashToken(token)

  // Create CLI session (no expiry by default — long-lived)
  await prisma.cliSession.create({
    data: {
      userId: authCode.userId,
      tokenHash,
      name: 'CLI',
    },
  })

  return NextResponse.json({
    access_token: token,
    token_type: 'Bearer',
  })
}
