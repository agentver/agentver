import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { logAudit } from '@/lib/audit/logger'
import { authenticateRequestWithDetails } from '@/lib/auth/api-auth'
import { invalidateOnSkillWrite } from '@/lib/redis/invalidation'

const logger = createLogger('api:version-deprecate')

const requestSchema = z.object({
  message: z.string().max(500).optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ org: string; name: string; version: string }> }
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

  const { org, name, version } = await params
  const { userId } = authResponse.result

  const pkgVersion = await prisma.packageVersion.findFirst({
    where: {
      version,
      package: {
        name,
        organisation: { slug: org },
      },
    },
    include: {
      package: {
        include: {
          organisation: {
            select: {
              members: {
                where: { userId, role: { in: ['OWNER', 'ADMIN'] } },
              },
            },
          },
        },
      },
    },
  })

  if (!pkgVersion) {
    return NextResponse.json({ error: 'Version not found' }, { status: 404 })
  }

  const isAuthor = pkgVersion.package.authorId === userId
  const isOrgAdmin = pkgVersion.package.organisation.members.length > 0
  if (!isAuthor && !isOrgAdmin) {
    return NextResponse.json(
      { error: 'Only the package author or organisation admins can deprecate versions' },
      { status: 403 }
    )
  }

  try {
    await prisma.packageVersion.update({
      where: { id: pkgVersion.id },
      data: {
        status: 'DEPRECATED',
        ...(parsed.data.message ? { changelog: parsed.data.message } : {}),
      },
    })

    logAudit({
      userId,
      action: 'VERSION_DEPRECATED',
      resource: 'PackageVersion',
      resourceId: pkgVersion.id,
      metadata: {
        packageId: pkgVersion.packageId,
        version: pkgVersion.version,
        message: parsed.data.message,
      },
    })

    invalidateOnSkillWrite(org, name).catch(() => {})

    return NextResponse.json({
      version: pkgVersion.version,
      status: 'DEPRECATED',
      message: parsed.data.message ?? null,
    })
  } catch (error) {
    logger.error('Failed to deprecate version', {
      org,
      name,
      version,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to deprecate version' }, { status: 500 })
  }
}
