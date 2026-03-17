import { prisma } from '@agentver/database/client'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestOrgWithOwner, createTestPackage, createTestUser } from '~/test/factories'
import { cleanDatabase, disconnectDatabase } from '~/test/helpers/db'
import { createTestCaller } from '~/test/helpers/trpc'

beforeEach(async () => {
  await cleanDatabase()
})

afterAll(async () => {
  await disconnectDatabase()
})

describe('dashboard.getStats', () => {
  it('returns zeroed stats when the user has no orgs', async () => {
    const user = await createTestUser()
    const caller = createTestCaller(user.id)

    const result = await caller.dashboard.getStats()

    expect(result.totalPackages).toBe(0)
    expect(result.totalVersions).toBe(0)
    expect(result.memberCount).toBe(0)
    expect(result.totalInstallations).toBe(0)
  })

  it("counts packages scoped to the user's orgs only", async () => {
    const { user, org } = await createTestOrgWithOwner()
    const { user: otherUser, org: otherOrg } = await createTestOrgWithOwner()

    await createTestPackage(org.id, user.id)
    await createTestPackage(org.id, user.id)
    // Package in an org the user does not belong to — should not be counted
    await createTestPackage(otherOrg.id, otherUser.id)

    const caller = createTestCaller(user.id)
    const result = await caller.dashboard.getStats()

    expect(result.totalPackages).toBe(2)
  })

  it("counts all members across the user's orgs", async () => {
    const { user, org } = await createTestOrgWithOwner()
    const extra1 = await createTestUser()
    const extra2 = await createTestUser()

    await prisma.organisationMember.createMany({
      data: [
        { userId: extra1.id, organisationId: org.id, role: 'MEMBER' },
        { userId: extra2.id, organisationId: org.id, role: 'MEMBER' },
      ],
    })

    const caller = createTestCaller(user.id)
    const result = await caller.dashboard.getStats()

    // Owner + 2 extra members = 3
    expect(result.memberCount).toBe(3)
  })

  it('includes byType breakdown in stats', async () => {
    const { user, org } = await createTestOrgWithOwner()

    await createTestPackage(org.id, user.id, { type: 'SKILL' })
    await createTestPackage(org.id, user.id, { type: 'SKILL' })
    await createTestPackage(org.id, user.id, { type: 'PROMPT' })

    const caller = createTestCaller(user.id)
    const result = await caller.dashboard.getStats()

    expect(result.byType).toBeDefined()
  })

  it('counts open proposals in stats', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const pkg = await createTestPackage(org.id, user.id)

    await prisma.changeProposal.create({
      data: {
        packageId: pkg.id,
        authorId: user.id,
        status: 'OPEN',
        title: 'Test proposal',
        content: { body: 'Test content' },
      },
    })

    const caller = createTestCaller(user.id)
    const result = await caller.dashboard.getStats()

    expect(result.openProposals).toBe(1)
  })

  it('reports gitLinkedCount for packages linked to a git repository', async () => {
    const { user, org } = await createTestOrgWithOwner()

    await createTestPackage(org.id, user.id, { gitUri: null })
    await createTestPackage(org.id, user.id, { gitUri: 'github.com/test/repo' })

    const caller = createTestCaller(user.id)
    const result = await caller.dashboard.getStats()

    expect(result.gitLinkedCount).toBe(1)
  })
})

