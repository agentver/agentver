import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest } from '@/lib/auth/api-auth'
import { commitFiles, getRepoContents } from '@/lib/github/skills-repo'
import { getGitHubToken } from '@/lib/github/token'

const logger = createLogger('api:org:skills-repo:contents')

type RouteContext = {
  params: Promise<{ orgId: string }>
}

const commitFilesSchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        content: z.string(),
      })
    )
    .min(1),
  message: z.string().min(1),
  branch: z.string().optional(),
})

/**
 * Resolve the org, verify membership, and ensure a skills repo is connected.
 */
async function resolveOrgWithRepo(orgId: string, userId: string) {
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

  if (!org.skillsRepoUrl || !org.skillsRepoOwner || !org.skillsRepoName) {
    return {
      error: NextResponse.json(
        { error: 'No skills repository connected for this organisation' },
        { status: 404 }
      ),
    }
  }

  return { org, membership }
}

/**
 * GET /api/v1/org/[orgId]/skills-repo/contents?path=...&ref=...
 * Read file or directory contents from the organisation's skills repo.
 */
export async function GET(request: Request, { params }: RouteContext) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { orgId } = await params
  const result = await resolveOrgWithRepo(orgId, authResult.userId)

  if ('error' in result) {
    return result.error
  }

  const { org } = result

  const { searchParams } = new URL(request.url)
  const path = searchParams.get('path') ?? ''
  const ref = searchParams.get('ref') ?? undefined

  const token = await getGitHubToken(authResult.userId)
  if (!token) {
    return NextResponse.json(
      { error: 'No connected GitHub account. Please connect your GitHub account first.' },
      { status: 400 }
    )
  }

  try {
    const contents = await getRepoContents(
      org.skillsRepoOwner!,
      org.skillsRepoName!,
      path,
      ref,
      token
    )

    return NextResponse.json(contents)
  } catch (error) {
    logger.error('Failed to fetch repo contents', {
      orgId,
      path,
      ref,
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json({ error: 'Failed to fetch repository contents' }, { status: 502 })
  }
}

/**
 * POST /api/v1/org/[orgId]/skills-repo/contents
 * Commit new or updated files to the organisation's skills repo.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  if (!authResult.scopes.includes('WRITE')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { orgId } = await params
  const result = await resolveOrgWithRepo(orgId, authResult.userId)

  if ('error' in result) {
    return result.error
  }

  const { org } = result

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = commitFilesSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { files, message, branch } = parsed.data

  const token = await getGitHubToken(authResult.userId)
  if (!token) {
    return NextResponse.json(
      { error: 'No connected GitHub account. Please connect your GitHub account first.' },
      { status: 400 }
    )
  }

  // Use the specified branch or fall back to the repo's default
  const targetBranch = branch ?? 'main'

  try {
    const commitResult = await commitFiles(
      org.skillsRepoOwner!,
      org.skillsRepoName!,
      files,
      message,
      targetBranch,
      token
    )

    logger.info('Files committed to skills repo', {
      orgId,
      fileCount: files.length,
      branch: targetBranch,
      commitSha: commitResult.sha,
    })

    return NextResponse.json({
      sha: commitResult.sha,
      branch: commitResult.branch,
      filesCommitted: files.length,
    })
  } catch (error) {
    logger.error('Failed to commit files to skills repo', {
      orgId,
      fileCount: files.length,
      branch: targetBranch,
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json({ error: 'Failed to commit files to repository' }, { status: 502 })
  }
}
