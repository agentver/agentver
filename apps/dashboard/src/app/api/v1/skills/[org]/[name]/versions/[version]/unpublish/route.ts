import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { NextResponse } from 'next/server'
import { semverSchema } from '@/lib/api/validation'
import { logAudit } from '@/lib/audit/logger'
import { authenticateRequestWithDetails } from '@/lib/auth/api-auth'
import { invalidateOnSkillWrite } from '@/lib/redis/invalidation'

const logger = createLogger('api:version-unpublish')

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

  const { org, name, version } = await params
  const parsedVersion = semverSchema.safeParse(version)
  if (!parsedVersion.success) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        details: { version: parsedVersion.error.issues.map((issue) => issue.message) },
      },
      { status: 400 }
    )
  }
  const { userId } = authResponse.result

  const pkgVersion = await prisma.packageVersion.findFirst({
    where: {
      version: parsedVersion.data,
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
      { error: 'Only the package author or organisation admins can unpublish versions' },
      { status: 403 }
    )
  }

  try {
    await prisma.packageVersion.update({
      where: { id: pkgVersion.id },
      data: { status: 'YANKED' },
    })

    logAudit({
      userId,
      action: 'VERSION_YANKED',
      resource: 'PackageVersion',
      resourceId: pkgVersion.id,
      metadata: {
        packageId: pkgVersion.packageId,
        version: pkgVersion.version,
      },
    })

    invalidateOnSkillWrite(org, name).catch(() => {})

    return NextResponse.json({
      version: pkgVersion.version,
      status: 'YANKED',
    })
  } catch (error) {
    logger.error('Failed to unpublish version', {
      org,
      name,
      version: parsedVersion.data,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to unpublish version' }, { status: 500 })
  }
}
