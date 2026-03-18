import { createHash } from 'node:crypto'
import { type Prisma, prisma } from '@agentver/database'
import { createLogger, parseFrontmatter } from '@agentver/shared'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest } from '@/lib/auth/api-auth'
import { getGitProvider } from '@/lib/git'

const logger = createLogger('api:publish')

const publishSchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        content: z.string(),
      })
    )
    .min(1, 'At least one file is required'),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/, 'Must be valid semver')
    .optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
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

  const parsed = publishSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { files, version, visibility } = parsed.data

  // Verify membership
  const orgRecord = await prisma.organisation.findUnique({
    where: { slug: org },
    include: {
      members: { where: { userId: authResult.userId } },
    },
  })

  if (!orgRecord || orgRecord.members.length === 0) {
    return NextResponse.json({ error: 'Not a member of this organisation' }, { status: 403 })
  }

  try {
    const skillMd = files.find((f) => f.path === 'SKILL.md' || f.path.endsWith('/SKILL.md'))

    // For new packages SKILL.md is required — check existence before blocking
    if (!skillMd) {
      const existingCheck = await prisma.package.findFirst({
        where: { name, organisationId: orgRecord.id },
        select: { id: true },
      })
      if (!existingCheck) {
        return NextResponse.json({ error: 'SKILL.md required for new packages' }, { status: 400 })
      }
    }

    const rawData: Record<string, unknown> = skillMd
      ? parseFrontmatter(skillMd.content).rawData
      : {}

    // Validate frontmatter arrays to avoid unsafe casts and unbounded input
    const safeTags = z
      .array(z.string().max(64))
      .max(20)
      .catch([])
      .parse(rawData.tags ?? [])
    const safeCompatibility = z
      .array(z.string().max(64))
      .max(20)
      .catch([])
      .parse(rawData.compatibility ?? [])

    // Atomic upsert — safe under concurrent publishes (avoids TOCTOU P2002 on unique organisationId+name)
    const pkg = await prisma.package.upsert({
      where: { organisationId_name: { organisationId: orgRecord.id, name } },
      create: {
        name,
        slug: `${org}/${name}`,
        description: typeof rawData.description === 'string' ? rawData.description : '',
        type: 'SKILL',
        visibility: visibility ?? 'PRIVATE',
        tags: safeTags,
        compatibilityAgents: safeCompatibility,
        readme: skillMd?.content ?? '',
        organisationId: orgRecord.id,
        authorId: authResult.userId,
      },
      update: visibility ? { visibility } : {},
    })

    logger.info('Package upserted for skill publish', { org, name, packageId: pkg.id })

    const gitService = getGitProvider()
    const commitMessage = version ? `Publish ${name}@${version}` : `Publish ${name}`

    // Create or update the skill files
    const result = await gitService.createSkill(
      org,
      name,
      files.map((f) => ({ path: f.path, content: f.content })),
      commitMessage
    )

    let resolvedVersion = version ?? '0.0.0'

    // Create a version tag if specified
    if (version) {
      await gitService.createVersion(org, name, version, `Release ${version}`, result.commitSha)

      // Sort by path so identical file sets always produce the same hash regardless of upload order
      const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path))
      const allContent = sortedFiles.map((f) => f.content).join('\n')
      const sha256 = createHash('sha256').update(allContent).digest('hex')
      const size = Buffer.byteLength(allContent, 'utf-8')

      const existingVersion = await prisma.packageVersion.findFirst({
        where: { packageId: pkg.id, version },
      })

      if (!existingVersion) {
        const fileManifest: Prisma.InputJsonValue = Object.fromEntries(
          files.map((f) => [f.path, { size: Buffer.byteLength(f.content, 'utf-8') }])
        )

        await prisma.packageVersion.create({
          data: {
            packageId: pkg.id,
            version,
            gitRef: `v/${name}/${version}`,
            gitCommitSha: result.commitSha,
            sha256,
            size,
            fileManifest,
          },
        })
      }

      resolvedVersion = version
    }

    logger.info('Skill published via CLI', {
      org,
      name,
      version: resolvedVersion,
      commitSha: result.commitSha,
    })

    return NextResponse.json(
      { version: resolvedVersion, commitSha: result.commitSha },
      { status: 201 }
    )
  } catch (error) {
    logger.error('Failed to publish skill', {
      org,
      name,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to publish skill' }, { status: 500 })
  }
}
