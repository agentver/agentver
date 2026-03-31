import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isValidGitRef } from '@/lib/api/validation'
import { authenticateRequest } from '@/lib/auth/api-auth'
import { getGitProvider } from '@/lib/git'

const logger = createLogger('api:save')

const saveSchema = z.object({
  message: z.string().min(1, 'Commit message is required').max(500),
  ref: z.string().min(1).refine(isValidGitRef, { message: 'Invalid ref format' }).optional(),
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        content: z.string(),
      })
    )
    .min(1, 'At least one file is required'),
})

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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = saveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { message, files, ref } = parsed.data

  // Verify the user has access to this organisation
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
    let commitSha = ''

    for (const file of files) {
      const result = await gitService.updateSkillFile(
        org,
        name,
        file.path,
        file.content,
        message,
        ref
      )
      commitSha = result.commitSha
    }

    logger.info('Skill saved via CLI', { org, name, fileCount: files.length, commitSha })

    return NextResponse.json({ commitSha })
  } catch (error) {
    logger.error('Failed to save skill', {
      org,
      name,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to save changes' }, { status: 500 })
  }
}
