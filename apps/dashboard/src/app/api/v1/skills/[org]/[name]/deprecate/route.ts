import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { logAudit } from '@/lib/audit/logger'
import { authenticateRequestWithDetails } from '@/lib/auth/api-auth'
import { invalidateOnSkillWrite } from '@/lib/redis/invalidation'

const logger = createLogger('api:skill-deprecate')

const requestSchema = z.object({
  message: z.string().max(500).optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ org: string; name: string }> }
) {
  const authResponse = await authenticateRequestWithDetails(request)
  if (!authResponse.ok) {
    return NextResponse.json(
      { error: authResponse.error.message },
      { status: authResponse.error.status }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { org, name } = await params
  const { userId } = authResponse.result

  const pkg = await prisma.package.findFirst({
    where: {
      name,
      organisation: { slug: org },
    },
    include: {
      organisation: {
        select: {
          members: {
            where: { userId, role: { in: ['OWNER', 'ADMIN'] } },
          },
        },
      },
    },
  })

  if (!pkg) {
    return NextResponse.json({ error: 'Package not found' }, { status: 404 })
  }

  const isAuthor = pkg.authorId === userId
  const isOrgAdmin = pkg.organisation.members.length > 0
  if (!isAuthor && !isOrgAdmin) {
    return NextResponse.json(
      { error: 'Only the package author or organisation admins can deprecate packages' },
      { status: 403 }
    )
  }

  try {
    await prisma.package.update({
      where: { id: pkg.id },
      data: {
        status: 'DEPRECATED',
        deprecationNote: parsed.data.message ?? null,
      },
    })

    logAudit({
      userId,
      action: 'PACKAGE_DEPRECATED',
      resource: 'Package',
      resourceId: pkg.id,
      metadata: {
        name: pkg.name,
        slug: pkg.slug,
        deprecationNote: parsed.data.message,
      },
    })

    invalidateOnSkillWrite(org, name).catch(() => {})

    return NextResponse.json({
      status: 'DEPRECATED',
      message: parsed.data.message ?? null,
    })
  } catch (error) {
    logger.error('Failed to deprecate package', {
      org,
      name,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to deprecate package' }, { status: 500 })
  }
}
