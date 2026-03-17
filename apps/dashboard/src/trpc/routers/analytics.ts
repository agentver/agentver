import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { protectedProcedure, router } from '../init'

const logger = createLogger('analytics-router')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PERIOD_DAYS = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
} as const

type PeriodKey = keyof typeof PERIOD_DAYS

function getPeriodStart(period: PeriodKey): Date {
  const now = new Date()
  now.setDate(now.getDate() - PERIOD_DAYS[period])
  now.setHours(0, 0, 0, 0)
  return now
}

function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function generateDateBuckets(start: Date, end: Date): string[] {
  const buckets: string[] = []
  const current = new Date(start)
  while (current <= end) {
    buckets.push(formatDateKey(current))
    current.setDate(current.getDate() + 1)
  }
  return buckets
}

async function getOrgIdBySlug(slug: string, userId: string): Promise<string> {
  const membership = await prisma.organisationMember.findFirst({
    where: {
      userId,
      organisation: { slug },
    },
    select: { organisationId: true },
  })

  if (!membership) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You are not a member of this organisation',
    })
  }

  return membership.organisationId
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const analyticsRouter = router({
  overview: protectedProcedure
    .input(
      z.object({
        orgSlug: z.string(),
        period: z.enum(['7d', '30d', '90d']).default('30d'),
      })
    )
    .query(async ({ input, ctx }) => {
      const orgId = await getOrgIdBySlug(input.orgSlug, ctx.user.id)
      const periodStart = getPeriodStart(input.period)
      const now = new Date()

      const [
        totalSkills,
        previousSkills,
        totalInstalls,
        previousInstalls,
        totalStars,
        previousStars,
        activeInstallations,
        installs,
        stars,
        uniqueInstallers,
      ] = await Promise.all([
        prisma.package.count({
          where: { organisationId: orgId },
        }),
        prisma.package.count({
          where: { organisationId: orgId, createdAt: { lt: periodStart } },
        }),
        prisma.packageInstall.count({
          where: { package: { organisationId: orgId } },
        }),
        prisma.packageInstall.count({
          where: {
            package: { organisationId: orgId },
            createdAt: { lt: periodStart },
          },
        }),
        prisma.star.count({
          where: { package: { organisationId: orgId } },
        }),
        prisma.star.count({
          where: {
            package: { organisationId: orgId },
            createdAt: { lt: periodStart },
          },
        }),
        prisma.installationReport.count({
          where: {
            package: { organisationId: orgId },
            lastSeenAt: { gte: periodStart },
          },
        }),
        prisma.packageInstall.findMany({
          where: {
            package: { organisationId: orgId },
            createdAt: { gte: periodStart },
          },
          select: { createdAt: true },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.star.findMany({
          where: {
            package: { organisationId: orgId },
            createdAt: { gte: periodStart },
          },
          select: { createdAt: true },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.packageInstall.groupBy({
          by: ['userId'],
          where: {
            package: { organisationId: orgId },
            createdAt: { gte: periodStart },
          },
        }),
      ])

      const dateBuckets = generateDateBuckets(periodStart, now)

      const installsByDate = new Map<string, number>()
      for (const bucket of dateBuckets) {
        installsByDate.set(bucket, 0)
      }
      for (const install of installs) {
        const key = formatDateKey(install.createdAt)
        installsByDate.set(key, (installsByDate.get(key) ?? 0) + 1)
      }

      const starsByDate = new Map<string, number>()
      for (const bucket of dateBuckets) {
        starsByDate.set(bucket, 0)
      }
      for (const star of stars) {
        const key = formatDateKey(star.createdAt)
        starsByDate.set(key, (starsByDate.get(key) ?? 0) + 1)
      }

      return {
        totalSkills,
        skillsTrend: totalSkills - previousSkills,
        totalInstalls,
        installsTrend: totalInstalls - previousInstalls,
        totalStars,
        starsTrend: totalStars - previousStars,
        activeUsers: uniqueInstallers.length,
        activeInstallations,
        installsOverTime: dateBuckets.map((date) => ({
          label: date.slice(5),
          value: installsByDate.get(date) ?? 0,
        })),
        starsOverTime: dateBuckets.map((date) => ({
          label: date.slice(5),
          value: starsByDate.get(date) ?? 0,
        })),
      }
    }),

  skillAdoption: protectedProcedure
    .input(
      z.object({
        orgSlug: z.string(),
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ input, ctx }) => {
      const orgId = await getOrgIdBySlug(input.orgSlug, ctx.user.id)
      const thirtyDaysAgo = getPeriodStart('30d')

      const topSkills = await prisma.package.findMany({
        where: { organisationId: orgId },
        orderBy: { installCount: 'desc' },
        take: input.limit,
        select: {
          id: true,
          name: true,
          slug: true,
          installCount: true,
          starCount: true,
          _count: {
            select: {
              installationReports: {
                where: { modified: true },
              },
            },
          },
          installs: {
            where: { createdAt: { gte: thirtyDaysAgo } },
            select: { createdAt: true },
            orderBy: { createdAt: 'asc' },
          },
          installationReports: {
            select: { id: true },
          },
        },
      })

      return topSkills.map((skill) => {
        const totalReports = skill.installationReports.length
        const modifiedCount = skill._count.installationReports
        const modificationRate = totalReports > 0 ? modifiedCount / totalReports : 0

        const dateBuckets = generateDateBuckets(thirtyDaysAgo, new Date())
        const trendMap = new Map<string, number>()
        for (const bucket of dateBuckets) {
          trendMap.set(bucket, 0)
        }
        for (const install of skill.installs) {
          const key = formatDateKey(install.createdAt)
          trendMap.set(key, (trendMap.get(key) ?? 0) + 1)
        }

        return {
          id: skill.id,
          name: skill.name,
          slug: skill.slug,
          installCount: skill.installCount,
          starCount: skill.starCount,
          modificationRate: Math.round(modificationRate * 100),
          trend: dateBuckets.map((d) => trendMap.get(d) ?? 0),
        }
      })
    }),

  agentDistribution: protectedProcedure
    .input(z.object({ orgSlug: z.string() }))
    .query(async ({ input, ctx }) => {
      const orgId = await getOrgIdBySlug(input.orgSlug, ctx.user.id)

      const reports = await prisma.installationReport.findMany({
        where: { package: { organisationId: orgId } },
        select: { agents: true },
      })

      const agentCounts = new Map<string, number>()
      for (const report of reports) {
        for (const agent of report.agents) {
          agentCounts.set(agent, (agentCounts.get(agent) ?? 0) + 1)
        }
      }

      return Array.from(agentCounts.entries())
        .map(([agent, count]) => ({ agent, count }))
        .sort((a, b) => b.count - a.count)
    }),

  memberActivity: protectedProcedure
    .input(
      z.object({
        orgSlug: z.string(),
        period: z.enum(['7d', '30d', '90d']).default('30d'),
      })
    )
    .query(async ({ input, ctx }) => {
      const orgId = await getOrgIdBySlug(input.orgSlug, ctx.user.id)
      const periodStart = getPeriodStart(input.period)

      const members = await prisma.organisationMember.findMany({
        where: { organisationId: orgId },
        select: {
          userId: true,
          user: {
            select: { id: true, name: true, email: true, image: true },
          },
        },
      })

      const memberIds = members.map((m) => m.userId)

      const [skillsPublished, proposalsCreated, proposalsMerged, installs] = await Promise.all([
        prisma.package.groupBy({
          by: ['authorId'],
          where: {
            organisationId: orgId,
            authorId: { in: memberIds },
            createdAt: { gte: periodStart },
          },
          _count: { id: true },
        }),
        prisma.changeProposal.groupBy({
          by: ['authorId'],
          where: {
            package: { organisationId: orgId },
            authorId: { in: memberIds },
            createdAt: { gte: periodStart },
          },
          _count: { id: true },
        }),
        prisma.changeProposal.groupBy({
          by: ['authorId'],
          where: {
            package: { organisationId: orgId },
            authorId: { in: memberIds },
            status: 'MERGED',
            mergedAt: { gte: periodStart },
          },
          _count: { id: true },
        }),
        prisma.packageInstall.groupBy({
          by: ['userId'],
          where: {
            package: { organisationId: orgId },
            userId: { in: memberIds },
            createdAt: { gte: periodStart },
          },
          _count: { id: true },
        }),
      ])

      const publishMap = new Map(skillsPublished.map((s) => [s.authorId, s._count.id]))
      const proposalCreatedMap = new Map(proposalsCreated.map((p) => [p.authorId, p._count.id]))
      const proposalMergedMap = new Map(proposalsMerged.map((p) => [p.authorId, p._count.id]))
      const installMap = new Map(installs.map((i) => [i.userId, i._count.id]))

      return members.map((m) => ({
        userId: m.user.id,
        name: m.user.name ?? m.user.email,
        image: m.user.image,
        skillsPublished: publishMap.get(m.userId) ?? 0,
        suggestionsCreated: proposalCreatedMap.get(m.userId) ?? 0,
        suggestionsMerged: proposalMergedMap.get(m.userId) ?? 0,
        installs: installMap.get(m.userId) ?? 0,
      }))
    }),

  versionAdoption: protectedProcedure
    .input(
      z.object({
        orgSlug: z.string(),
        skillName: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      const orgId = await getOrgIdBySlug(input.orgSlug, ctx.user.id)

      const pkg = await prisma.package.findFirst({
        where: { organisationId: orgId, name: input.skillName },
        select: { id: true },
      })

      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Skill not found' })
      }

      const versions = await prisma.packageVersion.findMany({
        where: { packageId: pkg.id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          version: true,
          createdAt: true,
          _count: {
            select: { installs: true },
          },
        },
      })

      if (versions.length === 0) {
        return { versions: [], latestAdoptionRate: 0 }
      }

      const totalInstalls = versions.reduce((sum, v) => sum + v._count.installs, 0)
      const latestVersion = versions[0]!
      const latestAdoptionRate =
        totalInstalls > 0 ? Math.round((latestVersion._count.installs / totalInstalls) * 100) : 0

      return {
        versions: versions.map((v) => ({
          version: v.version,
          installs: v._count.installs,
          percentage: totalInstalls > 0 ? Math.round((v._count.installs / totalInstalls) * 100) : 0,
          isLatest: v.id === latestVersion.id,
        })),
        latestAdoptionRate,
      }
    }),

  auditExport: protectedProcedure
    .input(
      z.object({
        orgSlug: z.string(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
    )
    .query(async ({ input, ctx }) => {
      const org = await prisma.organisation.findUnique({
        where: { slug: input.orgSlug },
        select: { id: true },
      })

      if (!org) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Organisation not found' })
      }

      const membership = await prisma.organisationMember.findUnique({
        where: {
          userId_organisationId: {
            userId: ctx.user.id,
            organisationId: org.id,
          },
        },
        select: { role: true },
      })

      if (!membership || (membership.role !== 'ADMIN' && membership.role !== 'OWNER')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only organisation admins and owners can export audit logs',
        })
      }

      const fromDate = new Date(`${input.from}T00:00:00.000Z`)
      const toDate = new Date(`${input.to}T23:59:59.999Z`)

      if (fromDate > toDate) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'The "from" date must be before the "to" date',
        })
      }

      const memberIds = await prisma.organisationMember
        .findMany({
          where: { organisationId: org.id },
          select: { userId: true },
        })
        .then((members) => members.map((m) => m.userId))

      const logs = await prisma.auditLog.findMany({
        where: {
          userId: { in: memberIds },
          createdAt: { gte: fromDate, lte: toDate },
        },
        orderBy: { createdAt: 'desc' },
        take: 10_000,
        include: {
          user: { select: { name: true, email: true } },
        },
      })

      logger.info('Audit log export via tRPC', {
        orgSlug: input.orgSlug,
        count: logs.length,
        userId: ctx.user.id,
      })

      return logs.map((log) => ({
        timestamp: log.createdAt.toISOString(),
        actor: log.user?.name ?? log.user?.email ?? 'system',
        action: log.action,
        resource: log.resource,
        resourceId: log.resourceId ?? '',
        metadata: log.metadata ?? {},
      }))
    }),
})
