import { prisma } from '@agentver/database'
import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth/api-auth'

export async function GET(request: Request) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const name = searchParams.get('name')

  if (!name) {
    return NextResponse.json({ error: 'Missing required query parameter: name' }, { status: 400 })
  }

  const parts = name.split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return NextResponse.json(
      { error: 'Invalid name format. Expected: org-slug/package-slug' },
      { status: 400 }
    )
  }

  const [orgSlug, packageName] = parts as [string, string]

  const pkg = await prisma.package.findFirst({
    where: {
      name: packageName,
      organisation: { slug: orgSlug },
    },
    include: {
      organisation: { select: { slug: true } },
      versions: {
        where: { status: { not: 'YANKED' } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { version: true, gitRef: true },
      },
    },
  })

  if (!pkg) {
    return NextResponse.json(
      {
        error: `Package "${name}" not found`,
        suggestion: `Check the organisation and package slugs, or browse available packages at the platform.`,
      },
      { status: 404 }
    )
  }

  if (!pkg.gitUri) {
    return NextResponse.json(
      {
        error: `Package "${name}" has no linked source repository`,
        suggestion: `This package may have been created without a Git source. Contact the package owner.`,
      },
      { status: 404 }
    )
  }

  const latestVersion = pkg.versions[0]?.version
  const latestGitRef = pkg.versions[0]?.gitRef

  return NextResponse.json({
    gitUri: pkg.gitUri,
    gitPath: pkg.gitPath,
    gitRef: latestGitRef ?? pkg.gitDefaultRef ?? latestVersion ?? 'main',
  })
}
