import { createHash } from 'node:crypto'
import { type Prisma, prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest } from '@/lib/auth/api-auth'
import { getGitProvider } from '@/lib/git'

const logger = createLogger('api:versions')

export async function GET(
  request: Request,
  { params }: { params: Promise<{ org: string; name: string }> }
) {
  const { org, name } = await params

  const pkg = await prisma.package.findFirst({
    where: { name, organisation: { slug: org } },
    select: { id: true, visibility: true, organisationId: true },
  })

  if (!pkg) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (pkg.visibility !== 'PUBLIC') {
    const authResult = await authenticateRequest(request)
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    }

    const membership = await prisma.organisationMember.findFirst({
      where: { organisationId: pkg.organisationId, userId: authResult.userId },
      select: { id: true },
    })

    if (!membership) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  }

  const versions = await prisma.packageVersion.findMany({
    where: { packageId: pkg.id },
    orderBy: { createdAt: 'desc' },
    select: {
      version: true,
      changelog: true,
      sha256: true,
      size: true,
      gitRef: true,
      gitCommitSha: true,
      createdAt: true,
    },
  })

  return NextResponse.json({ versions })
}

/** Original platform publish schema — includes full content. */
const publishVersionSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/, 'Must be valid semver'),
  changelog: z.string().max(5000).optional(),
  content: z.string().min(1, 'Content is required').max(5_242_880, 'Content must be under 5MB'),
  fileManifest: z.record(z.string(), z.unknown()).default({}),
})

/** CLI tag-based version schema — references an existing commit. */
const cliVersionSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/, 'Must be valid semver'),
  notes: z.string().max(5000).optional(),
  commitSha: z.string().min(1, 'Commit SHA is required'),
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

  // Try CLI schema first (commitSha-based), then fall back to the original content-based schema
  const cliParsed = cliVersionSchema.safeParse(body)
  if (cliParsed.success) {
    return handleCliVersion(request, org, name, cliParsed.data, authResult.userId)
  }

  const parsed = publishVersionSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { version, changelog, content, fileManifest } = parsed.data

  const pkg = await prisma.package.findFirst({
    where: {
      name,
      organisation: { slug: org },
    },
    include: {
      organisation: {
        include: { members: { where: { userId: authResult.userId } } },
      },
    },
  })

  if (!pkg) {
    return NextResponse.json({ error: 'Package not found' }, { status: 404 })
  }

  if (pkg.organisation.members.length === 0) {
    return NextResponse.json({ error: 'Not a member of this organisation' }, { status: 403 })
  }

  const existingVersion = await prisma.packageVersion.findFirst({
    where: { packageId: pkg.id, version },
  })

  if (existingVersion) {
    return NextResponse.json({ error: `Version ${version} already exists` }, { status: 409 })
  }

  const sha256 = createHash('sha256').update(content).digest('hex')
  const size = Buffer.byteLength(content, 'utf-8')

  const manifestJson = fileManifest as Prisma.InputJsonValue

  let pkgVersion
  try {
    pkgVersion = await prisma.packageVersion.create({
      data: {
        packageId: pkg.id,
        version,
        changelog,
        fileManifest: manifestJson,
        sha256,
        size,
      },
      select: {
        id: true,
        version: true,
        changelog: true,
        sha256: true,
        size: true,
        createdAt: true,
      },
    })
  } catch (error) {
    logger.error('Failed to save version record', {
      org,
      name,
      version,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to save version record' }, { status: 500 })
  }

  // Update the package readme to match the published version
  await prisma.package.update({
    where: { id: pkg.id },
    data: { readme: content },
  })

  return NextResponse.json(pkgVersion, { status: 201 })
}

/**
 * Handle CLI version creation: tags an existing commit via Forgejo.
 */
async function handleCliVersion(
  _request: Request,
  org: string,
  name: string,
  data: z.infer<typeof cliVersionSchema>,
  userId: string
) {
  const { version, notes, commitSha } = data

  // Verify membership
  const membership = await prisma.organisationMember.findFirst({
    where: {
      organisation: { slug: org },
      userId,
    },
  })

  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this organisation' }, { status: 403 })
  }

  try {
    const gitService = getGitProvider()
    const tagMessage = notes ?? `Release ${version}`

    await gitService.createVersion(org, name, version, tagMessage, commitSha)

    logger.info('Version created via CLI', { org, name, version, commitSha })

    return NextResponse.json(
      {
        tag: `v/${name}/${version}`,
        commitSha,
      },
      { status: 201 }
    )
  } catch (error) {
    logger.error('Failed to create version tag', {
      org,
      name,
      version,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to create version' }, { status: 500 })
  }
}
