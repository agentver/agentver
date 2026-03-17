import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
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

describe('versions router', () => {
  beforeEach(async () => {
    await cleanDatabase()
    vi.clearAllMocks()
  })

  // ---------------------------------------------------------------------------
  // list
  // ---------------------------------------------------------------------------

  describe('list', () => {
    it('returns versions ordered by createdAt descending', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'versioned-skill' })

      await createTestVersion(pkg.id, { version: '0.0.1' })
      await createTestVersion(pkg.id, { version: '0.0.2' })
      await createTestVersion(pkg.id, { version: '0.0.3' })

      const caller = createTestCaller(owner.id)
      const result = await caller.versions.list({ packageId: pkg.id })

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(3)

      // Verify descending order — latest first
      expect(result[0]!.version).toBe('0.0.3')
      expect(result[1]!.version).toBe('0.0.2')
      expect(result[2]!.version).toBe('0.0.1')
    })

    it('returns an empty array when a package has no versions', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'empty-versions-skill' })

      const caller = createTestCaller(owner.id)
      const result = await caller.versions.list({ packageId: pkg.id })

      expect(result).toEqual([])
    })

    it('returns versions only for the requested package', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkgA = await createTestPackage(org.id, owner.id, { name: 'versions-pkg-a' })
      const pkgB = await createTestPackage(org.id, owner.id, { name: 'versions-pkg-b' })

      await createTestVersion(pkgA.id, { version: '1.0.0' })
      await createTestVersion(pkgB.id, { version: '2.0.0' })

      const caller = createTestCaller(owner.id)
      const result = await caller.versions.list({ packageId: pkgA.id })

      expect(result.length).toBe(1)
      expect(result[0]!.version).toBe('1.0.0')
      expect(result[0]!.packageId).toBe(pkgA.id)
    })

    it('throws NOT_FOUND when packageId does not exist', async () => {
      const { user: owner } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      await expect(caller.versions.list({ packageId: 'non-existent-pkg' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })

    it('throws UNAUTHORIZED for unauthenticated caller', async () => {
      const caller = createUnauthenticatedCaller()

      await expect(caller.versions.list({ packageId: 'any-id' })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      })
    })
  })

  // ---------------------------------------------------------------------------
  // publish
  // ---------------------------------------------------------------------------

  describe('publish', () => {
    it('publishes a new version for an org member', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'publish-skill' })

      const caller = createTestCaller(owner.id)
      const result = await caller.versions.publish({
        packageId: pkg.id,
        version: '1.0.0',
        changelog: 'Initial release',
      })

      expect(result.version).toBe('1.0.0')
      expect(result.packageId).toBe(pkg.id)
    })

    it('publishes with optional gitRef and gitCommitSha', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'publish-git-skill' })

      const caller = createTestCaller(owner.id)
      const result = await caller.versions.publish({
        packageId: pkg.id,
        version: '1.0.0',
        gitRef: 'refs/tags/v1.0.0',
        gitCommitSha: 'abc1234def5678',
      })

      expect(result.version).toBe('1.0.0')
      expect(result.gitRef).toBe('refs/tags/v1.0.0')
      expect(result.gitCommitSha).toBe('abc1234def5678')
    })

    it('publishes with an optional fileManifest', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'publish-manifest-skill' })

      const caller = createTestCaller(owner.id)
      const result = await caller.versions.publish({
        packageId: pkg.id,
        version: '1.0.0',
        fileManifest: { 'skill.md': {}, 'config.yaml': {} },
      })

      expect(result.version).toBe('1.0.0')
    })

    it('rejects a duplicate version with CONFLICT', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'duplicate-version-skill' })
      await createTestVersion(pkg.id, { version: '1.0.0' })

      const caller = createTestCaller(owner.id)

      await expect(
        caller.versions.publish({ packageId: pkg.id, version: '1.0.0' })
      ).rejects.toMatchObject({ code: 'CONFLICT' })
    })

    it('throws FORBIDDEN when caller is not an org member', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const nonMember = await createTestUser({ email: 'nonmember-publish@example.com' })
      const pkg = await createTestPackage(org.id, owner.id, { name: 'publish-forbidden-skill' })

      const caller = createTestCaller(nonMember.id)

      await expect(
        caller.versions.publish({ packageId: pkg.id, version: '1.0.0' })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('throws NOT_FOUND when packageId does not exist', async () => {
      const { user: owner } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      await expect(
        caller.versions.publish({ packageId: 'non-existent-pkg', version: '1.0.0' })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('rejects invalid semver string', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'invalid-semver-skill' })

      const caller = createTestCaller(owner.id)

      await expect(
        caller.versions.publish({ packageId: pkg.id, version: 'not-semver' })
      ).rejects.toThrow()
    })

    it('throws UNAUTHORIZED for unauthenticated caller', async () => {
      const caller = createUnauthenticatedCaller()

      await expect(
        caller.versions.publish({ packageId: 'any-id', version: '1.0.0' })
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })

    it('publishes multiple sequential versions correctly', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'sequential-versions-skill' })

      const caller = createTestCaller(owner.id)
      await caller.versions.publish({ packageId: pkg.id, version: '1.0.0', changelog: 'v1' })
      await caller.versions.publish({
        packageId: pkg.id,
        version: '1.0.1',
        changelog: 'v1.0.1 patch',
      })
      await caller.versions.publish({
        packageId: pkg.id,
        version: '1.1.0',
        changelog: 'v1.1 minor',
      })

      const listResult = await caller.versions.list({ packageId: pkg.id })
      expect(listResult.length).toBe(3)
      // Verify latest is first
      expect(listResult[0]!.version).toBe('1.1.0')
    })
  })
})
