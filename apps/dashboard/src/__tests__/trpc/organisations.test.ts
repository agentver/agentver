import { prisma } from '@agentver/database/client'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestOrg, createTestOrgWithOwner, createTestUser } from '~/test/factories'
import { cleanDatabase, disconnectDatabase } from '~/test/helpers/db'
import { createTestCaller } from '~/test/helpers/trpc'

vi.mock('@/lib/github/skills-repo', () => ({
  validateRepoAccess: vi.fn().mockResolvedValue(true),
}))

beforeEach(async () => {
  await cleanDatabase()
})

afterAll(async () => {
  await disconnectDatabase()
})

describe('organisations router', () => {
  describe('list', () => {
    it('returns organisations where the user is a member', async () => {
      const { user, org } = await createTestOrgWithOwner()
      const caller = createTestCaller(user.id)

      const result = await caller.organisations.list()

      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe(org.id)
    })

    it('includes member count and package count in results', async () => {
      const { user } = await createTestOrgWithOwner()
      const caller = createTestCaller(user.id)

      const result = await caller.organisations.list()

      expect(result[0]).toHaveProperty('_count')
      expect(result[0]!._count).toHaveProperty('members')
      expect(result[0]!._count).toHaveProperty('packages')
    })

    it('returns empty array when user is not a member of any organisation', async () => {
      const user = await createTestUser()
      const caller = createTestCaller(user.id)

      const result = await caller.organisations.list()

      expect(result).toHaveLength(0)
    })

    it('does not return organisations the user is not a member of', async () => {
      const nonMember = await createTestUser()
      await createTestOrgWithOwner()
      const caller = createTestCaller(nonMember.id)

      const result = await caller.organisations.list()

      expect(result).toHaveLength(0)
    })

    it('returns multiple organisations when user is a member of several', async () => {
      const user = await createTestUser()
      const org1 = await createTestOrg()
      const org2 = await createTestOrg()

      await prisma.organisationMember.createMany({
        data: [
          { userId: user.id, organisationId: org1.id, role: 'OWNER' },
          { userId: user.id, organisationId: org2.id, role: 'OWNER' },
        ],
      })

      const caller = createTestCaller(user.id)
      const result = await caller.organisations.list()

      expect(result).toHaveLength(2)
    })
  })

  describe('getBySlug', () => {
    it('returns the organisation with members for a member', async () => {
      const { user, org } = await createTestOrgWithOwner()
      const caller = createTestCaller(user.id)

      const result = await caller.organisations.getBySlug({ slug: org.slug })

      expect(result.id).toBe(org.id)
      expect(result.slug).toBe(org.slug)
      expect(result).toHaveProperty('members')
    })

    it('throws NOT_FOUND when the organisation does not exist', async () => {
      const user = await createTestUser()
      const caller = createTestCaller(user.id)

      await expect(caller.organisations.getBySlug({ slug: 'non-existent-org' })).rejects.toThrow(
        expect.objectContaining({ code: 'NOT_FOUND' })
      )
    })

    it('throws FORBIDDEN when user is not a member of the organisation', async () => {
      const nonMember = await createTestUser()
      const { org } = await createTestOrgWithOwner()
      const caller = createTestCaller(nonMember.id)

      await expect(caller.organisations.getBySlug({ slug: org.slug })).rejects.toThrow(
        expect.objectContaining({ code: 'FORBIDDEN' })
      )
    })
  })

  describe('create', () => {
    it('creates an organisation with the user as OWNER', async () => {
      const user = await createTestUser()
      const caller = createTestCaller(user.id)

      const result = await caller.organisations.create({
        name: 'Test Organisation',
        slug: 'test-organisation',
      })

      expect(result.slug).toBe('test-organisation')
      expect(result.name).toBe('Test Organisation')

      const membership = await prisma.organisationMember.findFirst({
        where: { organisationId: result.id, userId: user.id },
      })
      expect(membership?.role).toBe('OWNER')
    })

    it('rejects duplicate slugs with CONFLICT', async () => {
      const user = await createTestUser()
      const caller = createTestCaller(user.id)

      await caller.organisations.create({
        name: 'First Org',
        slug: 'my-org',
      })

      await expect(
        caller.organisations.create({
          name: 'Second Org',
          slug: 'my-org',
        })
      ).rejects.toThrow(expect.objectContaining({ code: 'CONFLICT' }))
    })

    it('rejects invalid slug formats', async () => {
      const user = await createTestUser()
      const caller = createTestCaller(user.id)

      await expect(
        caller.organisations.create({
          name: 'Bad Slug Org',
          slug: 'Invalid Slug With Spaces!',
        })
      ).rejects.toThrow()
    })

    it('accepts slugs with hyphens and lowercase letters', async () => {
      const user = await createTestUser()
      const caller = createTestCaller(user.id)

      const result = await caller.organisations.create({
        name: 'Valid Slug Org',
        slug: 'valid-slug-123',
      })

      expect(result.slug).toBe('valid-slug-123')
    })
  })

  describe('update', () => {
    it('allows an OWNER to update the organisation name', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      const result = await caller.organisations.update({
        organisationId: org.id,
        name: 'Updated Name',
      })

      expect(result.name).toBe('Updated Name')
    })

    it('allows an ADMIN to update the organisation name', async () => {
      const admin = await createTestUser()
      const { org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: admin.id, role: 'ADMIN' },
      })

      const caller = createTestCaller(admin.id)

      const result = await caller.organisations.update({
        organisationId: org.id,
        name: 'Admin Updated Name',
      })

      expect(result.name).toBe('Admin Updated Name')
    })

    it('throws FORBIDDEN when a regular member attempts to update', async () => {
      const member = await createTestUser()
      const { org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: member.id, role: 'MEMBER' },
      })

      const caller = createTestCaller(member.id)

      await expect(
        caller.organisations.update({ organisationId: org.id, name: 'Forbidden Update' })
      ).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
    })

    it('throws FORBIDDEN when a non-member attempts to update', async () => {
      const nonMember = await createTestUser()
      const { org } = await createTestOrgWithOwner()
      const caller = createTestCaller(nonMember.id)

      await expect(
        caller.organisations.update({ organisationId: org.id, name: 'Non-member Update' })
      ).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
    })

    it('allows updating the organisation image URL', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      const result = await caller.organisations.update({
        organisationId: org.id,
        image: 'https://example.com/new-image.png',
      })

      expect(result.image).toBe('https://example.com/new-image.png')
    })
  })

  describe('delete', () => {
    it('allows an OWNER to delete the organisation', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      await caller.organisations.delete({ organisationId: org.id })

      const deleted = await prisma.organisation.findUnique({ where: { id: org.id } })
      expect(deleted).toBeNull()
    })

    it('throws FORBIDDEN when an ADMIN attempts to delete', async () => {
      const admin = await createTestUser()
      const { org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: admin.id, role: 'ADMIN' },
      })

      const caller = createTestCaller(admin.id)

      await expect(caller.organisations.delete({ organisationId: org.id })).rejects.toThrow(
        expect.objectContaining({ code: 'FORBIDDEN' })
      )
    })

    it('throws FORBIDDEN when a regular member attempts to delete', async () => {
      const member = await createTestUser()
      const { org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: member.id, role: 'MEMBER' },
      })

      const caller = createTestCaller(member.id)

      await expect(caller.organisations.delete({ organisationId: org.id })).rejects.toThrow(
        expect.objectContaining({ code: 'FORBIDDEN' })
      )
    })

    it('throws FORBIDDEN when a non-member attempts to delete', async () => {
      const nonMember = await createTestUser()
      const { org } = await createTestOrgWithOwner()
      const caller = createTestCaller(nonMember.id)

      await expect(caller.organisations.delete({ organisationId: org.id })).rejects.toThrow(
        expect.objectContaining({ code: 'FORBIDDEN' })
      )
    })

    it('cascades deletion of members when organisation is deleted', async () => {
      const member = await createTestUser()
      const { user: owner, org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: member.id, role: 'MEMBER' },
      })

      const caller = createTestCaller(owner.id)
      await caller.organisations.delete({ organisationId: org.id })

      const memberships = await prisma.organisationMember.findMany({
        where: { organisationId: org.id },
      })
      expect(memberships).toHaveLength(0)
    })
  })

  describe('updateMemberRole', () => {
    it('allows an OWNER to change a member role', async () => {
      const member = await createTestUser()
      const { user: owner, org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: member.id, role: 'MEMBER' },
      })

      const caller = createTestCaller(owner.id)

      await caller.organisations.updateMemberRole({
        organisationId: org.id,
        userId: member.id,
        role: 'ADMIN',
      })

      const updated = await prisma.organisationMember.findFirst({
        where: { organisationId: org.id, userId: member.id },
      })
      expect(updated?.role).toBe('ADMIN')
    })

    it('allows an ADMIN to change a member role', async () => {
      const admin = await createTestUser()
      const member = await createTestUser()
      const { org } = await createTestOrgWithOwner()

      await prisma.organisationMember.createMany({
        data: [
          { organisationId: org.id, userId: admin.id, role: 'ADMIN' },
          { organisationId: org.id, userId: member.id, role: 'MEMBER' },
        ],
      })

      const caller = createTestCaller(admin.id)

      await caller.organisations.updateMemberRole({
        organisationId: org.id,
        userId: member.id,
        role: 'ADMIN',
      })

      const updated = await prisma.organisationMember.findFirst({
        where: { organisationId: org.id, userId: member.id },
      })
      expect(updated?.role).toBe('ADMIN')
    })

    it('throws FORBIDDEN when a regular member attempts to change roles', async () => {
      const member = await createTestUser()
      const target = await createTestUser()
      const { org } = await createTestOrgWithOwner()

      await prisma.organisationMember.createMany({
        data: [
          { organisationId: org.id, userId: member.id, role: 'MEMBER' },
          { organisationId: org.id, userId: target.id, role: 'MEMBER' },
        ],
      })

      const caller = createTestCaller(member.id)

      await expect(
        caller.organisations.updateMemberRole({
          organisationId: org.id,
          userId: target.id,
          role: 'ADMIN',
        })
      ).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
    })

    it('prevents demoting the last OWNER', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      await expect(
        caller.organisations.updateMemberRole({
          organisationId: org.id,
          userId: owner.id,
          role: 'ADMIN',
        })
      ).rejects.toThrow()
    })

    it('allows demoting an OWNER when another OWNER exists', async () => {
      const owner2 = await createTestUser()
      const { user: owner1, org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: owner2.id, role: 'OWNER' },
      })

      const caller = createTestCaller(owner1.id)

      await caller.organisations.updateMemberRole({
        organisationId: org.id,
        userId: owner2.id,
        role: 'ADMIN',
      })

      const updated = await prisma.organisationMember.findFirst({
        where: { organisationId: org.id, userId: owner2.id },
      })
      expect(updated?.role).toBe('ADMIN')
    })
  })

  describe('removeMember', () => {
    it('allows an OWNER to remove a member', async () => {
      const member = await createTestUser()
      const { user: owner, org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: member.id, role: 'MEMBER' },
      })

      const caller = createTestCaller(owner.id)

      await caller.organisations.removeMember({
        organisationId: org.id,
        userId: member.id,
      })

      const removed = await prisma.organisationMember.findFirst({
        where: { organisationId: org.id, userId: member.id },
      })
      expect(removed).toBeNull()
    })

    it('allows an ADMIN to remove a member', async () => {
      const admin = await createTestUser()
      const member = await createTestUser()
      const { org } = await createTestOrgWithOwner()

      await prisma.organisationMember.createMany({
        data: [
          { organisationId: org.id, userId: admin.id, role: 'ADMIN' },
          { organisationId: org.id, userId: member.id, role: 'MEMBER' },
        ],
      })

      const caller = createTestCaller(admin.id)

      await caller.organisations.removeMember({
        organisationId: org.id,
        userId: member.id,
      })

      const removed = await prisma.organisationMember.findFirst({
        where: { organisationId: org.id, userId: member.id },
      })
      expect(removed).toBeNull()
    })

    it('throws FORBIDDEN when a regular member attempts to remove another member', async () => {
      const member = await createTestUser()
      const target = await createTestUser()
      const { org } = await createTestOrgWithOwner()

      await prisma.organisationMember.createMany({
        data: [
          { organisationId: org.id, userId: member.id, role: 'MEMBER' },
          { organisationId: org.id, userId: target.id, role: 'MEMBER' },
        ],
      })

      const caller = createTestCaller(member.id)

      await expect(
        caller.organisations.removeMember({
          organisationId: org.id,
          userId: target.id,
        })
      ).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
    })

    it('prevents removing the last OWNER', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      await expect(
        caller.organisations.removeMember({
          organisationId: org.id,
          userId: owner.id,
        })
      ).rejects.toThrow()
    })

    it('allows removing an OWNER when another OWNER exists', async () => {
      const owner2 = await createTestUser()
      const { user: owner1, org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: owner2.id, role: 'OWNER' },
      })

      const caller = createTestCaller(owner1.id)

      await caller.organisations.removeMember({
        organisationId: org.id,
        userId: owner2.id,
      })

      const removed = await prisma.organisationMember.findFirst({
        where: { organisationId: org.id, userId: owner2.id },
      })
      expect(removed).toBeNull()
    })
  })

  describe('invite', () => {
    it('allows an OWNER to invite an existing user', async () => {
      const invitee = await createTestUser()
      const { user: owner, org } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      await caller.organisations.invite({
        organisationId: org.id,
        email: invitee.email,
        role: 'MEMBER',
      })

      const membership = await prisma.organisationMember.findFirst({
        where: { organisationId: org.id, userId: invitee.id },
      })
      expect(membership).not.toBeNull()
      expect(membership?.role).toBe('MEMBER')
    })

    it('allows an ADMIN to invite an existing user', async () => {
      const admin = await createTestUser()
      const invitee = await createTestUser()
      const { org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: admin.id, role: 'ADMIN' },
      })

      const caller = createTestCaller(admin.id)

      await caller.organisations.invite({
        organisationId: org.id,
        email: invitee.email,
        role: 'MEMBER',
      })

      const membership = await prisma.organisationMember.findFirst({
        where: { organisationId: org.id, userId: invitee.id },
      })
      expect(membership).not.toBeNull()
    })

    it('throws FORBIDDEN when a regular member attempts to invite', async () => {
      const member = await createTestUser()
      const invitee = await createTestUser()
      const { org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: member.id, role: 'MEMBER' },
      })

      const caller = createTestCaller(member.id)

      await expect(
        caller.organisations.invite({
          organisationId: org.id,
          email: invitee.email,
          role: 'MEMBER',
        })
      ).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
    })

    it('throws CONFLICT when inviting a user who is already a member', async () => {
      const existingMember = await createTestUser()
      const { user: owner, org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: existingMember.id, role: 'MEMBER' },
      })

      const caller = createTestCaller(owner.id)

      await expect(
        caller.organisations.invite({
          organisationId: org.id,
          email: existingMember.email,
          role: 'MEMBER',
        })
      ).rejects.toThrow(expect.objectContaining({ code: 'CONFLICT' }))
    })

    it('throws NOT_FOUND when inviting a user who does not exist', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      await expect(
        caller.organisations.invite({
          organisationId: org.id,
          email: 'nonexistent@example.com',
          role: 'MEMBER',
        })
      ).rejects.toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
    })
  })

  describe('create rate limits', () => {
    it('rejects creation when user already owns 5 organisations', async () => {
      const user = await createTestUser()
      const caller = createTestCaller(user.id)
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)

      for (let i = 0; i < 5; i++) {
        const org = await createTestOrg()
        await prisma.organisation.update({
          where: { id: org.id },
          data: { createdAt: twoHoursAgo },
        })
        await prisma.organisationMember.create({
          data: { userId: user.id, organisationId: org.id, role: 'OWNER' },
        })
      }

      await expect(
        caller.organisations.create({ name: 'Sixth Org', slug: 'sixth-org' })
      ).rejects.toThrow(expect.objectContaining({ code: 'TOO_MANY_REQUESTS' }))
    })

    it('allows creation when user owns fewer than 5 organisations', async () => {
      const user = await createTestUser()
      const caller = createTestCaller(user.id)
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)

      for (let i = 0; i < 4; i++) {
        const org = await createTestOrg()
        await prisma.organisation.update({
          where: { id: org.id },
          data: { createdAt: twoHoursAgo },
        })
        await prisma.organisationMember.create({
          data: { userId: user.id, organisationId: org.id, role: 'OWNER' },
        })
      }

      const result = await caller.organisations.create({ name: 'Fifth Org', slug: 'fifth-org' })
      expect(result.slug).toBe('fifth-org')
    })

    it('does not count non-OWNER memberships towards the limit', async () => {
      const user = await createTestUser()
      const caller = createTestCaller(user.id)
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)

      for (let i = 0; i < 5; i++) {
        const org = await createTestOrg()
        await prisma.organisation.update({
          where: { id: org.id },
          data: { createdAt: twoHoursAgo },
        })
        await prisma.organisationMember.create({
          data: { userId: user.id, organisationId: org.id, role: 'MEMBER' },
        })
      }

      const result = await caller.organisations.create({ name: 'New Org', slug: 'new-org' })
      expect(result.slug).toBe('new-org')
    })

    it('rejects creation when 3 orgs were created in the last hour', async () => {
      const user = await createTestUser()
      const caller = createTestCaller(user.id)

      for (let i = 0; i < 3; i++) {
        await caller.organisations.create({ name: `Org ${i}`, slug: `org-${i}` })
      }

      await expect(
        caller.organisations.create({ name: 'Fourth Org', slug: 'fourth-org' })
      ).rejects.toThrow(expect.objectContaining({ code: 'TOO_MANY_REQUESTS' }))
    })
  })

  describe('leave', () => {
    it('allows a member to leave an organisation', async () => {
      const member = await createTestUser()
      const { org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: member.id, role: 'MEMBER' },
      })

      const caller = createTestCaller(member.id)
      await caller.organisations.leave({ organisationId: org.id })

      const membership = await prisma.organisationMember.findUnique({
        where: { userId_organisationId: { userId: member.id, organisationId: org.id } },
      })
      expect(membership).toBeNull()
    })

    it('allows an admin to leave an organisation', async () => {
      const admin = await createTestUser()
      const { org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: admin.id, role: 'ADMIN' },
      })

      const caller = createTestCaller(admin.id)
      await caller.organisations.leave({ organisationId: org.id })

      const membership = await prisma.organisationMember.findUnique({
        where: { userId_organisationId: { userId: admin.id, organisationId: org.id } },
      })
      expect(membership).toBeNull()
    })

    it('allows an owner to leave when another owner exists', async () => {
      const owner2 = await createTestUser()
      const { user: owner1, org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: owner2.id, role: 'OWNER' },
      })

      const caller = createTestCaller(owner1.id)
      await caller.organisations.leave({ organisationId: org.id })

      const membership = await prisma.organisationMember.findUnique({
        where: { userId_organisationId: { userId: owner1.id, organisationId: org.id } },
      })
      expect(membership).toBeNull()
    })

    it('prevents the last owner from leaving', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      await expect(caller.organisations.leave({ organisationId: org.id })).rejects.toThrow(
        expect.objectContaining({ code: 'BAD_REQUEST' })
      )
    })

    it('throws NOT_FOUND when user is not a member', async () => {
      const nonMember = await createTestUser()
      const { org } = await createTestOrgWithOwner()
      const caller = createTestCaller(nonMember.id)

      await expect(caller.organisations.leave({ organisationId: org.id })).rejects.toThrow(
        expect.objectContaining({ code: 'NOT_FOUND' })
      )
    })
  })

  describe('connectSkillsRepo', () => {
    it('allows an OWNER to connect a skills repository', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      await prisma.connectedAccount.create({
        data: {
          userId: owner.id,
          provider: 'GITHUB',
          providerAccountId: 'gh-owner',
          accessToken: 'token',
          scopes: ['repo'],
        },
      })
      const caller = createTestCaller(owner.id)

      const result = await caller.organisations.connectSkillsRepo({
        organisationId: org.id,
        url: 'https://github.com/acme/skills',
        owner: 'acme',
        name: 'skills',
      })

      expect(result.skillsRepoOwner).toBe('acme')
      expect(result.skillsRepoName).toBe('skills')
    })

    it('allows an ADMIN to connect a skills repository', async () => {
      const admin = await createTestUser()
      const { org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: admin.id, role: 'ADMIN' },
      })
      await prisma.connectedAccount.create({
        data: {
          userId: admin.id,
          provider: 'GITHUB',
          providerAccountId: 'gh-admin',
          accessToken: 'token',
          scopes: ['repo'],
        },
      })

      const caller = createTestCaller(admin.id)

      const result = await caller.organisations.connectSkillsRepo({
        organisationId: org.id,
        url: 'https://github.com/acme/skills',
        owner: 'acme',
        name: 'skills',
      })

      expect(result.skillsRepoOwner).toBe('acme')
    })

    it('throws FORBIDDEN when a regular member attempts to connect a repo', async () => {
      const member = await createTestUser()
      const { org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: member.id, role: 'MEMBER' },
      })

      const caller = createTestCaller(member.id)

      await expect(
        caller.organisations.connectSkillsRepo({
          organisationId: org.id,
          url: 'https://github.com/acme/skills',
          owner: 'acme',
          name: 'skills',
        })
      ).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
    })

    it('throws an error when GitHub repo access validation fails', async () => {
      const { validateRepoAccess } = await import('@/lib/github/skills-repo')
      vi.mocked(validateRepoAccess).mockResolvedValueOnce(false)

      const { user: owner, org } = await createTestOrgWithOwner()
      await prisma.connectedAccount.create({
        data: {
          userId: owner.id,
          provider: 'GITHUB',
          providerAccountId: 'gh-owner2',
          accessToken: 'token',
          scopes: ['repo'],
        },
      })
      const caller = createTestCaller(owner.id)

      await expect(
        caller.organisations.connectSkillsRepo({
          organisationId: org.id,
          url: 'https://github.com/acme/private-repo',
          owner: 'acme',
          name: 'private-repo',
        })
      ).rejects.toThrow()
    })
  })

  describe('disconnectSkillsRepo', () => {
    it('allows an OWNER to disconnect the skills repository', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()

      await prisma.organisation.update({
        where: { id: org.id },
        data: {
          skillsRepoOwner: 'acme',
          skillsRepoName: 'skills',
          skillsRepoUrl: 'https://github.com/acme/skills',
        },
      })

      const caller = createTestCaller(owner.id)

      const result = await caller.organisations.disconnectSkillsRepo({
        organisationId: org.id,
      })

      expect(result.skillsRepoOwner).toBeNull()
      expect(result.skillsRepoName).toBeNull()
    })

    it('allows an ADMIN to disconnect the skills repository', async () => {
      const admin = await createTestUser()
      const { org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: admin.id, role: 'ADMIN' },
      })

      await prisma.organisation.update({
        where: { id: org.id },
        data: {
          skillsRepoOwner: 'acme',
          skillsRepoName: 'skills',
          skillsRepoUrl: 'https://github.com/acme/skills',
        },
      })

      const caller = createTestCaller(admin.id)

      const result = await caller.organisations.disconnectSkillsRepo({
        organisationId: org.id,
      })

      expect(result.skillsRepoOwner).toBeNull()
    })

    it('throws FORBIDDEN when a regular member attempts to disconnect', async () => {
      const member = await createTestUser()
      const { org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: member.id, role: 'MEMBER' },
      })

      const caller = createTestCaller(member.id)

      await expect(
        caller.organisations.disconnectSkillsRepo({ organisationId: org.id })
      ).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
    })
  })

  describe('getSkillsRepoStatus', () => {
    it('returns connected status true when a repo is connected', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()

      await prisma.organisation.update({
        where: { id: org.id },
        data: {
          skillsRepoOwner: 'acme',
          skillsRepoName: 'skills',
          skillsRepoUrl: 'https://github.com/acme/skills',
        },
      })

      const caller = createTestCaller(owner.id)

      const result = await caller.organisations.getSkillsRepoStatus({
        organisationId: org.id,
      })

      expect(result.connected).toBe(true)
    })

    it('returns connected status false when no repo is connected', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      const result = await caller.organisations.getSkillsRepoStatus({
        organisationId: org.id,
      })

      expect(result.connected).toBe(false)
    })

    it('allows a regular member to view the skills repo status', async () => {
      const member = await createTestUser()
      const { org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: member.id, role: 'MEMBER' },
      })

      const caller = createTestCaller(member.id)

      const result = await caller.organisations.getSkillsRepoStatus({
        organisationId: org.id,
      })

      expect(result).toHaveProperty('connected')
    })

    it('throws FORBIDDEN when a non-member attempts to view repo status', async () => {
      const nonMember = await createTestUser()
      const { org } = await createTestOrgWithOwner()
      const caller = createTestCaller(nonMember.id)

      await expect(
        caller.organisations.getSkillsRepoStatus({ organisationId: org.id })
      ).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
    })

    it('includes repo details when connected', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()

      await prisma.organisation.update({
        where: { id: org.id },
        data: {
          skillsRepoOwner: 'acme',
          skillsRepoName: 'skills',
          skillsRepoUrl: 'https://github.com/acme/skills',
        },
      })

      const caller = createTestCaller(owner.id)

      const result = await caller.organisations.getSkillsRepoStatus({
        organisationId: org.id,
      })

      expect(result.connected).toBe(true)
      expect(result).toHaveProperty('owner')
      expect(result).toHaveProperty('name')
    })
  })
})
