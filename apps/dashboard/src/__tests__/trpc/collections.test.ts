import { prisma } from '@agentver/database/client'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createTestOrg,
  createTestOrgWithOwner,
  createTestPackage,
  createTestUser,
} from '~/test/factories'
import { cleanDatabase, disconnectDatabase } from '~/test/helpers/db'
import { createTestCaller } from '~/test/helpers/trpc'

beforeEach(async () => {
  await cleanDatabase()
})

afterAll(async () => {
  await disconnectDatabase()
})

describe('collections.list', () => {
  it('returns collections for orgs the user is a member of', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)

    await prisma.collection.create({
      data: {
        name: 'My Collection',
        slug: 'my-collection',
        organisationId: org.id,
        authorId: user.id,
        visibility: 'PUBLIC',
      },
    })

    const result = await caller.collections.list()

    expect(result.collections).toHaveLength(1)
    expect(result.collections[0]!.name).toBe('My Collection')
    expect(result.collections[0]!.organisation).toBeDefined()
    expect(result.collections[0]!.author).toBeDefined()
    expect(result.collections[0]!._count).toBeDefined()
  })

  it('does not return collections from orgs the user does not belong to', async () => {
    const { org } = await createTestOrgWithOwner()
    const outsider = await createTestUser()
    const caller = createTestCaller(outsider.id)

    const anotherUser = await createTestUser()
    await prisma.collection.create({
      data: {
        name: 'Private Team Collection',
        slug: 'private-team-collection',
        organisationId: org.id,
        authorId: anotherUser.id,
        visibility: 'PUBLIC',
      },
    })

    const result = await caller.collections.list()

    expect(result.collections).toHaveLength(0)
  })

  it('returns collections from multiple orgs the user belongs to', async () => {
    const user = await createTestUser()
    const org1 = await createTestOrg()
    const org2 = await createTestOrg()

    await prisma.organisationMember.createMany({
      data: [
        { userId: user.id, organisationId: org1.id, role: 'MEMBER' },
        { userId: user.id, organisationId: org2.id, role: 'MEMBER' },
      ],
    })

    await prisma.collection.createMany({
      data: [
        {
          name: 'Org1 Collection',
          slug: 'org1-collection',
          organisationId: org1.id,
          authorId: user.id,
          visibility: 'PUBLIC',
        },
        {
          name: 'Org2 Collection',
          slug: 'org2-collection',
          organisationId: org2.id,
          authorId: user.id,
          visibility: 'PUBLIC',
        },
      ],
    })

    const caller = createTestCaller(user.id)
    const result = await caller.collections.list()

    expect(result.collections).toHaveLength(2)
  })
})

