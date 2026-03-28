import { prisma } from '@agentver/database'
import { z } from 'zod'
import { publicProcedure, router } from '../init'

export const exploreRouter = router({
  browse: publicProcedure
    .input(
      z.object({
        type: z.enum(['SKILL', 'AGENT_CONFIG', 'PLUGIN', 'SCRIPT', 'PROMPT', 'AGENT', 'COMMAND']).optional(),
        category: z.string().optional(),
        compatibility: z.string().optional(),
        sort: z.enum(['trending', 'stars', 'installs', 'updated']).default('trending'),
        limit: z.number().min(1).max(100).default(24),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const where = {
        visibility: 'PUBLIC' as const,
        ...(input.type && { type: input.type }),
        ...(input.category && {
          categories: {
            some: { category: { slug: input.category } },
          },
        }),
        ...(input.compatibility && {
          compatibilityAgents: {
            hasSome: input.compatibility.split(',').map((s) => s.trim().toLowerCase()),
          },
        }),
      }

      const orderBy = (() => {
        switch (input.sort) {
          case 'stars':
            return [{ starCount: 'desc' as const }]
          case 'installs':
            return [{ installCount: 'desc' as const }]
          case 'updated':
            return [{ updatedAt: 'desc' as const }]
          default:
            return [
              { starCount: 'desc' as const },
              { installCount: 'desc' as const },
              { updatedAt: 'desc' as const },
            ]
        }
      })()

      const fetchLimit = input.limit + 1

      const packages = await prisma.package.findMany({
        where,
        take: fetchLimit,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        orderBy,
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          type: true,
          tags: true,
          compatibilityAgents: true,
          starCount: true,
          installCount: true,
          isVerified: true,
          updatedAt: true,
          organisation: { select: { slug: true, name: true, image: true } },
          versions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { version: true },
          },
          categories: {
            select: { category: { select: { name: true, slug: true } } },
          },
          _count: { select: { installationReports: true } },
        },
      })

      let results = packages
      let nextCursor: string | undefined

      if (results.length > input.limit) {
        results = results.slice(0, input.limit)
        nextCursor = results[results.length - 1]?.id
      }

      return { packages: results, nextCursor }
    }),

  orgProfile: publicProcedure.input(z.object({ slug: z.string() })).query(async ({ input }) => {
    const org = await prisma.organisation.findUnique({
      where: { slug: input.slug },
      select: {
        id: true,
        name: true,
        slug: true,
        image: true,
        isVerified: true,
        createdAt: true,
        _count: { select: { members: true, packages: true } },
        members: {
          select: {
            role: true,
            user: {
              select: { id: true, name: true, username: true, image: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!org) return null

    const packages = await prisma.package.findMany({
      where: { organisationId: org.id, visibility: 'PUBLIC' },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        type: true,
        tags: true,
        compatibilityAgents: true,
        starCount: true,
        installCount: true,
        updatedAt: true,
        organisation: { select: { slug: true, name: true, image: true } },
        versions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { version: true },
        },
        _count: { select: { installationReports: true } },
      },
    })

    const totals = await prisma.package.aggregate({
      where: { organisationId: org.id, visibility: 'PUBLIC' },
      _sum: { starCount: true, installCount: true },
    })

    return {
      ...org,
      packages,
      totalStars: totals._sum.starCount ?? 0,
      totalInstalls: totals._sum.installCount ?? 0,
    }
  }),

  userProfile: publicProcedure
    .input(z.object({ username: z.string() }))
    .query(async ({ input }) => {
      const user = await prisma.user.findUnique({
        where: { username: input.username },
        select: {
          id: true,
          name: true,
          username: true,
          image: true,
          createdAt: true,
          memberships: {
            select: {
              role: true,
              organisation: {
                select: { id: true, name: true, slug: true, image: true },
              },
            },
          },
        },
      })

      if (!user) return null

      const publishedPackages = await prisma.package.findMany({
        where: { authorId: user.id, visibility: 'PUBLIC' },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          type: true,
          tags: true,
          compatibilityAgents: true,
          starCount: true,
          installCount: true,
          updatedAt: true,
          organisation: { select: { slug: true, name: true, image: true } },
          versions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { version: true },
          },
          _count: { select: { installationReports: true } },
        },
      })

      const starredPackages = await prisma.star.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          createdAt: true,
          package: {
            select: {
              id: true,
              name: true,
              slug: true,
              description: true,
              type: true,
              tags: true,
              compatibilityAgents: true,
              starCount: true,
              installCount: true,
              updatedAt: true,
              visibility: true,
              organisation: { select: { slug: true, name: true, image: true } },
              versions: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { version: true },
              },
              _count: { select: { installationReports: true } },
            },
          },
        },
      })

      return {
        ...user,
        publishedPackages,
        starredPackages: starredPackages
          .filter((s) => s.package.visibility === 'PUBLIC')
          .map((s) => s.package),
      }
    }),
})