describe('dashboard.getRecentPackages', () => {
  it("returns the last 10 updated packages across the user's orgs", async () => {
    const { user, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)

    // Create 12 packages — only the 10 most recently updated should be returned
    for (let i = 0; i < 12; i++) {
      await createTestPackage(org.id, user.id)
    }

    const result = await caller.dashboard.getRecentPackages()

    expect(result).toHaveLength(10)
  })

  it('does not return packages from orgs the user does not belong to', async () => {
    const { user } = await createTestOrgWithOwner()
    const { user: otherUser, org: otherOrg } = await createTestOrgWithOwner()

    await createTestPackage(otherOrg.id, otherUser.id)

    const caller = createTestCaller(user.id)
    const result = await caller.dashboard.getRecentPackages()

    expect(result).toHaveLength(0)
  })

  it('returns packages in most-recently-updated order', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)

    const pkgA = await createTestPackage(org.id, user.id, { name: 'Package A' })
    await createTestPackage(org.id, user.id, { name: 'Package B' })

    // Touch pkgA after pkgB so it should appear first
    await prisma.package.update({
      where: { id: pkgA.id },
      data: { updatedAt: new Date() },
    })

    const result = await caller.dashboard.getRecentPackages()

    expect(result[0]!.name).toBe('Package A')
    expect(result[1]!.name).toBe('Package B')
  })

  it('returns an empty array when the user has no packages', async () => {
    const { user } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)

    const result = await caller.dashboard.getRecentPackages()

    expect(result).toHaveLength(0)
  })
})

describe('dashboard.getRecentActivity', () => {
  it('returns the last 20 audit log entries for the user', async () => {
    const { user } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)

    // Create 25 audit entries — only 20 should be returned
    for (let i = 0; i < 25; i++) {
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'PACKAGE_CREATED',
          resource: 'Package',
          resourceId: `pkg-${i}`,
        },
      })
    }

    const result = await caller.dashboard.getRecentActivity()

    expect(result).toHaveLength(20)
  })

  it('returns entries only for the authenticated user', async () => {
    const { user } = await createTestOrgWithOwner()
    const other = await createTestUser()

    await prisma.auditLog.create({
      data: {
        userId: other.id,
        action: 'PACKAGE_CREATED',
        resource: 'Package',
        resourceId: 'pkg-other',
      },
    })

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'PACKAGE_UPDATED',
        resource: 'Package',
        resourceId: 'pkg-mine',
      },
    })

    const caller = createTestCaller(user.id)
    const result = await caller.dashboard.getRecentActivity()

    expect(result).toHaveLength(1)
    expect(result[0]!.userId).toBe(user.id)
  })

  it('returns an empty array when the user has no activity', async () => {
    const { user } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)

    const result = await caller.dashboard.getRecentActivity()

    expect(result).toHaveLength(0)
  })
})

describe('dashboard.getGettingStartedProgress', () => {
  it('returns all false for a brand-new user', async () => {
    const user = await createTestUser()
    const caller = createTestCaller(user.id)

    const result = await caller.dashboard.getGettingStartedProgress()

    expect(result.hasOrg).toBe(false)
    expect(result.hasPackage).toBe(false)
    expect(result.hasApiKey).toBe(false)
    expect(result.hasConnectedGitHub).toBe(false)
  })

  it('reports hasOrg true when the user belongs to an org', async () => {
    const { user } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)

    const result = await caller.dashboard.getGettingStartedProgress()

    expect(result.hasOrg).toBe(true)
  })

  it("reports hasPackage true when the user's org has a package", async () => {
    const { user, org } = await createTestOrgWithOwner()
    await createTestPackage(org.id, user.id)
    const caller = createTestCaller(user.id)

    const result = await caller.dashboard.getGettingStartedProgress()

    expect(result.hasPackage).toBe(true)
  })

  it('reports hasApiKey true when the user has created an API key', async () => {
    const { user, org } = await createTestOrgWithOwner()

    await prisma.apiKey.create({
      data: {
        userId: user.id,
        organisationId: org.id,
        name: 'My Key',
        keyHash: 'hashed-key-value',
        keyPrefix: 'av_',
      },
    })

    const caller = createTestCaller(user.id)
    const result = await caller.dashboard.getGettingStartedProgress()

    expect(result.hasApiKey).toBe(true)
  })

  it('reports hasConnectedGitHub true when the user has a GitHub connected account', async () => {
    const { user } = await createTestOrgWithOwner()

    await prisma.connectedAccount.create({
      data: {
        userId: user.id,
        provider: 'GITHUB',
        providerAccountId: 'gh-123',
        accessToken: 'test-token',
        scopes: ['repo'],
      },
    })

    const caller = createTestCaller(user.id)
    const result = await caller.dashboard.getGettingStartedProgress()

    expect(result.hasConnectedGitHub).toBe(true)
  })

  it('returns accurate mixed state when some steps are complete', async () => {
    const { user, org } = await createTestOrgWithOwner()
    await createTestPackage(org.id, user.id)
    // No API key, no GitHub

    const caller = createTestCaller(user.id)
    const result = await caller.dashboard.getGettingStartedProgress()

    expect(result.hasOrg).toBe(true)
    expect(result.hasPackage).toBe(true)
    expect(result.hasApiKey).toBe(false)
    expect(result.hasConnectedGitHub).toBe(false)
  })
})

