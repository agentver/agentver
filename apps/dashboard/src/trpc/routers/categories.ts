import { prisma } from '@agentver/database'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { logAudit } from '@/lib/audit/logger'
import { cacheDeletePattern, withCache } from '@/lib/redis/cache'
import { protectedProcedure, publicProcedure, router } from '../init'

const CATEGORIES_LIST_CACHE_TTL = 600

export const categoriesRouter = router({
  list: publicProcedure.query(async () => {
    return withCache('agentver:categories:list', CATEGORIES_LIST_CACHE_TTL, async () => {
      const categories = await prisma.category.findMany({
        orderBy: { order: 'asc' },
        include: {
          _count: { select: { packages: true } },
        },
      })

      return categories.map((cat) => ({
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        icon: cat.icon,
        order: cat.order,
        packageCount: cat._count.packages,
      }))
    })
  }),

  getBySlug: publicProcedure.input(z.object({ slug: z.string() })).query(async ({ input }) => {
    const category = await prisma.category.findUnique({
      where: { slug: input.slug },
      include: {
        _count: { select: { packages: true } },
      },
    })

    if (!category) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Category not found' })
    }

    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      icon: category.icon,
      order: category.order,
      packageCount: category._count.packages,
    }
  }),

  setPackageCategories: protectedProcedure
    .input(
      z.object({
        packageId: z.string(),
        categoryIds: z.array(z.string()),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const pkg = await prisma.package.findUnique({
        where: { id: input.packageId },
        include: {
          organisation: {
            include: {
              members: { where: { userId: ctx.user.id } },
            },
          },
        },
      })

      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' })
      }

      const membership = pkg.organisation.members[0]
      const isAuthor = pkg.authorId === ctx.user.id
      const isAdminOrOwner = membership?.role === 'ADMIN' || membership?.role === 'OWNER'

      if (!isAuthor && !isAdminOrOwner) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the package author or organisation admins can update categories',
        })
      }

      // Validate all category IDs exist
      if (input.categoryIds.length > 0) {
        const existingCategories = await prisma.category.findMany({
          where: { id: { in: input.categoryIds } },
          select: { id: true },
        })

        if (existingCategories.length !== input.categoryIds.length) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'One or more category IDs are invalid',
          })
        }
      }

      // Replace all categories in a transaction
      await prisma.$transaction([
        prisma.packageCategory.deleteMany({
          where: { packageId: input.packageId },
        }),
        ...input.categoryIds.map((categoryId) =>
          prisma.packageCategory.create({
            data: {
              packageId: input.packageId,
              categoryId,
            },
          })
        ),
      ])

      logAudit({
        userId: ctx.user.id,
        action: 'PACKAGE_CATEGORIES_UPDATED',
        resource: 'Package',
        resourceId: input.packageId,
        metadata: { categoryIds: input.categoryIds },
      })

      // Invalidate categories and search caches
      cacheDeletePattern('agentver:categories:*').catch(() => {})
      cacheDeletePattern('agentver:search:*').catch(() => {})

      return { success: true }
    }),
})
