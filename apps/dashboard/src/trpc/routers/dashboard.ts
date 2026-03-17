import { prisma } from '@agentver/database'
import { protectedProcedure, router } from '../init'

export const dashboardRouter = router({
  getStats: protectedProcedure.query(async ({ ctx }) => {
    const userOrgIds = await prisma.organisationMember
      .findMany({
        where: { userId: ctx.user.id },
        select: { organisationId: true },
      })
      .then((members) => members.map((m) => m.organisationId))

    const [
      totalPackages,
      totalVersions,
      memberCount,
      typeBreakdown,
      totalInstallations,
      modifiedInstallations,
      installationUsers,
      openProposals,
      gitLinkedCount,
    ] = await Promise.all([
      prisma.package.count({
        where: { organisationId: { in: userOrgIds } },
      }),

      prisma.packageVersion.count({
        where: { package: { organisationId: { in: userOrgIds } } },
      }),

      prisma.organisationMember.count({
        where: { organisationId: { in: userOrgIds } },
      }),

      prisma.package.groupBy({
        by: ['type'],
        where: { organisationId: { in: userOrgIds } },
        _count: { id: true },
      }),

      prisma.installationReport.count({
        where: { package: { organisationId: { in: userOrgIds } } },
      }),

      prisma.installationReport.count({
        where: {
          package: { organisationId: { in: userOrgIds } },
          modified: true,
        },
      }),

      prisma.installationReport.groupBy({
        by: ['userId'],
        where: { package: { organisationId: { in: userOrgIds } } },
      }),

      prisma.changeProposal.count({
        where: {
          package: { organisationId: { in: userOrgIds } },
          status: 'OPEN',
        },
      }),

      prisma.package.count({
        where: {
          organisationId: { in: userOrgIds },
          gitUri: { not: null },
        },
      }),
    ])

    const byType = typeBreakdown.reduce<Record<string, number>>((acc, row) => {
      acc[row.type] = row._count.id
      return acc
    }, {})

    return {
      totalPackages,
      totalVersions,
      memberCount,
      byType,
      totalInstallations,
      modifiedInstallations,
      activeTeamMembers: installationUsers.length,
      openProposals,
      gitLinkedCount,
    }
  }),

  getRecentPackages: protectedProcedure.query(async ({ ctx }) => {
    const userOrgIds = await prisma.organisationMember
      .findMany({
        where: { userId: ctx.user.id },
        select: { organisationId: true },
      })
      .then((members) => members.map((m) => m.organisationId))

    return prisma.package.findMany({
      where: { organisationId: { in: userOrgIds } },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        updatedAt: true,
        gitUri: true,
        gitPath: true,
        gitDefaultRef: true,
        organisation: { select: { slug: true, name: true } },
      },
    })
  }),

  getRecentActivity: protectedProcedure.query(async ({ ctx }) => {
    return prisma.auditLog.findMany({
      where: { userId: ctx.user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        userId: true,
        action: true,
        resource: true,
        resourceId: true,
        metadata: true,
        createdAt: true,
        user: { select: { name: true, image: true } },
      },
    })
  }),

  getRecentInstallations: protectedProcedure.query(async ({ ctx }) => {
    const userOrgIds = await prisma.organisationMember
      .findMany({
        where: { userId: ctx.user.id },
        select: { organisationId: true },
      })
      .then((members) => members.map((m) => m.organisationId))

    return prisma.installationReport.findMany({
      where: { package: { organisationId: { in: userOrgIds } } },
      orderBy: { lastSeenAt: 'desc' },
      take: 10,
      include: {
        package: {
          select: {
            name: true,
            slug: true,
            organisation: { select: { slug: true } },
          },
        },
        user: { select: { name: true, email: true, image: true } },
        version: { select: { version: true, gitRef: true } },
      },
    })
  }),

  getInstallationMap: protectedProcedure.query(async ({ ctx }) => {
    const userOrgIds = await prisma.organisationMember
      .findMany({
        where: { userId: ctx.user.id },
        select: { organisationId: true },
      })
      .then((members) => members.map((m) => m.organisationId))

    return prisma.installationReport.findMany({
      where: { package: { organisationId: { in: userOrgIds } } },
      orderBy: [{ package: { name: 'asc' } }, { user: { name: 'asc' } }],
      include: {
        package: {
          select: {
            id: true,
            name: true,
            slug: true,
            organisation: { select: { slug: true } },
          },
        },
        user: { select: { id: true, name: true, email: true, image: true } },
      },
    })
  }),

  getGettingStartedProgress: protectedProcedure.query(async ({ ctx }) => {
    const [orgCount, packageCount, apiKeyCount, connectionCount, orgWithRepo] = await Promise.all([
      prisma.organisationMember.count({
        where: { userId: ctx.user.id },
      }),

      prisma.package.count({
        where: { authorId: ctx.user.id },
      }),

      prisma.apiKey.count({
        where: { userId: ctx.user.id },
      }),

      prisma.connectedAccount.count({
        where: { userId: ctx.user.id, provider: 'GITHUB' },
      }),

      prisma.organisation.findFirst({
        where: {
          members: { some: { userId: ctx.user.id } },
          skillsRepoUrl: { not: null },
        },
        select: { id: true },
      }),
    ])

    return {
      hasOrg: orgCount > 0,
      hasSkillsRepo: !!orgWithRepo,
      hasPackage: packageCount > 0,
      hasApiKey: apiKeyCount > 0,
      hasConnectedGitHub: connectionCount > 0,
    }
  }),
})
