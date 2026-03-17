import { type Prisma, type ProposalStatus, prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest } from '@/lib/auth/api-auth'
import { calculateDiffStat, parseUnifiedDiff } from '@/lib/diff-parser'
import { getGitProvider } from '@/lib/git'

const logger = createLogger('api:suggestions')

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const createSuggestionSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  content: z.string().min(1),
  files: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
})

// ---------------------------------------------------------------------------
// GET — list suggestions for a skill
// ---------------------------------------------------------------------------

export async function GET(
  request: Request,
  { params }: { params: Promise<{ org: string; name: string }> }
) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { org, name } = await params
  const url = new URL(request.url)
  const status = url.searchParams.get('status')

  // Find the package by org slug + name
  const pkg = await prisma.package.findFirst({
    where: {
      name,
      organisation: { slug: org },
    },
    select: {
      id: true,
      visibility: true,
      organisationId: true,
    },
  })

  if (!pkg) {
    return NextResponse.json({ error: 'Package not found' }, { status: 404 })
  }

  // Check access
  if (pkg.visibility !== 'PUBLIC') {
    const membership = await prisma.organisationMember.findUnique({
      where: {
        userId_organisationId: {
          userId: authResult.userId,
          organisationId: pkg.organisationId,
        },
      },
    })

    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const validStatuses = new Set(['OPEN', 'IN_REVIEW', 'APPROVED', 'MERGED', 'REJECTED', 'CLOSED'])
  const normalisedStatus = status?.toUpperCase()

  const where: Prisma.ChangeProposalWhereInput = {
    packageId: pkg.id,
    ...(normalisedStatus &&
      validStatuses.has(normalisedStatus) && {
        status: normalisedStatus as ProposalStatus,
      }),
  }

  const proposals = await prisma.changeProposal.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      author: { select: { id: true, name: true, image: true } },
      _count: { select: { comments: true, reviews: true } },
    },
  })

  return NextResponse.json({ suggestions: proposals })
}

// ---------------------------------------------------------------------------
// POST — create a suggestion (from CLI `agentver suggest`)
// ---------------------------------------------------------------------------

export async function POST(
  request: Request,
  { params }: { params: Promise<{ org: string; name: string }> }
) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { org, name } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = createSuggestionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  // Find the package by org slug + name
  const pkg = await prisma.package.findFirst({
    where: {
      name,
      organisation: { slug: org },
    },
    include: {
      organisation: {
        include: { members: { where: { userId: authResult.userId } } },
      },
      versions: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { version: true },
      },
    },
  })

  if (!pkg) {
    return NextResponse.json({ error: 'Package not found' }, { status: 404 })
  }

  // Check access: public packages allow suggestions from anyone,
  // private packages require org membership
  const isPublic = pkg.visibility === 'PUBLIC'
  const isMember = pkg.organisation.members.length > 0
  if (!isPublic && !isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { title, description, content, files } = parsed.data
  const baseVersion = pkg.versions[0]?.version ?? null
  const useGit = pkg.organisation.skillsRepoProvider === 'agentver'
  const orgSlug = pkg.organisation.slug

  // Build the content JSON
  const contentJson: Prisma.InputJsonValue = files
    ? ({ files } as unknown as Prisma.InputJsonValue)
    : ({ body: content } as Prisma.InputJsonValue)

  // Create the proposal record
  const proposal = await prisma.changeProposal.create({
    data: {
      packageId: pkg.id,
      authorId: authResult.userId,
      title,
      description,
      content: contentJson,
      status: 'OPEN',
      baseVersion,
      targetBranch: 'main',
    },
  })

  // For Agentver-backed orgs, create a git branch and commit files
  if (useGit) {
    try {
      const gitService = getGitProvider()

      const { branchName, baseSha } = await gitService.createSuggestionBranch(orgSlug, proposal.id)

      let headSha = baseSha
      let diffStat: Prisma.InputJsonValue | undefined

      if (files && files.length > 0) {
        const commitResult = await gitService.commitFilesToBranch(
          orgSlug,
          branchName,
          files,
          `suggestion: ${title}`
        )
        headSha = commitResult.commitSha

        try {
          const rawDiff = await gitService.getDiff(orgSlug, baseSha, headSha)
          const parsedDiff = parseUnifiedDiff(rawDiff)
          const stats = calculateDiffStat(parsedDiff)
          diffStat = stats as unknown as Prisma.InputJsonValue
        } catch {
          // Best-effort diff stat calculation
        }
      }

      await prisma.changeProposal.update({
        where: { id: proposal.id },
        data: {
          sourceBranch: branchName,
          baseSha,
          headSha,
          ...(diffStat && { diffStat }),
        },
      })
    } catch (error) {
      logger.error('Failed to create suggestion branch via REST API', {
        proposalId: proposal.id,
        orgSlug,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Notify the package author
  if (pkg.authorId !== authResult.userId) {
    prisma.notification
      .create({
        data: {
          userId: pkg.authorId,
          type: 'PROPOSAL_OPENED',
          title: `New suggestion on ${pkg.name}`,
          body: title,
          resourceId: proposal.id,
          resourceType: 'proposal',
          actorId: authResult.userId,
        },
      })
      .catch(() => {
        // Swallow notification failures
      })
  }

  return NextResponse.json({ id: proposal.id, status: proposal.status }, { status: 201 })
}
