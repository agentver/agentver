import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit/logger'
import { authenticateRequestWithDetails } from '@/lib/auth/api-auth'
import { getGitProvider } from '@/lib/git'
import { deleteSkillFromGitHub } from '@/lib/github/skills-repo'
import { getGitHubToken } from '@/lib/github/token'
import { withCache } from '@/lib/redis/cache'
import { invalidateOnSkillWrite } from '@/lib/redis/invalidation'
import { deliverEvent } from '@/lib/webhooks/service'

const logger = createLogger('api:skills')

const PKG_CACHE_TTL = 120

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ org: string; name: string }> }
) {
  const { org, name } = await params

  const pkg = await withCache(`agentver:pkg:${org}:${name}`, PKG_CACHE_TTL, async () => {
    return prisma.package.findFirst({
      where: {
        name,
        organisation: { slug: org },
        visibility: 'PUBLIC',
      },
      include: {
        organisation: { select: { slug: true, name: true } },
        author: { select: { name: true, image: true } },
        versions: {
          orderBy: { createdAt: 'desc' },
          select: { version: true, changelog: true, createdAt: true, sha256: true },
        },
        _count: { select: { installationReports: true, forks: true } },
      },
    })
  })

  if (!pkg) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(pkg)
}

// ---------------------------------------------------------------------------
// DELETE /api/v1/skills/[org]/[name] — Delete a skill package
// ---------------------------------------------------------------------------

export async function DELETE(
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

  const { userId } = authResponse.result
  const { org, name } = await params

  // Look up the package with organisation and membership details
  const pkg = await prisma.package.findFirst({
    where: {
      name,
      organisation: { slug: org },
    },
    include: {
      organisation: {
        select: {
          id: true,
          slug: true,
          skillsRepoProvider: true,
          skillsRepoOwner: true,
          skillsRepoName: true,
          members: {
            where: { userId, role: { in: ['OWNER', 'ADMIN'] } },
          },
        },
      },
    },
  })

  if (!pkg) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Authorise — must be the package author or an org OWNER/ADMIN
  const isOrgAdmin = pkg.organisation.members.length > 0
  const isAuthor = pkg.authorId === userId

  if (!isOrgAdmin && !isAuthor) {
    return NextResponse.json(
      { error: 'Only the package author or org owners/admins can delete packages' },
      { status: 403 }
    )
  }

  // Best-effort git file cleanup — don't block DB deletion on failure
  try {
    if (pkg.organisation.skillsRepoProvider === 'agentver') {
      await getGitProvider().deleteSkill(org, name, `Deleted package: ${name}`)
    } else if (
      pkg.organisation.skillsRepoProvider === 'github' &&
      pkg.organisation.skillsRepoOwner &&
      pkg.organisation.skillsRepoName
    ) {
      const token = await getGitHubToken(userId)
      if (token) {
        await deleteSkillFromGitHub(
          pkg.organisation.skillsRepoOwner,
          pkg.organisation.skillsRepoName,
          `skills/${name}`,
          `Deleted package: ${name}`,
          token
        )
      } else {
        logger.warn('Skipping GitHub file cleanup — no connected account', {
          userId,
          packageName: name,
        })
      }
    }
  } catch (error) {
    logger.warn('Git file cleanup failed during package deletion', {
      org,
      name,
      provider: pkg.organisation.skillsRepoProvider,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Delete from database
  await prisma.package.delete({ where: { id: pkg.id } })

  logAudit({
    userId,
    action: 'PACKAGE_DELETED',
    resource: 'Package',
    resourceId: pkg.id,
    metadata: { name: pkg.name, slug: pkg.slug },
  })

  invalidateOnSkillWrite(org, name).catch(() => {})

  void deliverEvent(
    pkg.organisation.id,
    'skill.deleted',
    { id: userId, username: '' },
    { skill: { name: pkg.name, slug: pkg.slug } }
  )

  return new NextResponse(null, { status: 204 })
}
