import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest } from '@/lib/auth/api-auth'
import { getGitProvider } from '@/lib/git'

const logger = createLogger('api:drafts')

const draftCreateSchema = z.object({
  name: z.string().min(1, 'Draft name is required').max(100),
})

const draftActionSchema = z.object({
  action: z.enum(['merge', 'delete']),
  branchName: z.string().min(1, 'Branch name is required'),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ org: string; name: string }> }
) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { org } = await params

  // Verify membership
  const membership = await prisma.organisationMember.findFirst({
    where: {
      organisation: { slug: org },
      userId: authResult.userId,
    },
  })

  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this organisation' }, { status: 403 })
  }

  try {
    const gitService = getGitProvider()
    const drafts = await gitService.listDrafts(org)

    return NextResponse.json(drafts)
  } catch (error) {
    logger.error('Failed to list drafts', {
      org,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to list drafts' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ org: string; name: string }> }
) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  if (!authResult.scopes.includes('WRITE')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { org, name } = await params

  // Verify membership
  const membership = await prisma.organisationMember.findFirst({
    where: {
      organisation: { slug: org },
      userId: authResult.userId,
    },
  })

  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this organisation' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Determine whether this is a create request or an action request
  const createParsed = draftCreateSchema.safeParse(body)
  const actionParsed = draftActionSchema.safeParse(body)

  const gitService = getGitProvider()

  if (createParsed.success && !actionParsed.success) {
    // Create a new draft
    const { name: draftName } = createParsed.data

    try {
      await gitService.createDraft(org, name, draftName)

      logger.info('Draft created via CLI', { org, name, draftName })

      return NextResponse.json(
        {
          name: draftName,
          branchName: `draft/${name}/${draftName}`,
        },
        { status: 201 }
      )
    } catch (error) {
      logger.error('Failed to create draft', {
        org,
        name,
        draftName,
        error: error instanceof Error ? error.message : String(error),
      })
      return NextResponse.json({ error: 'Failed to create draft' }, { status: 500 })
    }
  }

  if (actionParsed.success) {
    const { action, branchName } = actionParsed.data

    try {
      if (action === 'merge') {
        const result = await gitService.mergeDraft(org, branchName, `Merge draft: ${branchName}`)

        logger.info('Draft merged via CLI', { org, branchName, commitSha: result.commitSha })

        return NextResponse.json({ commitSha: result.commitSha })
      }

      if (action === 'delete') {
        await gitService.deleteDraft(org, branchName)

        logger.info('Draft deleted via CLI', { org, branchName })

        return NextResponse.json({ deleted: true })
      }
    } catch (error) {
      logger.error('Draft action failed', {
        org,
        action,
        branchName,
        error: error instanceof Error ? error.message : String(error),
      })
      return NextResponse.json({ error: `Failed to ${action} draft` }, { status: 500 })
    }
  }

  return NextResponse.json(
    {
      error:
        'Invalid request body. Provide { name } for create, or { action, branchName } for merge/delete.',
    },
    { status: 400 }
  )
}