describe('collections.getBySlug', () => {
  it('returns a public collection with its items', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)
    const pkg = await createTestPackage(org.id, user.id)

    const collection = await prisma.collection.create({
      data: {
        name: 'Public Collection',
        slug: 'public-collection',
        organisationId: org.id,
        authorId: user.id,
        visibility: 'PUBLIC',
        items: {
          create: [{ packageId: pkg.id, order: 0 }],
        },
      },
    })

    const result = await caller.collections.getBySlug({ orgSlug: org.slug, slug: collection.slug })

    expect(result.name).toBe('Public Collection')
    expect(result.items).toHaveLength(1)
  })

  it('throws NOT_FOUND for a non-existent collection', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)

    await expect(
      caller.collections.getBySlug({ orgSlug: org.slug, slug: 'does-not-exist' })
    ).rejects.toThrow(/not.found/i)
  })

  it('throws NOT_FOUND for a PRIVATE collection when user is not a member', async () => {
    const { org } = await createTestOrgWithOwner()
    const outsider = await createTestUser()
    const caller = createTestCaller(outsider.id)

    const anotherUser = await createTestUser()
    await prisma.collection.create({
      data: {
        name: 'Secret Collection',
        slug: 'secret-collection',
        organisationId: org.id,
        authorId: anotherUser.id,
        visibility: 'PRIVATE',
      },
    })

    await expect(
      caller.collections.getBySlug({ orgSlug: org.slug, slug: 'secret-collection' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('returns a PRIVATE collection to an org member', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)

    const collection = await prisma.collection.create({
      data: {
        name: 'Members Only',
        slug: 'members-only',
        organisationId: org.id,
        authorId: user.id,
        visibility: 'PRIVATE',
      },
    })

    const result = await caller.collections.getBySlug({ orgSlug: org.slug, slug: collection.slug })

    expect(result.name).toBe('Members Only')
  })
})

describe('collections.create', () => {
  it('creates a collection and auto-slugifies the name', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)

    const result = await caller.collections.create({
      name: 'My Awesome Collection',
      description: 'A test description',
      organisationId: org.id,
      visibility: 'PUBLIC',
    })

    expect(result.name).toBe('My Awesome Collection')
    expect(result.slug).toBe('my-awesome-collection')
  })

  it('throws CONFLICT when a collection with the same slug already exists in the org', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)

    await prisma.collection.create({
      data: {
        name: 'Duplicate',
        slug: 'duplicate',
        organisationId: org.id,
        authorId: user.id,
        visibility: 'PUBLIC',
      },
    })

    await expect(
      caller.collections.create({
        name: 'Duplicate',
        organisationId: org.id,
        visibility: 'PUBLIC',
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('throws when user is not a member of the organisation', async () => {
    const { org } = await createTestOrgWithOwner()
    const outsider = await createTestUser()
    const caller = createTestCaller(outsider.id)

    await expect(
      caller.collections.create({
        name: 'Sneaky Collection',
        organisationId: org.id,
        visibility: 'PUBLIC',
      })
    ).rejects.toThrow()
  })

  it('creates a PRIVATE collection successfully', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)

    const result = await caller.collections.create({
      name: 'Internal Tools',
      organisationId: org.id,
      visibility: 'PRIVATE',
    })

    expect(result.visibility).toBe('PRIVATE')
  })
})

describe('collections.update', () => {
  it('updates the name and re-slugifies', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)

    const collection = await prisma.collection.create({
      data: {
        name: 'Old Name',
        slug: 'old-name',
        organisationId: org.id,
        authorId: user.id,
        visibility: 'PUBLIC',
      },
    })

    const result = await caller.collections.update({
      id: collection.id,
      name: 'New Name Here',
    })

    expect(result.name).toBe('New Name Here')
    expect(result.slug).toBe('new-name-here')
  })

  it('updates description without changing slug', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)

    const collection = await prisma.collection.create({
      data: {
        name: 'Stable Name',
        slug: 'stable-name',
        organisationId: org.id,
        authorId: user.id,
        visibility: 'PUBLIC',
      },
    })

    const result = await caller.collections.update({
      id: collection.id,
      description: 'Updated description',
    })

    expect(result.slug).toBe('stable-name')
    expect(result.description).toBe('Updated description')
  })

  it('updates visibility', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)

    const collection = await prisma.collection.create({
      data: {
        name: 'Visibility Test',
        slug: 'visibility-test',
        organisationId: org.id,
        authorId: user.id,
        visibility: 'PUBLIC',
      },
    })

    const result = await caller.collections.update({
      id: collection.id,
      visibility: 'PRIVATE',
    })

    expect(result.visibility).toBe('PRIVATE')
  })

  it('throws when user is not an org member', async () => {
    const { org } = await createTestOrgWithOwner()
    const outsider = await createTestUser()
    const caller = createTestCaller(outsider.id)

    const owner = await prisma.organisationMember.findFirst({ where: { organisationId: org.id } })
    const collection = await prisma.collection.create({
      data: {
        name: 'Protected',
        slug: 'protected',
        organisationId: org.id,
        authorId: owner!.userId,
        visibility: 'PUBLIC',
      },
    })

    await expect(
      caller.collections.update({ id: collection.id, name: 'Hijacked' })
    ).rejects.toThrow()
  })
})

