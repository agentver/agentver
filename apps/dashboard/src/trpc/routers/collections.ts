import { prisma } from '@agentver/database'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { protectedProcedure, router } from '../init'

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export const collectionsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const collections = await prisma.collection.findMany({
      where: {
        organisation: {
          members: { some: { userId: ctx.user.id } },
        },
      },
      include: {
        organisation: { select: { slug: true, name: true } },
        author: { select: { name: true, image: true } },
        _count: { select: { items: true } },
      },
      orderBy: { updatedAt: 'desc' },
    })

    return { collections }
  }),

  getBySlug: protectedProcedure
    .input(z.object({ orgSlug: z.string(), slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const collection = await prisma.collection.findFirst({
        where: {
          slug: input.slug,
          organisation: { slug: input.orgSlug },
        },
        include: {
          organisation: { select: { id: true, slug: true, name: true } },
          author: { select: { name: true, image: true } },
          items: {
            orderBy: { order: 'asc' },
            include: {
              package: {
                include: {
                  organisation: { select: { slug: true, name: true } },
                  author: { select: { name: true, image: true } },
                  versions: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: { version: true },
                  },
                  _count: { select: { installationReports: true } },
                },
              },
            },
          },
        },
      })

      if (!collection) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Collection not found' })
      }

      const isMember = await prisma.organisationMember.findFirst({
        where: {
          userId: ctx.user.id,
          organisationId: collection.organisation.id,
        },
      })

      if (!isMember && collection.visibility === 'PRIVATE') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not authorised to view this collection',
        })
      }

      return collection
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        organisationId: z.string(),
        visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PRIVATE'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const org = await prisma.organisation.findUnique({
        where: { id: input.organisationId },
        include: {
          members: { where: { userId: ctx.user.id } },
        },
      })

      if (!org || org.members.length === 0) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this organisation' })
      }

      const slug = slugify(input.name)

      const existing = await prisma.collection.findUnique({
        where: {
          organisationId_slug: {
            organisationId: input.organisationId,
            slug,
          },
        },
      })

      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'A collection with this name already exists',
        })
      }

      const collection = await prisma.collection.create({
        data: {
          name: input.name,
          slug,
          description: input.description,
          organisationId: input.organisationId,
          authorId: ctx.user.id,
          visibility: input.visibility,
        },
        include: {
          organisation: { select: { slug: true, name: true } },
          _count: { select: { items: true } },
        },
      })

      return collection
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const collection = await prisma.collection.findUnique({
        where: { id: input.id },
        include: {
          organisation: {
            include: { members: { where: { userId: ctx.user.id } } },
          },
        },
      })

      if (!collection || collection.organisation.members.length === 0) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorised' })
      }

      const data: Record<string, unknown> = {}
      if (input.name !== undefined) {
        data.name = input.name
        data.slug = slugify(input.name)
      }
      if (input.description !== undefined) data.description = input.description
      if (input.visibility !== undefined) data.visibility = input.visibility

      return prisma.collection.update({
        where: { id: input.id },
        data,
      })
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const collection = await prisma.collection.findUnique({
        where: { id: input.id },
        include: {
          organisation: {
            include: {
              members: {
                where: { userId: ctx.user.id, role: { in: ['OWNER', 'ADMIN'] } },
              },
            },
          },
        },
      })

      if (!collection) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Collection not found' })
      }

      const isAuthor = collection.authorId === ctx.user.id
      const isOrgAdmin = collection.organisation.members.length > 0

      if (!isAuthor && !isOrgAdmin) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the collection author or org owners/admins can delete collections',
        })
      }

      await prisma.collection.delete({ where: { id: input.id } })
      return { success: true }
    }),

  addItem: protectedProcedure
    .input(
      z.object({
        collectionId: z.string(),
        packageId: z.string(),
        order: z.number().int().min(0).default(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const collection = await prisma.collection.findUnique({
        where: { id: input.collectionId },
        include: {
          organisation: {
            include: { members: { where: { userId: ctx.user.id } } },
          },
        },
      })

      if (!collection || collection.organisation.members.length === 0) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorised' })
      }

      const pkg = await prisma.package.findUnique({ where: { id: input.packageId } })
      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' })
      }

      const existing = await prisma.collectionItem.findUnique({
        where: {
          collectionId_packageId: {
            collectionId: input.collectionId,
            packageId: input.packageId,
          },
        },
      })

      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Package already in this collection' })
      }

      // If no order specified, append to end
      let order = input.order
      if (order === 0) {
        const lastItem = await prisma.collectionItem.findFirst({
          where: { collectionId: input.collectionId },
          orderBy: { order: 'desc' },
          select: { order: true },
        })
        order = (lastItem?.order ?? -1) + 1
      }

      return prisma.collectionItem.create({
        data: {
          collectionId: input.collectionId,
          packageId: input.packageId,
          order,
        },
        include: {
          package: {
            include: {
              organisation: { select: { slug: true, name: true } },
              versions: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { version: true },
              },
            },
          },
        },
      })
    }),

  removeItem: protectedProcedure
    .input(z.object({ collectionId: z.string(), packageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const collection = await prisma.collection.findUnique({
        where: { id: input.collectionId },
        include: {
          organisation: {
            include: { members: { where: { userId: ctx.user.id } } },
          },
        },
      })

      if (!collection || collection.organisation.members.length === 0) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorised' })
      }

      const item = await prisma.collectionItem.findUnique({
        where: {
          collectionId_packageId: {
            collectionId: input.collectionId,
            packageId: input.packageId,
          },
        },
      })

      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not in this collection' })
      }

      await prisma.collectionItem.delete({ where: { id: item.id } })
      return { success: true }
    }),

  reorderItems: protectedProcedure
    .input(
      z.object({
        collectionId: z.string(),
        items: z.array(
          z.object({
            id: z.string(),
            order: z.number().int().min(0),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const collection = await prisma.collection.findUnique({
        where: { id: input.collectionId },
        include: {
          organisation: {
            include: { members: { where: { userId: ctx.user.id } } },
          },
        },
      })

      if (!collection || collection.organisation.members.length === 0) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorised' })
      }

      await prisma.$transaction(
        input.items.map((item) =>
          prisma.collectionItem.update({
            where: { id: item.id },
            data: { order: item.order },
          })
        )
      )

      return { success: true }
    }),

  addItems: protectedProcedure
    .input(
      z.object({
        collectionId: z.string(),
        packageIds: z.array(z.string()).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const collection = await prisma.collection.findUnique({
        where: { id: input.collectionId },
        include: {
          organisation: {
            include: { members: { where: { userId: ctx.user.id } } },
          },
        },
      })

      if (!collection || collection.organisation.members.length === 0) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorised' })
      }

      const lastItem = await prisma.collectionItem.findFirst({
        where: { collectionId: input.collectionId },
        orderBy: { order: 'desc' },
        select: { order: true },
      })

      let nextOrder = (lastItem?.order ?? -1) + 1

      const existingItems = await prisma.collectionItem.findMany({
        where: {
          collectionId: input.collectionId,
          packageId: { in: input.packageIds },
        },
        select: { packageId: true },
      })

      const existingPackageIds = new Set(existingItems.map((i) => i.packageId))
      const newPackageIds = input.packageIds.filter((id) => !existingPackageIds.has(id))

      if (newPackageIds.length === 0) {
        return { added: 0 }
      }

      await prisma.collectionItem.createMany({
        data: newPackageIds.map((packageId) => ({
          collectionId: input.collectionId,
          packageId,
          order: nextOrder++,
        })),
      })

      return { added: newPackageIds.length }
    }),
})
