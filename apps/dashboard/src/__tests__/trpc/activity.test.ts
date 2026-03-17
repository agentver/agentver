import { prisma } from '@agentver/database/client'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestOrgWithOwner, createTestPackage } from '~/test/factories'
import { cleanDatabase, disconnectDatabase } from '~/test/helpers/db'
import { createTestCaller, createUnauthenticatedCaller } from '~/test/helpers/trpc'

afterAll(async () => {
  await disconnectDatabase()
})

describe('activity router', () => {
  beforeEach(async () => {
    await cleanDatabase()
    vi.clearAllMocks()
  })

  // ---------------------------------------------------------------------------
  // getPackageActivity
  // ---------------------------------------------------------------------------

  describe('getPackageActivity', () => {
    it('returns audit log entries for a package', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'activity-skill' })

      await prisma.auditLog.create({
        data: {
          userId: owner.id,
          action: 'PACKAGE_CREATED',
          resource: 'Package',
          resourceId: pkg.id,
        },
      })

      const caller = createTestCaller(owner.id)
      const result = await caller.activity.getPackageActivity({ packageId: pkg.id })

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result.some((entry) => entry.action === 'PACKAGE_CREATED')).toBe(true)
    })

    it('includes audit log entries for the package proposals', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'activity-proposals-skill' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Activity Proposal',
          content: { body: 'Content' },
          status: 'OPEN',
        },
      })

      await prisma.auditLog.create({
        data: {
          userId: owner.id,
          action: 'PACKAGE_CREATED',
          resource: 'Package',
          resourceId: pkg.id,
        },
      })
      await prisma.auditLog.create({
        data: {
          userId: owner.id,
          action: 'PROPOSAL_CREATED',
          resource: 'ChangeProposal',
          resourceId: proposal.id,
        },
      })

      const caller = createTestCaller(owner.id)
      const result = await caller.activity.getPackageActivity({ packageId: pkg.id })

      const actions = result.map((entry) => entry.action)
      expect(actions).toContain('PACKAGE_CREATED')
      expect(actions).toContain('PROPOSAL_CREATED')
    })

    it('returns an empty array when the package has no audit log entries', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'no-activity-skill' })

      const caller = createTestCaller(owner.id)
      const result = await caller.activity.getPackageActivity({ packageId: pkg.id })

      expect(result).toEqual([])
    })

    it('does not include audit log entries from unrelated packages', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkgA = await createTestPackage(org.id, owner.id, { name: 'activity-pkg-a' })
      const pkgB = await createTestPackage(org.id, owner.id, { name: 'activity-pkg-b' })

      await prisma.auditLog.create({
        data: {
          userId: owner.id,
          action: 'PACKAGE_CREATED',
          resource: 'Package',
          resourceId: pkgA.id,
        },
      })
      await prisma.auditLog.create({
        data: {
          userId: owner.id,
          action: 'PACKAGE_CREATED',
          resource: 'Package',
          resourceId: pkgB.id,
        },
      })

      const caller = createTestCaller(owner.id)
      const result = await caller.activity.getPackageActivity({ packageId: pkgA.id })

      // All returned entries must belong to pkgA or its proposals — none should reference pkgB
      const pkgBEntry = result.find(
        (entry) => entry.resource === 'Package' && entry.resourceId === pkgB.id
      )
      expect(pkgBEntry).toBeUndefined()
    })

    it('returns multiple entries in chronological order', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'ordered-activity-skill' })

      await prisma.auditLog.create({
        data: {
          userId: owner.id,
          action: 'PACKAGE_CREATED',
          resource: 'Package',
          resourceId: pkg.id,
        },
      })
      await prisma.auditLog.create({
        data: {
          userId: owner.id,
          action: 'PACKAGE_UPDATED',
          resource: 'Package',
          resourceId: pkg.id,
        },
      })
      await prisma.auditLog.create({
        data: {
          userId: owner.id,
          action: 'VERSION_PUBLISHED',
          resource: 'Package',
          resourceId: pkg.id,
        },
      })

      const caller = createTestCaller(owner.id)
      const result = await caller.activity.getPackageActivity({ packageId: pkg.id })

      expect(result.length).toBe(3)

      // Verify ordering — entries should be ordered consistently (ascending or descending)
      const timestamps = result.map((e) => new Date(e.createdAt).getTime())
      const isAscending = timestamps.every((t, i) => i === 0 || t >= timestamps[i - 1]!)
      const isDescending = timestamps.every((t, i) => i === 0 || t <= timestamps[i - 1]!)
      expect(isAscending || isDescending).toBe(true)
    })

    it('requires authentication (protected procedure)', async () => {
      const caller = createUnauthenticatedCaller()

      await expect(
        caller.activity.getPackageActivity({ packageId: 'any-id' })
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })

    it('throws NOT_FOUND when packageId does not exist', async () => {
      const { user: owner } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      await expect(
        caller.activity.getPackageActivity({ packageId: 'non-existent-pkg' })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    it('returns activity for a package with multiple proposal events', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, {
        name: 'multi-proposal-activity-skill',
      })

      const proposalA = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Proposal A',
          content: { body: 'A' },
          status: 'MERGED',
        },
      })
      const proposalB = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Proposal B',
          content: { body: 'B' },
          status: 'OPEN',
        },
      })

      await prisma.auditLog.create({
        data: {
          userId: owner.id,
          action: 'PROPOSAL_CREATED',
          resource: 'ChangeProposal',
          resourceId: proposalA.id,
        },
      })
      await prisma.auditLog.create({
        data: {
          userId: owner.id,
          action: 'PROPOSAL_MERGED',
          resource: 'ChangeProposal',
          resourceId: proposalA.id,
        },
      })
      await prisma.auditLog.create({
        data: {
          userId: owner.id,
          action: 'PROPOSAL_CREATED',
          resource: 'ChangeProposal',
          resourceId: proposalB.id,
        },
      })

      const caller = createTestCaller(owner.id)
      const result = await caller.activity.getPackageActivity({ packageId: pkg.id })

      expect(result.length).toBe(3)
      const actions = result.map((e) => e.action)
      expect(actions).toContain('PROPOSAL_CREATED')
      expect(actions).toContain('PROPOSAL_MERGED')
    })

    it('returns activity for an authenticated user', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, {
        name: 'auth-vs-public-activity-skill',
      })

      await prisma.auditLog.create({
        data: {
          userId: owner.id,
          action: 'PACKAGE_CREATED',
          resource: 'Package',
          resourceId: pkg.id,
        },
      })

      const caller = createTestCaller(owner.id)
      const result = await caller.activity.getPackageActivity({ packageId: pkg.id })

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]!.action).toBe('PACKAGE_CREATED')
    })
  })
})
