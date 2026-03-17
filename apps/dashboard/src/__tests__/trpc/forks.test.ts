import { prisma } from '@agentver/database/client'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTestOrg,
  createTestOrgWithOwner,
  createTestPackage,
  createTestUser,
  createTestVersion,
} from '~/test/factories'
import { cleanDatabase, disconnectDatabase } from '~/test/helpers/db'
import { createTestCaller, createUnauthenticatedCaller } from '~/test/helpers/trpc'

afterAll(async () => {
  await disconnectDatabase()
})

describe('forks router', () => {
  beforeEach(async () => {
    await cleanDatabase()
    vi.clearAllMocks()
  })

  // ---------------------------------------------------------------------------
  // checkUpstreamUpdates
  // ---------------------------------------------------------------------------

  describe('checkUpstreamUpdates', () => {
    it('returns update info when fork has a newer upstream version', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const upstreamOrg = await createTestOrg({ slug: 'upstream-org' })
      const upstreamUser = await createTestUser()
      const upstreamPkg = await createTestPackage(upstreamOrg.id, upstreamUser.id, {
        name: 'my-skill',
      })
      await createTestVersion(upstreamPkg.id, { version: '0.0.1' })

      const forkPkg = await createTestPackage(org.id, owner.id, {
        name: 'my-skill',
        forkedFromId: upstreamPkg.id,
      })
      const forkV = await createTestVersion(forkPkg.id, { version: '0.0.1' })

      // Create upstream v0.0.2 AFTER the fork version so the date filter picks it up
      const upstreamV2 = await createTestVersion(upstreamPkg.id, { version: '0.0.2' })
      // Ensure upstream v0.0.2 timestamp is strictly after the fork version
      await prisma.packageVersion.update({
        where: { id: upstreamV2.id },
        data: { createdAt: new Date(new Date(forkV.createdAt).getTime() + 1000) },
      })

      const caller = createTestCaller(owner.id)
      const result = await caller.forks.checkUpstreamUpdates({ packageId: forkPkg.id })

      expect(result.hasUpdates).toBe(true)
      expect(result.upstreamLatestVersion).toBe('0.0.2')
      expect(result.currentVersion).toBe('0.0.1')
      expect(result.upstreamVersions.some((v) => v.version === '0.0.2')).toBe(true)
    })

    it('returns hasUpdates false when fork is up to date with upstream', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const upstreamOrg = await createTestOrg({ slug: 'upstream-org-2' })
      const upstreamUser = await createTestUser()
      const upstreamPkg = await createTestPackage(upstreamOrg.id, upstreamUser.id, {
        name: 'my-skill-b',
      })
      await createTestVersion(upstreamPkg.id, { version: '0.0.1' })

      const forkPkg = await createTestPackage(org.id, owner.id, {
        name: 'my-skill-b',
        forkedFromId: upstreamPkg.id,
      })
      await createTestVersion(forkPkg.id, { version: '0.0.1' })

      const caller = createTestCaller(owner.id)
      const result = await caller.forks.checkUpstreamUpdates({ packageId: forkPkg.id })

      expect(result.hasUpdates).toBe(false)
      expect(result.currentVersion).toBe('0.0.1')
    })

    it('throws BAD_REQUEST when package is not a fork', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'not-a-fork' })

      const caller = createTestCaller(owner.id)

      await expect(caller.forks.checkUpstreamUpdates({ packageId: pkg.id })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      })
    })

    it('throws NOT_FOUND when packageId does not exist', async () => {
      const { user: owner } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      await expect(
        caller.forks.checkUpstreamUpdates({ packageId: 'non-existent-id' })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    it('throws UNAUTHORIZED when caller is unauthenticated', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const upstreamOrg = await createTestOrg({ slug: 'upstream-unauth' })
      const upstreamUser = await createTestUser()
      const upstreamPkg = await createTestPackage(upstreamOrg.id, upstreamUser.id, {
        name: 'skill-unauth',
      })
      const forkPkg = await createTestPackage(org.id, owner.id, {
        name: 'skill-unauth',
        forkedFromId: upstreamPkg.id,
      })

      const caller = createUnauthenticatedCaller()

      await expect(
        caller.forks.checkUpstreamUpdates({ packageId: forkPkg.id })
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })
  })

  // ---------------------------------------------------------------------------
  // getUpstreamDiff
  // ---------------------------------------------------------------------------

  describe('getUpstreamDiff', () => {
    it('returns diff data for a valid fork', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const upstreamOrg = await createTestOrg({ slug: 'upstream-diff-org' })
      const upstreamUser = await createTestUser()
      const upstreamPkg = await createTestPackage(upstreamOrg.id, upstreamUser.id, {
        name: 'diff-skill',
      })
      await createTestVersion(upstreamPkg.id, { version: '0.0.1' })

      const forkPkg = await createTestPackage(org.id, owner.id, {
        name: 'diff-skill',
        forkedFromId: upstreamPkg.id,
      })
      await createTestVersion(forkPkg.id, { version: '0.0.1' })

      const caller = createTestCaller(owner.id)
      const result = await caller.forks.getUpstreamDiff({ packageId: forkPkg.id })

      expect(result).toMatchObject({
        forkVersion: '0.0.1',
        upstreamVersion: expect.any(String),
        upstreamOrg: 'upstream-diff-org',
        upstreamName: 'diff-skill',
      })
      expect(result.forkContent).toBeDefined()
      expect(result.upstreamContent).toBeDefined()
    })

    it('throws BAD_REQUEST when package is not a fork', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'plain-pkg' })

      const caller = createTestCaller(owner.id)

      await expect(caller.forks.getUpstreamDiff({ packageId: pkg.id })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      })
    })

    it('throws NOT_FOUND for unknown packageId', async () => {
      const { user: owner } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      await expect(
        caller.forks.getUpstreamDiff({ packageId: 'does-not-exist' })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    it('throws UNAUTHORIZED for unauthenticated caller', async () => {
      const caller = createUnauthenticatedCaller()

      await expect(caller.forks.getUpstreamDiff({ packageId: 'any-id' })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      })
    })
  })

  // ---------------------------------------------------------------------------
  // syncFromUpstream
  // ---------------------------------------------------------------------------

  // Skipped: requires git-native storage implementation
  describe.skip('syncFromUpstream', () => {
    it('syncs upstream content and bumps version for fork author', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const upstreamOrg = await createTestOrg({ slug: 'upstream-sync-org' })
      const upstreamUser = await createTestUser()
      const upstreamPkg = await createTestPackage(upstreamOrg.id, upstreamUser.id, {
        name: 'sync-skill',
      })
      await createTestVersion(upstreamPkg.id, { version: '0.0.2' })

      const forkPkg = await createTestPackage(org.id, owner.id, {
        name: 'sync-skill',
        forkedFromId: upstreamPkg.id,
      })
      await createTestVersion(forkPkg.id, { version: '0.0.1' })

      const caller = createTestCaller(owner.id)
      const result = await caller.forks.syncFromUpstream({ packageId: forkPkg.id })

      expect(result).toBeDefined()
    })

    it('throws FORBIDDEN when caller is not a fork author or admin', async () => {
      const { org } = await createTestOrgWithOwner()
      const outsider = await createTestUser({ email: 'outsider@example.com' })
      const upstreamOrg = await createTestOrg({ slug: 'upstream-sync-forbidden' })
      const upstreamUser = await createTestUser()
      const upstreamPkg = await createTestPackage(upstreamOrg.id, upstreamUser.id, {
        name: 'forbidden-sync',
      })
      const forkUser = await createTestUser()
      const forkPkg = await createTestPackage(org.id, forkUser.id, {
        name: 'forbidden-sync',
        forkedFromId: upstreamPkg.id,
      })

      const caller = createTestCaller(outsider.id)

      await expect(caller.forks.syncFromUpstream({ packageId: forkPkg.id })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
    })

    it('throws BAD_REQUEST when package is not a fork', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'not-a-fork-sync' })

      const caller = createTestCaller(owner.id)

      await expect(caller.forks.syncFromUpstream({ packageId: pkg.id })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      })
    })

    it('throws UNAUTHORIZED for unauthenticated caller', async () => {
      const caller = createUnauthenticatedCaller()

      await expect(caller.forks.syncFromUpstream({ packageId: 'any-id' })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      })
    })
  })

  // ---------------------------------------------------------------------------
  // createUpstreamProposal
  // ---------------------------------------------------------------------------

  describe('createUpstreamProposal', () => {
    it('creates a change proposal on the upstream package for a fork org member', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const upstreamOrg = await createTestOrg({ slug: 'upstream-proposal-org' })
      const upstreamUser = await createTestUser()
      const upstreamPkg = await createTestPackage(upstreamOrg.id, upstreamUser.id, {
        name: 'proposal-skill',
      })
      await createTestVersion(upstreamPkg.id, { version: '0.0.1' })

      const forkPkg = await createTestPackage(org.id, owner.id, {
        name: 'proposal-skill',
        forkedFromId: upstreamPkg.id,
      })
      await createTestVersion(forkPkg.id, { version: '0.0.1' })

      const caller = createTestCaller(owner.id)
      const result = await caller.forks.createUpstreamProposal({
        packageId: forkPkg.id,
        description: 'Proposing improvements to upstream',
      })

      expect(result).toBeDefined()

      const proposal = await prisma.changeProposal.findFirst({
        where: { packageId: upstreamPkg.id, authorId: owner.id },
      })
      expect(proposal).not.toBeNull()
    })

    it('creates proposal without optional description', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const upstreamOrg = await createTestOrg({ slug: 'upstream-nodesc-org' })
      const upstreamUser = await createTestUser()
      const upstreamPkg = await createTestPackage(upstreamOrg.id, upstreamUser.id, {
        name: 'nodesc-skill',
      })
      await createTestVersion(upstreamPkg.id, { version: '0.0.1' })

      const forkPkg = await createTestPackage(org.id, owner.id, {
        name: 'nodesc-skill',
        forkedFromId: upstreamPkg.id,
      })
      await createTestVersion(forkPkg.id, { version: '0.0.1' })

      const caller = createTestCaller(owner.id)
      const result = await caller.forks.createUpstreamProposal({ packageId: forkPkg.id })

      expect(result).toBeDefined()
    })

    it('throws BAD_REQUEST when package is not a fork', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'not-fork-proposal' })

      const caller = createTestCaller(owner.id)

      await expect(
        caller.forks.createUpstreamProposal({ packageId: pkg.id })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    })

    it('throws FORBIDDEN when caller is not an org member', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const outsider = await createTestUser({ email: 'outsider2@example.com' })
      const upstreamOrg = await createTestOrg({ slug: 'upstream-forbidden-org' })
      const upstreamUser = await createTestUser()
      const upstreamPkg = await createTestPackage(upstreamOrg.id, upstreamUser.id, {
        name: 'forbidden-proposal',
      })
      const forkPkg = await createTestPackage(org.id, owner.id, {
        name: 'forbidden-proposal',
        forkedFromId: upstreamPkg.id,
      })

      const caller = createTestCaller(outsider.id)

      await expect(
        caller.forks.createUpstreamProposal({ packageId: forkPkg.id })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('throws UNAUTHORIZED for unauthenticated caller', async () => {
      const caller = createUnauthenticatedCaller()

      await expect(
        caller.forks.createUpstreamProposal({ packageId: 'any-id' })
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })
  })

  // ---------------------------------------------------------------------------
  // listForks
  // ---------------------------------------------------------------------------

  describe('listForks', () => {
    it('returns all forks of a package', async () => {
      const upstreamOrg = await createTestOrg({ slug: 'list-forks-upstream' })
      const upstreamUser = await createTestUser()
      const upstreamPkg = await createTestPackage(upstreamOrg.id, upstreamUser.id, {
        name: 'list-forks-skill',
      })

      const forkOrgA = await createTestOrg({ slug: 'fork-org-a' })
      const forkOrgB = await createTestOrg({ slug: 'fork-org-b' })
      const forkUserA = await createTestUser()
      const forkUserB = await createTestUser()
      await createTestPackage(forkOrgA.id, forkUserA.id, {
        name: 'list-forks-skill',
        forkedFromId: upstreamPkg.id,
      })
      await createTestPackage(forkOrgB.id, forkUserB.id, {
        name: 'list-forks-skill',
        forkedFromId: upstreamPkg.id,
      })

      const { user: viewer } = await createTestOrgWithOwner()
      const caller = createTestCaller(viewer.id)
      const result = await caller.forks.listForks({ packageId: upstreamPkg.id })

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(2)
    })

    it('returns empty array when package has no forks', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'no-forks-skill' })

      const caller = createTestCaller(owner.id)
      const result = await caller.forks.listForks({ packageId: pkg.id })

      expect(result).toEqual([])
    })

    it('returns empty array for unknown packageId', async () => {
      const { user: owner } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      const result = await caller.forks.listForks({ packageId: 'unknown-pkg' })
      expect(result).toEqual([])
    })

    it('throws UNAUTHORIZED for unauthenticated caller', async () => {
      const caller = createUnauthenticatedCaller()

      await expect(caller.forks.listForks({ packageId: 'any-id' })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      })
    })
  })
})
