import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth/api-auth'
import { getGitProvider } from '@/lib/git'

const logger = createLogger('api:resolve')
const REF_PATTERN = /^[a-zA-Z0-9/_.-]{1,200}$/
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i

function isValidGitRef(ref: string): boolean {
  if (FULL_SHA_PATTERN.test(ref)) {
    return true
  }

  return (
    REF_PATTERN.test(ref) &&
    !ref.includes('..') &&
    !ref.startsWith('.') &&
    !ref.endsWith('.') &&
    !ref.includes('//')
  )
}

/**
 * Shared include clause for package lookups — keeps both direct and
 * path-based queries consistent.
 */
const packageInclude = {
  organisation: { select: { slug: true } },
  versions: {
    where: { status: { not: 'YANKED' as const } },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: { version: true, gitRef: true },
  },
} as const

/**
 * Find a package by progressively matching the path against stored gitPath
 * values, then falling back to a name-based lookup.
 *
 * For a path like "skills/google-search-console/SKILL.md", this will try:
 *   1. gitPath = "skills/google-search-console/SKILL.md"
 *   2. gitPath = "skills/google-search-console"
 *   3. gitPath = "skills"
 *   4. name = "google-search-console" (last non-file segment)
 */
async function findPackageByPath(orgSlug: string, path: string) {
  const segments = path.split('/').filter(Boolean)

  // Try progressively shorter paths to match gitPath
  for (let i = segments.length; i >= 1; i--) {
    const candidatePath = segments.slice(0, i).join('/')
    const pkg = await prisma.package.findFirst({
      where: {
        organisation: { slug: orgSlug },
        gitPath: candidatePath,
      },
      include: packageInclude,
    })
    if (pkg) return pkg
  }

  // Fallback: try matching by package name (last non-file segment)
  const nameSegments = segments.filter((s) => !s.includes('.'))
  const candidateName = nameSegments[nameSegments.length - 1]
  if (candidateName) {
    return prisma.package.findFirst({
      where: {
        name: candidateName,
        organisation: { slug: orgSlug },
      },
      include: packageInclude,
    })
  }

  return null
}

export async function GET(request: Request) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const name = searchParams.get('name')
  const requestedRef = searchParams.get('ref') ?? undefined

  if (!name) {
    return NextResponse.json({ error: 'Missing required query parameter: name' }, { status: 400 })
  }

  if (requestedRef && !isValidGitRef(requestedRef)) {
    return NextResponse.json(
      { error: 'Invalid ref query parameter. Expected a branch, tag, or 40-character commit SHA.' },
      { status: 400 }
    )
  }

  const parts = name.split('/').filter(Boolean)
  if (parts.length < 2 || !parts[0]) {
    return NextResponse.json(
      { error: 'Invalid name format. Expected: org-slug/package-slug or full path' },
      { status: 400 }
    )
  }

  const orgSlug = parts[0]!

  const pkg =
    parts.length === 2 && parts[1]
      ? await prisma.package.findFirst({
          where: {
            name: parts[1],
            organisation: { slug: orgSlug },
          },
          include: packageInclude,
        })
      : await findPackageByPath(orgSlug, parts.slice(1).join('/'))

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
  const gitRef = requestedRef ?? latestGitRef ?? pkg.gitDefaultRef ?? latestVersion ?? 'main'

  // For agentver-hosted packages, include file content so the CLI can install directly
  if (pkg.gitUri.startsWith('agentver://')) {
    try {
      const provider = getGitProvider()
      const fileEntries = await provider.listSkillFiles(orgSlug, pkg.name, gitRef)
      if (fileEntries.length === 0) {
        logger.warn('Platform-hosted skill has no files', { org: orgSlug, package: pkg.name })
        return NextResponse.json(
          {
            error: `Package "${name}" exists but has no files — it may not have been published yet`,
            suggestion: 'Publish the skill via the dashboard before installing.',
          },
          { status: 404 }
        )
      }

      const files = await Promise.all(
        fileEntries
          .filter((e) => e.type === 'file')
          .map(async (entry) => {
            const content = await provider.getSkillFile(orgSlug, pkg.name, entry.path, gitRef)
            return { path: entry.path, content: content ?? '' }
          })
      )

      return NextResponse.json({
        gitUri: pkg.gitUri,
        gitPath: pkg.gitPath,
        gitRef,
        source: 'platform',
        files,
      })
    } catch (error) {
      logger.error('Failed to fetch platform-hosted skill files', {
        org: orgSlug,
        package: pkg.name,
        error: String(error),
      })
      return NextResponse.json(
        {
          error: `Failed to retrieve files for "${name}" — the platform could not read the skill content`,
          suggestion: 'Check that the skill has been published and try again.',
        },
        { status: 502 }
      )
    }
  }

  return NextResponse.json({
    gitUri: pkg.gitUri,
    gitPath: pkg.gitPath,
    gitRef,
    source: 'git',
  })
}