describe('collections.delete', () => {
  it('allows the author to delete their own collection', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)

    const collection = await prisma.collection.create({
      data: {
        name: 'To Delete',
        slug: 'to-delete',
        organisationId: org.id,
        authorId: user.id,
        visibility: 'PUBLIC',
      },
    })

    await caller.collections.delete({ id: collection.id })

    const deleted = await prisma.collection.findUnique({ where: { id: collection.id } })
    expect(deleted).toBeNull()
  })

  it('allows an org OWNER to delete any collection', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()
    const member = await createTestUser()
    await prisma.organisationMember.create({
      data: { userId: member.id, organisationId: org.id, role: 'MEMBER' },
    })

    const collection = await prisma.collection.create({
      data: {
        name: 'Member Collection',
        slug: 'member-collection',
        organisationId: org.id,
        authorId: member.id,
        visibility: 'PUBLIC',
      },
    })

    const ownerCaller = createTestCaller(owner.id)
    await ownerCaller.collections.delete({ id: collection.id })

    const deleted = await prisma.collection.findUnique({ where: { id: collection.id } })
    expect(deleted).toBeNull()
  })

  it('allows an org ADMIN to delete any collection', async () => {
    const { org } = await createTestOrgWithOwner()
    const admin = await createTestUser()
    const member = await createTestUser()

    await prisma.organisationMember.createMany({
      data: [
        { userId: admin.id, organisationId: org.id, role: 'ADMIN' },
        { userId: member.id, organisationId: org.id, role: 'MEMBER' },
      ],
    })

    const collection = await prisma.collection.create({
      data: {
        name: 'Member Collection',
        slug: 'member-collection-2',
        organisationId: org.id,
        authorId: member.id,
        visibility: 'PUBLIC',
      },
    })

    const adminCaller = createTestCaller(admin.id)
    await adminCaller.collections.delete({ id: collection.id })

    const deleted = await prisma.collection.findUnique({ where: { id: collection.id } })
    expect(deleted).toBeNull()
  })

  it('throws when a non-author MEMBER attempts to delete', async () => {
    const { org } = await createTestOrgWithOwner()
    const author = await createTestUser()
    const otherMember = await createTestUser()

    await prisma.organisationMember.createMany({
      data: [
        { userId: author.id, organisationId: org.id, role: 'MEMBER' },
        { userId: otherMember.id, organisationId: org.id, role: 'MEMBER' },
      ],
    })

    const collection = await prisma.collection.create({
      data: {
        name: 'Author Collection',
        slug: 'author-collection',
        organisationId: org.id,
        authorId: author.id,
        visibility: 'PUBLIC',
      },
    })

    const caller = createTestCaller(otherMember.id)
    await expect(caller.collections.delete({ id: collection.id })).rejects.toThrow()
  })

  it('throws NOT_FOUND for a non-existent collection', async () => {
    const { user } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)

    await expect(caller.collections.delete({ id: 'non-existent-id' })).rejects.toThrow(/not.found/i)
  })
})

describe('collections.addItem', () => {
  it('adds a package to a collection', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)
    const pkg = await createTestPackage(org.id, user.id)

    const collection = await prisma.collection.create({
      data: {
        name: 'Add Item Test',
        slug: 'add-item-test',
        organisationId: org.id,
        authorId: user.id,
        visibility: 'PUBLIC',
      },
    })

    const result = await caller.collections.addItem({
      collectionId: collection.id,
      packageId: pkg.id,
    })

    expect(result.packageId).toBe(pkg.id)
    expect(result.collectionId).toBe(collection.id)
  })

  it('auto-assigns order when order is 0', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)
    const pkg1 = await createTestPackage(org.id, user.id)
    const pkg2 = await createTestPackage(org.id, user.id)

    const collection = await prisma.collection.create({
      data: {
        name: 'Auto Order',
        slug: 'auto-order',
        organisationId: org.id,
        authorId: user.id,
        visibility: 'PUBLIC',
        items: { create: [{ packageId: pkg1.id, order: 1 }] },
      },
    })

    const result = await caller.collections.addItem({
      collectionId: collection.id,
      packageId: pkg2.id,
      order: 0,
    })

    expect(result.order).toBeGreaterThan(0)
  })

  it('throws CONFLICT when adding a package that is already in the collection', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)
    const pkg = await createTestPackage(org.id, user.id)

    const collection = await prisma.collection.create({
      data: {
        name: 'Conflict Test',
        slug: 'conflict-test',
        organisationId: org.id,
        authorId: user.id,
        visibility: 'PUBLIC',
        items: { create: [{ packageId: pkg.id, order: 1 }] },
      },
    })

    await expect(
      caller.collections.addItem({ collectionId: collection.id, packageId: pkg.id })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})

