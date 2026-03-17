import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { logAudit } from '@/lib/audit/logger'
import { authenticateRequest } from '@/lib/auth/api-auth'
import { getGitProvider } from '@/lib/git'
import { validateRepoAccess } from '@/lib/github/skills-repo'
import { getGitHubToken } from '@/lib/github/token'

const logger = createLogger('api:org:skills-repo')

type RouteContext = {
  params: Promise<{ orgId: string }>
}

const connectRepoSchema = z.object({
  url: z.string().url().optional(),
  owner: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  provider: z.enum(['github', 'gitlab', 'bitbucket', 'agentver']).default('github'),
})

/**
 * Resolve the org and verify the user's membership.
 * Returns the org and membership, or a NextResponse error.
 */
async function resolveOrgMembership(orgId: string, userId: string, requiredRoles?: string[]) {
  const org = await prisma.organisation.findUnique({
    where: { id: orgId },
    include: {
      members: { where: { userId } },
    },
  })

  if (!org) {
    return { error: NextResponse.json({ error: 'Organisation not found' }, { status: 404 }) }
  }

  const membership = org.members[0]
  if (!membership) {
    return {
      error: NextResponse.json({ error: 'Not a member of this organisation' }, { status: 403 }),
    }
  }

  if (requiredRoles && !requiredRoles.includes(membership.role)) {
    return {
      error: NextResponse.json(
        { error: 'Insufficient permissions. Admin or owner role required.' },
        { status: 403 }
      ),
    }
  }

  return { org, membership }
}

/**
 * GET /api/v1/org/[orgId]/skills-repo
 * Returns the current skills repo configuration for the organisation.
 */
export async function GET(request: Request, { params }: RouteContext) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { orgId } = await params
  const result = await resolveOrgMembership(orgId, authResult.userId)

  if ('error' in result) {
    return result.error
  }

  const { org } = result

  return NextResponse.json({
    connected: Boolean(org.skillsRepoUrl),
    url: org.skillsRepoUrl,
    owner: org.skillsRepoOwner,
    name: org.skillsRepoName,
    provider: org.skillsRepoProvider,
  })
}

/**
 * PUT /api/v1/org/[orgId]/skills-repo
 * Connect or update the organisation's skills repository.
 * Requires OWNER or ADMIN role.
 */
export async function PUT(request: Request, { params }: RouteContext) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { orgId } = await params
  const result = await resolveOrgMembership(orgId, authResult.userId, ['OWNER', 'ADMIN'])

  if ('error' in result) {
    return result.error
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = connectRepoSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { url, owner, name, provider } = parsed.data

  if (provider === 'agentver') {
    const org = await prisma.organisation.findUnique({
      where: { id: orgId },
      select: { slug: true, name: true },
    })

    if (!org) {
      return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })
    }

    try {
      await getGitProvider().createNamespace(org.slug, org.name)
    } catch (error) {
      logger.error('Failed to create Forgejo namespace', {
        slug: org.slug,
        error: error instanceof Error ? error.message : String(error),
      })
      return NextResponse.json(
        { error: 'Failed to provision Agentver storage. Please try again later.' },
        { status: 500 }
      )
    }

    const agentverUrl = `agentver://${org.slug}`

    await prisma.organisation.update({
      where: { id: orgId },
      data: {
        skillsRepoUrl: agentverUrl,
        skillsRepoOwner: null,
        skillsRepoName: null,
        skillsRepoProvider: 'agentver',
      },
    })

    logAudit({
      userId: authResult.userId,
      action: 'SKILLS_REPO_CONNECTED',
      resource: 'organisation',
      resourceId: orgId,
      metadata: { skillsRepoUrl: agentverUrl, provider: 'agentver' },
    })

    logger.info('Skills repo connected (agentver)', { orgId, url: agentverUrl })

    return NextResponse.json({
      connected: true,
      url: agentverUrl,
      owner: null,
      name: null,
      provider: 'agentver',
    })
  }

  if (provider !== 'github') {
    return NextResponse.json(
      { error: 'Only GitHub and Agentver providers are currently supported' },
      { status: 400 }
    )
  }

  if (!url || !owner || !name) {
    return NextResponse.json(
      { error: 'Repository URL, owner, and name are required for GitHub provider' },
      { status: 400 }
    )
  }

  const token = await getGitHubToken(authResult.userId)
  if (!token) {
    return NextResponse.json(
      { error: 'No connected GitHub account. Please connect your GitHub account first.' },
      { status: 400 }
    )
  }

  const hasAccess = await validateRepoAccess(owner, name, token)
  if (!hasAccess) {
    return NextResponse.json(
      { error: 'Cannot access repository. Ensure you have push permissions.' },
      { status: 403 }
    )
  }

  const updatedOrg = await prisma.organisation.update({
    where: { id: orgId },
    data: {
      skillsRepoUrl: url,
      skillsRepoOwner: owner,
      skillsRepoName: name,
      skillsRepoProvider: provider,
    },
    select: {
      id: true,
      skillsRepoUrl: true,
      skillsRepoOwner: true,
      skillsRepoName: true,
      skillsRepoProvider: true,
    },
  })

  logAudit({
    userId: authResult.userId,
    action: 'SKILLS_REPO_CONNECTED',
    resource: 'organisation',
    resourceId: orgId,
    metadata: { skillsRepoUrl: url, owner, name, provider },
  })

  logger.info('Skills repo connected', { orgId, url, owner, name })

  return NextResponse.json({
    connected: true,
    url: updatedOrg.skillsRepoUrl,
    owner: updatedOrg.skillsRepoOwner,
    name: updatedOrg.skillsRepoName,
    provider: updatedOrg.skillsRepoProvider,
  })
}

/**
 * DELETE /api/v1/org/[orgId]/skills-repo
 * Disconnect the organisation's skills repository.
 * Requires OWNER or ADMIN role.
 */
export async function DELETE(request: Request, { params }: RouteContext) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { orgId } = await params
  const result = await resolveOrgMembership(orgId, authResult.userId, ['OWNER', 'ADMIN'])

  if ('error' in result) {
    return result.error
  }

  await prisma.organisation.update({
    where: { id: orgId },
    data: {
      skillsRepoUrl: null,
      skillsRepoOwner: null,
      skillsRepoName: null,
      skillsRepoProvider: null,
    },
  })

  logAudit({
    userId: authResult.userId,
    action: 'SKILLS_REPO_DISCONNECTED',
    resource: 'organisation',
    resourceId: orgId,
  })

  logger.info('Skills repo disconnected', { orgId })

  return NextResponse.json({ connected: false })
}
