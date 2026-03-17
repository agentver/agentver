import type { Prisma } from '@agentver/database'
import { prisma } from '@agentver/database'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { logAudit } from '@/lib/audit/logger'
import { createNotifications } from '@/lib/notifications'
import { deliverEvent } from '@/lib/webhooks/service'
import { protectedProcedure, router } from '../init'

export const versionsRouter = router({
  list: protectedProcedure
    .input(z.object({ packageId: z.string() }))
    .query(async ({ ctx, input }) => {
      const pkg = await prisma.package.findUnique({
        where: { id: input.packageId },
        select: {
          visibility: true,
          organisation: {
            select: {
              members: { where: { userId: ctx.user.id }, select: { id: true } },
            },
          },
        },
      })

      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' })
      }

      const isMember = pkg.organisation.members.length > 0
      if (pkg.visibility !== 'PUBLIC' && !isMember) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not authorised to view versions for this package',
        })
      }

      return prisma.packageVersion.findMany({
        where: { packageId: input.packageId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          packageId: true,
          version: true,
          changelog: true,
          gitRef: true,
          gitCommitSha: true,
          fileManifest: true,
          createdAt: true,
        },
      })
    }),

  publish: protectedProcedure
    .input(
      z.object({
        packageId: z.string(),
        version: z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/),
        changelog: z.string().optional(),
        gitRef: z.string().optional(),
        gitCommitSha: z.string().optional(),
        fileManifest: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const pkg = await prisma.package.findUnique({
        where: { id: input.packageId },
        include: {
          organisation: {
            include: { members: { where: { userId: ctx.user.id } } },
          },
        },
      })

      if (!pkg || pkg.organisation.members.length === 0) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorised' })
      }

      const existing = await prisma.packageVersion.findFirst({
        where: { packageId: input.packageId, version: input.version },
      })

      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Version ${input.version} already exists`,
        })
      }

      const manifestJson = (input.fileManifest ?? {}) as Prisma.InputJsonValue

      const version = await prisma.packageVersion.create({
        data: {
          packageId: input.packageId,
          version: input.version,
          changelog: input.changelog,
          gitRef: input.gitRef,
          gitCommitSha: input.gitCommitSha,
          fileManifest: manifestJson,
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'VERSION_PUBLISHED',
        resource: 'PackageVersion',
        resourceId: version.id,
        metadata: {
          packageId: input.packageId,
          version: input.version,
          gitRef: input.gitRef,
          gitCommitSha: input.gitCommitSha,
        },
      })

      // Notify users who have installation reports for this package
      const installers = await prisma.installationReport.findMany({
        where: {
          packageId: input.packageId,
          userId: { not: ctx.user.id },
        },
        select: { userId: true },
        distinct: ['userId'],
      })

      if (installers.length > 0) {
        const actorName = ctx.user.name ?? ctx.user.email
        const pkgDisplayName = `${pkg.organisation.slug}/${pkg.name}`
        createNotifications(
          prisma,
          installers.map((installer) => ({
            userId: installer.userId,
            type: 'VERSION_PUBLISHED' as const,
            title: `${actorName} published v${input.version} of ${pkgDisplayName}`,
            body: input.changelog ?? undefined,
            resourceId: pkg.id,
            resourceType: 'package',
            actorId: ctx.user.id,
          }))
        )
      }

      void deliverEvent(
        pkg.organisationId,
        'version.published',
        { id: ctx.user.id, username: ctx.user.name ?? ctx.user.email },
        {
          skill: { name: pkg.name, slug: `${pkg.organisation.slug}/${pkg.name}` },
          version: input.version,
        }
      )

      return version
    }),
})