describe('dashboard.getRecentInstallations', () => {
  it('returns the last 10 installation reports', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const pkg = await createTestPackage(org.id, user.id)

    for (let i = 0; i < 12; i++) {
      await prisma.installationReport.create({
        data: {
          packageId: pkg.id,
          userId: user.id,
          machineId: `machine-${i}`,
        },
      })
    }

    const caller = createTestCaller(user.id)
    const result = await caller.dashboard.getRecentInstallations()

    expect(result).toHaveLength(10)
  })

  it('does not return installation reports for orgs the user does not belong to', async () => {
    const { user } = await createTestOrgWithOwner()
    const { user: otherUser, org: otherOrg } = await createTestOrgWithOwner()
    const pkg = await createTestPackage(otherOrg.id, otherUser.id)

    await prisma.installationReport.create({
      data: {
        packageId: pkg.id,
        userId: otherUser.id,
        machineId: 'machine-other',
      },
    })

    const caller = createTestCaller(user.id)
    const result = await caller.dashboard.getRecentInstallations()

    expect(result).toHaveLength(0)
  })

  it('returns an empty array when there are no installation reports', async () => {
    const { user } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)

    const result = await caller.dashboard.getRecentInstallations()

    expect(result).toHaveLength(0)
  })
})

describe('dashboard.getInstallationMap', () => {
  it("returns all installation reports for the user's orgs", async () => {
    const { user, org } = await createTestOrgWithOwner()
    const pkg = await createTestPackage(org.id, user.id)

    await prisma.installationReport.createMany({
      data: [
        { packageId: pkg.id, userId: user.id, machineId: 'machine-1' },
        { packageId: pkg.id, userId: user.id, machineId: 'machine-2' },
        { packageId: pkg.id, userId: user.id, machineId: 'machine-3' },
      ],
    })

    const caller = createTestCaller(user.id)
    const result = await caller.dashboard.getInstallationMap()

    expect(result).toHaveLength(3)
  })

  it('excludes reports from orgs the user does not belong to', async () => {
    const { user } = await createTestOrgWithOwner()
    const { user: otherUser, org: otherOrg } = await createTestOrgWithOwner()
    const pkg = await createTestPackage(otherOrg.id, otherUser.id)

    await prisma.installationReport.create({
      data: {
        packageId: pkg.id,
        userId: otherUser.id,
        machineId: 'machine-foreign',
      },
    })

    const caller = createTestCaller(user.id)
    const result = await caller.dashboard.getInstallationMap()

    expect(result).toHaveLength(0)
  })

  it('returns all reports without a limit', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const pkg = await createTestPackage(org.id, user.id)

    for (let i = 0; i < 25; i++) {
      await prisma.installationReport.create({
        data: {
          packageId: pkg.id,
          userId: user.id,
          machineId: `machine-${i}`,
        },
      })
    }

    const caller = createTestCaller(user.id)
    const result = await caller.dashboard.getInstallationMap()

    expect(result).toHaveLength(25)
  })
})