describe('collections.removeItem', () => {
  it('removes a package from a collection', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)
    const pkg = await createTestPackage(org.id, user.id)

    const collection = await prisma.collection.create({
      data: {
        name: 'Remove Item Test',
        slug: 'remove-item-test',
        organisationId: org.id,
        authorId: user.id,
        visibility: 'PUBLIC',
        items: { create: [{ packageId: pkg.id, order: 1 }] },
      },
    })

    await caller.collections.removeItem({ collectionId: collection.id, packageId: pkg.id })

    const item = await prisma.collectionItem.findFirst({
      where: { collectionId: collection.id, packageId: pkg.id },
    })
    expect(item).toBeNull()
  })

  it('throws NOT_FOUND when the package is not in the collection', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)
    const pkg = await createTestPackage(org.id, user.id)

    const collection = await prisma.collection.create({
      data: {
        name: 'Empty Collection',
        slug: 'empty-collection',
        organisationId: org.id,
        authorId: user.id,
        visibility: 'PUBLIC',
      },
    })

    await expect(
      caller.collections.removeItem({ collectionId: collection.id, packageId: pkg.id })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('collections.reorderItems', () => {
  it('batch-updates item order in a transaction', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)
    const pkg1 = await createTestPackage(org.id, user.id)
    const pkg2 = await createTestPackage(org.id, user.id)

    const collection = await prisma.collection.create({
      data: {
        name: 'Reorder Test',
        slug: 'reorder-test',
        organisationId: org.id,
        authorId: user.id,
        visibility: 'PUBLIC',
        items: {
          create: [
            { packageId: pkg1.id, order: 1 },
            { packageId: pkg2.id, order: 2 },
          ],
        },
      },
    })

    const items = await prisma.collectionItem.findMany({ where: { collectionId: collection.id } })

    await caller.collections.reorderItems({
      collectionId: collection.id,
      items: [
        { id: items[0]!.id, order: 2 },
        { id: items[1]!.id, order: 1 },
      ],
    })

    const updated = await prisma.collectionItem.findMany({
      where: { collectionId: collection.id },
      orderBy: { order: 'asc' },
    })

    expect(updated[0]!.id).toBe(items[1]!.id)
    expect(updated[1]!.id).toBe(items[0]!.id)
  })
})

describe('collections.addItems', () => {
  it('adds multiple packages at once', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)
    const pkg1 = await createTestPackage(org.id, user.id)
    const pkg2 = await createTestPackage(org.id, user.id)

    const collection = await prisma.collection.create({
      data: {
        name: 'Bulk Add Test',
        slug: 'bulk-add-test',
        organisationId: org.id,
        authorId: user.id,
        visibility: 'PUBLIC',
      },
    })

    const result = await caller.collections.addItems({
      collectionId: collection.id,
      packageIds: [pkg1.id, pkg2.id],
    })

    expect(result.added).toBe(2)
  })

  it('skips packages already in the collection and returns only newly added count', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)
    const pkg1 = await createTestPackage(org.id, user.id)
    const pkg2 = await createTestPackage(org.id, user.id)

    const collection = await prisma.collection.create({
      data: {
        name: 'Skip Existing Test',
        slug: 'skip-existing-test',
        organisationId: org.id,
        authorId: user.id,
        visibility: 'PUBLIC',
        items: { create: [{ packageId: pkg1.id, order: 1 }] },
      },
    })

    const result = await caller.collections.addItems({
      collectionId: collection.id,
      packageIds: [pkg1.id, pkg2.id],
    })

    // pkg1 already exists, only pkg2 should be added
    expect(result.added).toBe(1)
  })

  it('returns count of 0 when all packages are already present', async () => {
    const { user, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)
    const pkg = await createTestPackage(org.id, user.id)

    const collection = await prisma.collection.create({
      data: {
        name: 'All Existing',
        slug: 'all-existing',
        organisationId: org.id,
        authorId: user.id,
        visibility: 'PUBLIC',
        items: { create: [{ packageId: pkg.id, order: 1 }] },
      },
    })

    const result = await caller.collections.addItems({
      collectionId: collection.id,
      packageIds: [pkg.id],
    })

    expect(result.added).toBe(0)
  })
})
