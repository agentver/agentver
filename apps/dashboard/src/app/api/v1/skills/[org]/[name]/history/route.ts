import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth/api-auth'
import { type CommitEntry, getGitProvider } from '@/lib/git'
import { getGitHubToken } from '@/lib/github/token'

const logger = createLogger('api:history')

const GITHUB_API_BASE = 'https://api.github.com'

type GitHubCommitResponse = {
  sha: string
  commit: {
    message: string
    author: { name: string; email: string; date: string }
  }
}

/**
 * Fetch commit history for a path from the GitHub API.
 */
async function fetchGitHubCommitHistory(
  owner: string,
  repo: string,
  path: string,
  options: { limit: number; ref?: string },
  token: string
): Promise<CommitEntry[]> {
  const params = new URLSearchParams()
  params.set('path', path)
  params.set('per_page', String(options.limit))
  if (options.ref) params.set('sha', options.ref)

  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?${params.toString()}`

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  })

  if (!response.ok) {
    throw new Error(`GitHub API error (${response.status})`)
  }

  const commits = (await response.json()) as GitHubCommitResponse[]

  return commits.map((c) => ({
    sha: c.sha,
    message: c.commit.message,
    author: {
      name: c.commit.author.name,
      email: c.commit.author.email,
      date: c.commit.author.date,
    },
    createdAt: c.commit.author.date,
  }))
}

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

  // Check access for private skills and resolve the organisation
  const pkg = await prisma.package.findFirst({
    where: { name, organisation: { slug: org } },
    select: {
      visibility: true,
      organisationId: true,
      gitPath: true,
      organisation: {
        select: {
          skillsRepoProvider: true,
          skillsRepoOwner: true,
          skillsRepoName: true,
        },
      },
    },
  })

  let authUserId: string | null = null

  if (pkg && pkg.visibility !== 'PUBLIC') {
    const authResult = await authenticateRequest(request)
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    }
    authUserId = authResult.userId

    const membership = await prisma.organisationMember.findFirst({
      where: { organisationId: pkg.organisationId, userId: authResult.userId },
    })

    if (!membership) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  }

  if (!pkg) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { organisation } = pkg

  try {
    // Agentver-hosted Forgejo storage
    if (organisation.skillsRepoProvider === 'agentver') {
      const gitService = getGitProvider()
      const commits = await gitService.getHistory(org, name, { limit, ref })
      return NextResponse.json(commits)
    }

    // GitHub-backed storage
    if (
      organisation.skillsRepoProvider === 'github' &&
      organisation.skillsRepoOwner &&
      organisation.skillsRepoName
    ) {
      // Attempt to get a token from the authenticated user
      if (!authUserId) {
        const authResult = await authenticateRequest(request)
        authUserId = authResult?.userId ?? null
      }

      if (!authUserId) {
        return NextResponse.json(
          { error: 'Authentication required for GitHub-backed skills' },
          { status: 401 }
        )
      }

      const token = await getGitHubToken(authUserId)
      if (!token) {
        return NextResponse.json({ error: 'No connected GitHub account' }, { status: 422 })
      }

      const skillPath = `skills/${name}`
      const commits = await fetchGitHubCommitHistory(
        organisation.skillsRepoOwner,
        organisation.skillsRepoName,
        skillPath,
        { limit, ref },
        token
      )
      return NextResponse.json(commits)
    }

    // No recognised provider — return empty history
    return NextResponse.json([])
  } catch (error) {
    logger.error('Failed to fetch history', {
      org,
      name,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 })
  }
}
