import type { PackageType } from '@agentver/database'
import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const logger = createLogger('api:search')

const packageTypeSchema = z.enum(['SKILL', 'AGENT_CONFIG', 'PLUGIN', 'SCRIPT', 'PROMPT', 'AGENT', 'COMMAND'])
const sortSchema = z.enum(['relevance', 'stars', 'installs', 'recent'])

type SortOption = z.infer<typeof sortSchema>

type SearchResultRow = {
  id: string
  name: string
  slug: string
  description: string | null
  type: string
  tags: string[]
  compatibility_agents: string[]
  star_count: number
  install_count: number
  licence: string | null
  created_at: Date
  updated_at: Date
  org_slug: string
  org_name: string
  rank: number
}

function buildOrderClause(sort: SortOption): string {
  switch (sort) {
    case 'relevance':
      return 'ORDER BY rank DESC'
    case 'stars':
      return 'ORDER BY p."starCount" DESC, rank DESC'
    case 'installs':
      return 'ORDER BY p."installCount" DESC, rank DESC'
    case 'recent':
      return 'ORDER BY p."updatedAt" DESC'
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')

  if (!query || query.length === 0) {
    return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 })
  }

  if (query.length > 200) {
    return NextResponse.json({ error: 'Query must be 200 characters or fewer' }, { status: 400 })
  }

  const rawType = searchParams.get('type')
  const category = searchParams.get('category')
  const agent = searchParams.get('agent')
  const rawSort = searchParams.get('sort') ?? 'relevance'
  const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? 20), 1), 100)
  const offset = Math.max(Number(searchParams.get('offset') ?? 0), 0)

  // Validate type
  let validatedType: z.infer<typeof packageTypeSchema> | undefined
  if (rawType) {
    const typeResult = packageTypeSchema.safeParse(rawType)
    if (!typeResult.success) {
      return NextResponse.json(
        {
          error:
            'Invalid type parameter. Must be one of: SKILL, AGENT_CONFIG, PLUGIN, SCRIPT, PROMPT',
        },
        { status: 400 }
      )
    }
    validatedType = typeResult.data
  }

  // Validate sort
  const sortResult = sortSchema.safeParse(rawSort)
  if (!sortResult.success) {
    return NextResponse.json(
      { error: 'Invalid sort parameter. Must be one of: relevance, stars, installs, recent' },
      { status: 400 }
    )
  }
  const sort = sortResult.data

  try {
    const params: (string | number)[] = [query]
    let paramIndex = 2

    let typeFilter = ''
    if (validatedType) {
      typeFilter = `AND p."type" = $${paramIndex}::text::"PackageType"`
      params.push(validatedType)
      paramIndex++
    }

    let categoryJoin = ''
    let categoryFilter = ''
    if (category) {
      categoryJoin = `
        INNER JOIN "package_categories" pc ON pc."packageId" = p."id"
        INNER JOIN "categories" c ON c."id" = pc."categoryId"`
      categoryFilter = `AND c."slug" = $${paramIndex}`
      params.push(category)
      paramIndex++
    }

    let agentFilter = ''
    if (agent) {
      agentFilter = `AND $${paramIndex} = ANY(p."compatibilityAgents")`
      params.push(agent)
      paramIndex++
    }

    const orderClause = buildOrderClause(sort)

    params.push(limit)
    const limitParam = paramIndex
    paramIndex++

    params.push(offset)
    const offsetParam = paramIndex

    const searchQuery = `
      SELECT
        p."id",
        p."name",
        p."slug",
        p."description",
        p."type",
        p."tags",
        p."compatibilityAgents" AS compatibility_agents,
        p."starCount" AS star_count,
        p."installCount" AS install_count,
        p."licence",
        p."createdAt" AS created_at,
        p."updatedAt" AS updated_at,
        o."slug" AS org_slug,
        o."name" AS org_name,
        ts_rank(
          to_tsvector('english', p."name" || ' ' || COALESCE(p."description", '') || ' ' || array_to_string(p."tags", ' ')),
          plainto_tsquery('english', $1)
        ) AS rank
      FROM "packages" p
      INNER JOIN "organisations" o ON o."id" = p."organisationId"
      ${categoryJoin}
      WHERE p."visibility" = 'PUBLIC'
        AND to_tsvector('english', p."name" || ' ' || COALESCE(p."description", '') || ' ' || array_to_string(p."tags", ' ')) @@ plainto_tsquery('english', $1)
        ${typeFilter}
        ${categoryFilter}
        ${agentFilter}
      ${orderClause}
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM "packages" p
      ${categoryJoin}
      WHERE p."visibility" = 'PUBLIC'
        AND to_tsvector('english', p."name" || ' ' || COALESCE(p."description", '') || ' ' || array_to_string(p."tags", ' ')) @@ plainto_tsquery('english', $1)
        ${typeFilter}
        ${categoryFilter}
        ${agentFilter}
    `

    const countParams = params.slice(0, -2)

    const [results, countResult] = await Promise.all([
      prisma.$queryRawUnsafe<SearchResultRow[]>(searchQuery, ...params),
      prisma.$queryRawUnsafe<[{ total: number }]>(countQuery, ...countParams),
    ])

    const total = countResult[0]?.total ?? 0

    // Fetch categories for result packages
    const packageIds = results.map((r) => r.id)
    const packageCategories =
      packageIds.length > 0
        ? await prisma.packageCategory.findMany({
            where: { packageId: { in: packageIds } },
            include: {
              category: {
                select: { id: true, name: true, slug: true, icon: true },
              },
            },
          })
        : []

    const categoriesByPackageId = new Map<
      string,
      { id: string; name: string; slug: string; icon: string | null }[]
    >()
    for (const pc of packageCategories) {
      const existing = categoriesByPackageId.get(pc.packageId) ?? []
      existing.push(pc.category)
      categoriesByPackageId.set(pc.packageId, existing)
    }

    return NextResponse.json({
      results: results.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description,
        type: row.type as PackageType,
        tags: row.tags,
        compatibilityAgents: row.compatibility_agents,
        starCount: row.star_count,
        installCount: row.install_count,
        licence: row.licence,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        organisation: {
          slug: row.org_slug,
          name: row.org_name,
        },
        categories: categoriesByPackageId.get(row.id) ?? [],
      })),
      total,
      limit,
      offset,
    })
  } catch (error) {
    logger.error('Search failed', {
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
