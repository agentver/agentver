import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth/api-auth'
import { commitFiles, getDefaultBranch } from '@/lib/github/skills-repo'

const logger = createLogger('api:org:skills-repo:scaffold')

type RouteContext = {
  params: Promise<{ orgId: string }>
}

const SCAFFOLD_FILES = [
  {
    path: 'skills/README.md',
    content: [
      '# Skills',
      '',
      'Agent skills managed by the organisation.',
      '',
      'Each subdirectory contains a skill definition that can be installed by team members.',
    ].join('\n'),
  },
  {
    path: 'configs/README.md',
    content: [
      '# Configs',
      '',
      'Agent configuration files for the organisation.',
      '',
      'Store shared agent configurations (CLAUDE.md, .cursorrules, etc.) here.',
    ].join('\n'),
  },
  {
    path: 'prompts/README.md',
    content: [
      '# Prompts',
      '',
      'Reusable prompt templates for the organisation.',
      '',
      'Centralise prompt definitions that can be referenced across skills and configs.',
    ].join('\n'),
  },
]

/**
 * POST /api/v1/org/[orgId]/skills-repo/scaffold
 * Initialise the skills repo with the standard directory structure.
 * Requires OWNER or ADMIN role.
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

  const org = await prisma.organisation.findUnique({
    where: { id: orgId },
    include: {
      members: { where: { userId: authResult.userId } },
    },
  })

  if (!org) {
    return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })
  }

  const membership = org.members[0]
  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this organisation' }, { status: 403 })
  }

  if (!['OWNER', 'ADMIN'].includes(membership.role)) {
    return NextResponse.json(
      { error: 'Insufficient permissions. Admin or owner role required.' },
      { status: 403 }
    )
  }

  if (!org.skillsRepoUrl || !org.skillsRepoOwner || !org.skillsRepoName) {
    return NextResponse.json(
      { error: 'No skills repository connected for this organisation' },
      { status: 404 }
    )
  }

  // Get the user's GitHub token
  const account = await prisma.connectedAccount.findUnique({
    where: {
      userId_provider: {
        userId: authResult.userId,
        provider: 'GITHUB',
      },
    },
    select: { accessToken: true },
  })

  if (!account?.accessToken) {
    return NextResponse.json(
      { error: 'No connected GitHub account. Please connect your GitHub account first.' },
      { status: 400 }
    )
  }

  const token = account.accessToken

  try {
    // Determine the default branch
    const defaultBranch = await getDefaultBranch(org.skillsRepoOwner, org.skillsRepoName, token)

    const commitResult = await commitFiles(
      org.skillsRepoOwner,
      org.skillsRepoName,
      SCAFFOLD_FILES,
      'chore: initialise skills repository structure',
      defaultBranch,
      token
    )

    logger.info('Skills repo scaffolded', {
      orgId,
      owner: org.skillsRepoOwner,
      repo: org.skillsRepoName,
      branch: defaultBranch,
      commitSha: commitResult.sha,
    })

    return NextResponse.json({
      sha: commitResult.sha,
      branch: commitResult.branch,
      directories: ['skills/', 'configs/', 'prompts/'],
    })
  } catch (error) {
    logger.error('Failed to scaffold skills repo', {
      orgId,
      owner: org.skillsRepoOwner,
      repo: org.skillsRepoName,
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json(
      {
        error:
          'Failed to scaffold repository. Ensure the repository is not empty and the connected account has push access.',
      },
      { status: 502 }
    )
  }
}
