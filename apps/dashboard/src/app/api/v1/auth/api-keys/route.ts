import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '@agentver/database'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest } from '@/lib/auth/api-auth'

const createApiKeyBodySchema = z.object({
  name: z.string().min(1),
  organisationId: z.string().uuid(),
  scopes: z
    .array(z.enum(['READ', 'WRITE', 'ADMIN']))
    .optional()
    .default(['READ']),
})

export async function POST(request: Request) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const result = createApiKeyBodySchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { name, scopes, organisationId } = result.data

  const membership = await prisma.organisationMember.findFirst({
    where: { organisationId, userId: authResult.userId },
    select: { id: true },
  })

  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this organisation' }, { status: 403 })
  }

  const rawKey = `av_${randomBytes(32).toString('hex')}`
  const keyHash = createHash('sha256').update(rawKey).digest('hex')
  const keyPrefix = rawKey.slice(0, 10)

  await prisma.apiKey.create({
    data: {
      name,
      keyHash,
      keyPrefix,
      scopes,
      userId: authResult.userId,
      organisationId,
    },
  })

  return NextResponse.json({ key: rawKey, prefix: keyPrefix })
}
