import { prisma } from '@agentver/database'
import { createLogger, parseFrontmatter } from '@agentver/shared'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest } from '@/lib/auth/api-auth'

const logger = createLogger('api:skills')

const packageTypeSchema = z.enum([
  'SKILL',
  'AGENT_CONFIG',
  'PLUGIN',
  'SCRIPT',
  'PROMPT',
  'AGENT',
  'COMMAND',
])

/**
 * Extract compatibility agents from a package's readme frontmatter.
 * Returns an empty array if no compatibility data is found.
 */
function extractCompatibility(readme: string | null): string[] {
  if (!readme) return []
  const { rawData, hasFrontmatter } = parseFrontmatter(readme)
  if (!hasFrontmatter) return []
  const compat = rawData.compatibility
  if (!Array.isArray(compat)) return []
  return compat.filter((v): v is string => typeof v === 'string')
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')
  const rawType = searchParams.get('type')
  const compatibility = searchParams.get('compatibility')
  const limit = Math.min(Number(searchParams.get('limit') ?? 50), 100)
  const offset = Number(searchParams.get('offset') ?? 0)

  // Validate the type parameter with Zod
  let validatedType: z.infer<typeof packageTypeSchema> | undefined
  if (rawType) {
    const typeResult = packageTypeSchema.safeParse(rawType)
    if (!typeResult.success) {
      return NextResponse.json(
        {
          error: `Invalid type parameter. Must be one of: ${packageTypeSchema.options.join(', ')}`,
        },
        { status: 400 }
      )
    }
    validatedType = typeResult.data
  }

  const where = {
    visibility: 'PUBLIC' as const,
    ...(validatedType && { type: validatedType }),
    ...(query && {
      OR: [
        { name: { contains: query, mode: 'insensitive' as const } },
        { description: { contains: query, mode: 'insensitive' as const } },
        { tags: { hasSome: [query] } },
      ],
    }),
    ...(compatibility && {
      compatibilityAgents: {
        hasSome: compatibility.split(',').map((s) => s.trim().toLowerCase()),
      },
    }),
  }

  const [results, total] = await Promise.all([
    prisma.package.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { updatedAt: 'desc' },
      select: {
        slug: true,
        name: true,
        description: true,
        type: true,
        tags: true,
        readme: true,
        versions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { version: true },
        },
        _count: { select: { installationReports: true } },
      },
    }),
    prisma.package.count({ where }),
  ])

  return NextResponse.json({
    results: results.map((r) => ({
      slug: r.slug,
      name: r.name,
      description: r.description,
      type: r.type,
      tags: r.tags,
      compatibility: extractCompatibility(r.readme),
      version: r.versions[0]?.version ?? '0.0.0',
      downloads: r._count.installationReports,
    })),
    total,
  })
}

const createPackageTypeSchema = z.enum(['SKILL', 'AGENT_CONFIG', 'PLUGIN', 'SCRIPT', 'PROMPT'])

const createSkillSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Name must be lowercase alphanumeric with hyphens'),
  description: z.string().max(500).optional(),
  type: createPackageTypeSchema.default('SKILL'),
  visibility: z.enum(['PUBLIC', 'PRIVATE', 'TEAM']).default('PRIVATE'),
  tags: z.array(z.string().max(50)).max(20).default([]),
  content: z.string().min(1, 'Content is required').max(5_242_880, 'Content must be under 5MB'),
  orgSlug: z.string().min(1, 'Organisation slug is required'),
})

export async function POST(request: Request) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  if (!authResult.scopes.includes('WRITE')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = createSkillSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { name, description, type, visibility, tags, content, orgSlug } = parsed.data

  const org = await prisma.organisation.findUnique({
    where: { slug: orgSlug },
    include: {
      members: { where: { userId: authResult.userId } },
    },
  })

  if (!org) {
    return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })
  }

  if (org.members.length === 0) {
    return NextResponse.json({ error: 'Not a member of this organisation' }, { status: 403 })
  }

  const existing = await prisma.package.findFirst({
    where: { name, organisationId: org.id },
  })

  if (existing) {
    return NextResponse.json(
      { error: 'A package with this name already exists in the organisation' },
      { status: 409 }
    )
  }

  const slug = `${org.slug}/${name}`

  const pkg = await prisma.package.create({
    data: {
      name,
      slug,
      description,
      type,
      visibility,
      tags,
      readme: content,
      compatibilityAgents: extractCompatibility(content),
      organisationId: org.id,
      authorId: authResult.userId,
      gitUri:
        org.skillsRepoOwner && org.skillsRepoName
          ? `github.com/${org.skillsRepoOwner}/${org.skillsRepoName}`
          : undefined,
      gitPath: `skills/${name}`,
    },
    include: {
      organisation: { select: { slug: true, name: true } },
    },
  })

  logger.info('Skill created via API', { slug })

  return NextResponse.json(pkg, { status: 201 })
}
