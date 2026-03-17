import { createHash } from 'node:crypto'
import type { PackageType } from '@agentver/database'
import { prisma } from '@agentver/database'
import { z } from 'zod'
import { withCache } from '@/lib/redis/cache'
import { publicProcedure, router } from '../init'

/** TTL constants in seconds */
const SEARCH_CACHE_TTL = 60
const TRENDING_CACHE_TTL = 300

/** Hash search input to produce a stable, short cache key. */
function hashSearchInput(input: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16)
}

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

type TrendingResultRow = {
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
  score: number
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

export const searchRouter = router({
  searchExternal: publicProcedure
    .input(
      z.object({
        query: z.string().min(1).max(200),
        limit: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ input }) => {
      const { searchSkillsSh } = await import('@/lib/registries/skills-sh')
      return searchSkillsSh(input.query, input.limit)
    }),

  search: publicProcedure
    .input(
      z.object({
        query: z.string().min(1).max(200),
        type: z.enum(['SKILL', 'AGENT_CONFIG', 'PLUGIN', 'SCRIPT', 'PROMPT']).optional(),
        category: z.string().optional(),
        agent: z.string().optional(),
        sort: sortSchema.default('relevance'),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const cacheKey = `agentver:search:${hashSearchInput(input)}`

      return withCache(cacheKey, SEARCH_CACHE_TTL, async () => {
        const params: (string | number)[] = [input.query]
        let paramIndex = 2

        let typeFilter = ''
        if (input.type) {
          typeFilter = `AND p."type" = $${paramIndex}::text::"PackageType"`
          params.push(input.type)
          paramIndex++
        }

        let categoryJoin = ''
        let categoryFilter = ''
        if (input.category) {
          categoryJoin = `
          INNER JOIN "package_categories" pc ON pc."packageId" = p."id"
          INNER JOIN "categories" c ON c."id" = pc."categoryId"`
          categoryFilter = `AND c."slug" = $${paramIndex}`
          params.push(input.category)
          paramIndex++
        }

        let agentFilter = ''
        if (input.agent) {
          agentFilter = `AND $${paramIndex} = ANY(p."compatibilityAgents")`
          params.push(input.agent)
          paramIndex++
        }

        const orderClause = buildOrderClause(input.sort)

        params.push(input.limit)
        const limitParam = paramIndex
        paramIndex++

        params.push(input.offset)
        const offsetParam = paramIndex

        const query = `
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

        // Count doesn't need limit/offset params
        const countParams = params.slice(0, -2)

        const [results, countResult] = await Promise.all([
          prisma.$queryRawUnsafe<SearchResultRow[]>(query, ...params),
          prisma.$queryRawUnsafe<[{ total: number }]>(countQuery, ...countParams),
        ])

        const total = countResult[0]?.total ?? 0

        // Fetch categories for the result packages
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

        return {
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
            rank: row.rank,
          })),
          total,
          limit: input.limit,
          offset: input.offset,
        }
      })
    }),

  trending: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }))
    .query(async ({ input }) => {
      const trendingCacheKey = `agentver:trending:${input.limit}`

      return withCache(trendingCacheKey, TRENDING_CACHE_TTL, async () => {
        // Score = (installCount * 3 + starCount * 2) / sqrt(age_in_days + 1)
        // +1 to avoid division by zero for newly created packages
        const results = await prisma.$queryRawUnsafe<TrendingResultRow[]>(
          `
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
          (p."installCount" * 3 + p."starCount" * 2)::float
            / sqrt(GREATEST(EXTRACT(EPOCH FROM (NOW() - p."createdAt")) / 86400.0, 1)) AS score
        FROM "packages" p
        INNER JOIN "organisations" o ON o."id" = p."organisationId"
        WHERE p."visibility" = 'PUBLIC'
        ORDER BY score DESC, p."updatedAt" DESC
        LIMIT $1
        `,
          input.limit
        )

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

        return results.map((row) => ({
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
          score: row.score,
        }))
      })
    }),
})
