import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth/api-auth'
import { getGitProvider } from '@/lib/git'

const logger = createLogger('api:history')

export async function GET(
  request: Request,
  { params }: { params: Promise<{ org: string; name: string }> }
) {
  const { org, name } = await params
  const url = new URL(request.url)

  const limitParam = url.searchParams.get('limit')
  const ref = url.searchParams.get('ref') ?? undefined
  const limit = limitParam ? Number.parseInt(limitParam, 10) : 20

  if (Number.isNaN(limit) || limit < 1 || limit > 100) {
    return NextResponse.json({ error: 'Limit must be between 1 and 100' }, { status: 400 })
  }

  // Check access for private skills
  const pkg = await prisma.package.findFirst({
    where: { name, organisation: { slug: org } },
    select: { visibility: true, organisationId: true },
  })

  if (pkg && pkg.visibility !== 'PUBLIC') {
    const authResult = await authenticateRequest(request)
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    }

    const membership = await prisma.organisationMember.findFirst({
      where: { organisationId: pkg.organisationId, userId: authResult.userId },
    })

    if (!membership) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  }

  try {
    const gitService = getGitProvider()
    const commits = await gitService.getHistory(org, name, { limit, ref })

    return NextResponse.json(commits)
  } catch (error) {
    logger.error('Failed to fetch history', {
      org,
      name,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 })
  }
}
