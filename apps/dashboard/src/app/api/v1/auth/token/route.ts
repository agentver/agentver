import { createHash } from 'node:crypto'
import { prisma } from '@agentver/database'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const tokenRequestSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
})

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = tokenRequestSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { apiKey } = parsed.data
  const keyHash = createHash('sha256').update(apiKey).digest('hex')

  const key = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: {
      user: { select: { id: true, email: true, name: true } },
      organisation: { select: { id: true, slug: true, name: true } },
    },
  })

  if (!key) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
  }

  if (key.expiresAt && key.expiresAt < new Date()) {
    return NextResponse.json({ error: 'API key has expired' }, { status: 401 })
  }

  await prisma.apiKey.update({
    where: { id: key.id },
    data: { lastUsedAt: new Date() },
  })

  return NextResponse.json({
    accessToken: apiKey,
    tokenType: 'Bearer',
    scopes: key.scopes,
    user: key.user,
    organisation: key.organisation,
  })
}
