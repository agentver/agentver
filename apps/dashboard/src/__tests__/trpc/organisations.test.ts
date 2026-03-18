import { prisma } from '@agentver/database/client'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestOrg, createTestOrgWithOwner, createTestUser } from '~/test/factories'
import { cleanDatabase, disconnectDatabase } from '~/test/helpers/db'
import { createTestCaller, createUnauthenticatedCaller } from '~/test/helpers/trpc'

vi.mock('@/lib/github/skills-repo', () => ({
  validateRepoAccess: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/email', () => ({
  getEmailProvider: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue(undefined),
  }),
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

  describe('sendInvitation', () => {
    it('creates a pending invitation for an existing user', async () => {
      const invitee = await createTestUser()
      const { user: owner, org } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      const result = await caller.organisations.sendInvitation({
        organisationId: org.id,
        email: invitee.email,
        role: 'MEMBER',
      })

      expect(result.email).toBe(invitee.email)
      expect(result.role).toBe('MEMBER')
      expect(result.organisationId).toBe(org.id)
      expect(result.token).toBeDefined()
      expect(result.acceptedAt).toBeNull()

      // Should NOT create a membership yet
      const membership = await prisma.organisationMember.findFirst({
        where: { organisationId: org.id, userId: invitee.id },
      })
      expect(membership).toBeNull()
    })

    it('creates a pending invitation for a non-existing user', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      const result = await caller.organisations.sendInvitation({
        organisationId: org.id,
        email: 'newuser@example.com',
        role: 'ADMIN',
      })

      expect(result.email).toBe('newuser@example.com')
      expect(result.role).toBe('ADMIN')
    })

    it('allows an ADMIN to send an invitation', async () => {
      const admin = await createTestUser()
      const { org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: admin.id, role: 'ADMIN' },
      })

      const caller = createTestCaller(admin.id)

      const result = await caller.organisations.sendInvitation({
        organisationId: org.id,
        email: 'someone@example.com',
        role: 'MEMBER',
      })

      expect(result.email).toBe('someone@example.com')
    })

    it('throws FORBIDDEN when a regular member attempts to invite', async () => {
      const member = await createTestUser()
      const { org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: member.id, role: 'MEMBER' },
      })

      const caller = createTestCaller(member.id)

      await expect(
        caller.organisations.sendInvitation({
          organisationId: org.id,
          email: 'someone@example.com',
          role: 'MEMBER',
        })
      ).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
    })

    it('throws CONFLICT when the user is already a member', async () => {
      const existingMember = await createTestUser()
      const { user: owner, org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: existingMember.id, role: 'MEMBER' },
      })

      const caller = createTestCaller(owner.id)

      await expect(
        caller.organisations.sendInvitation({
          organisationId: org.id,
          email: existingMember.email,
          role: 'MEMBER',
        })
      ).rejects.toThrow(expect.objectContaining({ code: 'CONFLICT' }))
    })

    it('throws CONFLICT when a pending invitation already exists', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      await caller.organisations.sendInvitation({
        organisationId: org.id,
        email: 'duplicate@example.com',
        role: 'MEMBER',
      })

      await expect(
        caller.organisations.sendInvitation({
          organisationId: org.id,
          email: 'duplicate@example.com',
          role: 'ADMIN',
        })
      ).rejects.toThrow(expect.objectContaining({ code: 'CONFLICT' }))
    })

    it('replaces an expired invitation with a new one', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()

      // Create an expired invitation directly
      await prisma.organisationInvitation.create({
        data: {
          organisationId: org.id,
          email: 'expired@example.com',
          role: 'VIEWER',
          invitedById: owner.id,
          expiresAt: new Date(Date.now() - 1000), // Already expired
        },
      })

      const caller = createTestCaller(owner.id)

      const result = await caller.organisations.sendInvitation({
        organisationId: org.id,
        email: 'expired@example.com',
        role: 'ADMIN',
      })

      expect(result.role).toBe('ADMIN')
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now())
    })

    it('replaces a declined invitation with a new one', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()

      await prisma.organisationInvitation.create({
        data: {
          organisationId: org.id,
          email: 'declined@example.com',
          role: 'MEMBER',
          invitedById: owner.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          declinedAt: new Date(),
        },
      })

      const caller = createTestCaller(owner.id)

      const result = await caller.organisations.sendInvitation({
        organisationId: org.id,
        email: 'declined@example.com',
        role: 'ADMIN',
      })

      expect(result.role).toBe('ADMIN')
      expect(result.declinedAt).toBeNull()
    })

    it('defaults role to MEMBER when not specified', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      const result = await caller.organisations.sendInvitation({
        organisationId: org.id,
        email: 'default-role@example.com',
      })

      expect(result.role).toBe('MEMBER')
    })
  })

  describe('listInvitations', () => {
    it('returns pending invitations for the organisation', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      await caller.organisations.sendInvitation({
        organisationId: org.id,
        email: 'invite1@example.com',
        role: 'MEMBER',
      })

      await caller.organisations.sendInvitation({
        organisationId: org.id,
        email: 'invite2@example.com',
        role: 'ADMIN',
      })

      const result = await caller.organisations.listInvitations({
        organisationId: org.id,
      })

      expect(result).toHaveLength(2)
      expect(result[0]!.invitedBy).toHaveProperty('name')
      expect(result[0]!.invitedBy).toHaveProperty('email')
    })

    it('excludes accepted invitations', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()

      await prisma.organisationInvitation.create({
        data: {
          organisationId: org.id,
          email: 'accepted@example.com',
          role: 'MEMBER',
          invitedById: owner.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          acceptedAt: new Date(),
        },
      })

      const caller = createTestCaller(owner.id)

      const result = await caller.organisations.listInvitations({
        organisationId: org.id,
      })

      expect(result).toHaveLength(0)
    })

    it('throws FORBIDDEN for regular members', async () => {
      const member = await createTestUser()
      const { org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: member.id, role: 'MEMBER' },
      })

      const caller = createTestCaller(member.id)

      await expect(
        caller.organisations.listInvitations({ organisationId: org.id })
      ).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
    })

    it('excludes expired invitations', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()

      await prisma.organisationInvitation.create({
        data: {
          organisationId: org.id,
          email: 'expired@example.com',
          role: 'MEMBER',
          invitedById: owner.id,
          expiresAt: new Date(Date.now() - 1000), // Already expired
        },
      })

      const caller = createTestCaller(owner.id)

      const result = await caller.organisations.listInvitations({
        organisationId: org.id,
      })

      expect(result).toHaveLength(0)
    })
  })

  describe('cancelInvitation', () => {
    it('deletes a pending invitation', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      const invitation = await caller.organisations.sendInvitation({
        organisationId: org.id,
        email: 'cancel-me@example.com',
        role: 'MEMBER',
      })

      await caller.organisations.cancelInvitation({ invitationId: invitation.id })

      const deleted = await prisma.organisationInvitation.findUnique({
        where: { id: invitation.id },
      })
      expect(deleted).toBeNull()
    })

    it('throws NOT_FOUND for non-existent invitation', async () => {
      const { user: owner } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      await expect(
        caller.organisations.cancelInvitation({ invitationId: 'non-existent-id' })
      ).rejects.toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
    })

    it('throws BAD_REQUEST when cancelling an accepted invitation', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()

      const invitation = await prisma.organisationInvitation.create({
        data: {
          organisationId: org.id,
          email: 'accepted@example.com',
          role: 'MEMBER',
          invitedById: owner.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          acceptedAt: new Date(),
        },
      })

      const caller = createTestCaller(owner.id)

      await expect(
        caller.organisations.cancelInvitation({ invitationId: invitation.id })
      ).rejects.toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }))
    })

    it('throws FORBIDDEN when a regular member attempts to cancel', async () => {
      const member = await createTestUser()
      const { user: owner, org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: member.id, role: 'MEMBER' },
      })

      const invitation = await prisma.organisationInvitation.create({
        data: {
          organisationId: org.id,
          email: 'someone@example.com',
          role: 'MEMBER',
          invitedById: owner.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })

      const caller = createTestCaller(member.id)

      await expect(
        caller.organisations.cancelInvitation({ invitationId: invitation.id })
      ).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
    })

    it('throws FORBIDDEN when an OWNER of another org attempts to cancel', async () => {
      const { user: ownerA } = await createTestOrgWithOwner()
      const { user: ownerB, org: orgB } = await createTestOrgWithOwner()

      const invitation = await prisma.organisationInvitation.create({
        data: {
          organisationId: orgB.id,
          email: 'someone@example.com',
          role: 'MEMBER',
          invitedById: ownerB.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })

      const caller = createTestCaller(ownerA.id)

      await expect(
        caller.organisations.cancelInvitation({ invitationId: invitation.id })
      ).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
    })
  })

  describe('resendInvitation', () => {
    it('refreshes token and expiry', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()

      // Create invitation with old createdAt to bypass cooldown
      const invitation = await prisma.organisationInvitation.create({
        data: {
          organisationId: org.id,
          email: 'resend@example.com',
          role: 'MEMBER',
          invitedById: owner.id,
          expiresAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000), // 1 day left
          createdAt: new Date(Date.now() - 15 * 60 * 1000), // 15 minutes ago
        },
      })

      const originalToken = invitation.token

      const caller = createTestCaller(owner.id)
      const result = await caller.organisations.resendInvitation({
        invitationId: invitation.id,
      })

      expect(result.token).not.toBe(originalToken)
      expect(result.expiresAt.getTime()).toBeGreaterThan(invitation.expiresAt.getTime())
    })

    it('throws TOO_MANY_REQUESTS when resending too soon', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      const invitation = await caller.organisations.sendInvitation({
        organisationId: org.id,
        email: 'cooldown@example.com',
        role: 'MEMBER',
      })

      await expect(
        caller.organisations.resendInvitation({ invitationId: invitation.id })
      ).rejects.toThrow(expect.objectContaining({ code: 'TOO_MANY_REQUESTS' }))
    })

    it('throws NOT_FOUND for non-existent invitation', async () => {
      const { user: owner } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      await expect(
        caller.organisations.resendInvitation({ invitationId: 'non-existent-id' })
      ).rejects.toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
    })

    it('throws BAD_REQUEST when resending an accepted invitation', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()

      const invitation = await prisma.organisationInvitation.create({
        data: {
          organisationId: org.id,
          email: 'accepted@example.com',
          role: 'MEMBER',
          invitedById: owner.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          acceptedAt: new Date(),
          createdAt: new Date(Date.now() - 15 * 60 * 1000),
          lastSentAt: new Date(Date.now() - 15 * 60 * 1000),
        },
      })

      const caller = createTestCaller(owner.id)

      await expect(
        caller.organisations.resendInvitation({ invitationId: invitation.id })
      ).rejects.toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }))
    })

    it('throws FORBIDDEN when a regular member attempts to resend', async () => {
      const member = await createTestUser()
      const { user: owner, org } = await createTestOrgWithOwner()

      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: member.id, role: 'MEMBER' },
      })

      const invitation = await prisma.organisationInvitation.create({
        data: {
          organisationId: org.id,
          email: 'someone@example.com',
          role: 'MEMBER',
          invitedById: owner.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          lastSentAt: new Date(Date.now() - 15 * 60 * 1000),
        },
      })

      const caller = createTestCaller(member.id)

      await expect(
        caller.organisations.resendInvitation({ invitationId: invitation.id })
      ).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
    })

    it('throws FORBIDDEN when an OWNER of another org attempts to resend', async () => {
      const { user: ownerA } = await createTestOrgWithOwner()
      const { user: ownerB, org: orgB } = await createTestOrgWithOwner()

      const invitation = await prisma.organisationInvitation.create({
        data: {
          organisationId: orgB.id,
          email: 'someone@example.com',
          role: 'MEMBER',
          invitedById: ownerB.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          lastSentAt: new Date(Date.now() - 15 * 60 * 1000),
        },
      })

      const caller = createTestCaller(ownerA.id)

      await expect(
        caller.organisations.resendInvitation({ invitationId: invitation.id })
      ).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
    })
  })

  describe('acceptInvitation', () => {
    it('creates membership when authenticated user accepts a valid invitation', async () => {
      const invitee = await createTestUser()
      const { user: owner, org } = await createTestOrgWithOwner()

      const invitation = await prisma.organisationInvitation.create({
        data: {
          organisationId: org.id,
          email: invitee.email,
          role: 'MEMBER',
          invitedById: owner.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })

      const caller = createTestCaller(invitee.id, { email: invitee.email })

      const result = await caller.organisations.acceptInvitation({
        token: invitation.token,
      })

      expect(result.requiresAuth).toBe(false)
      expect(result.alreadyMember).toBe(false)
      expect(result.organisation.id).toBe(org.id)

      // Verify membership was created
      const membership = await prisma.organisationMember.findUnique({
        where: {
          userId_organisationId: {
            userId: invitee.id,
            organisationId: org.id,
          },
        },
      })
      expect(membership).not.toBeNull()
      expect(membership?.role).toBe('MEMBER')

      // Verify invitation was marked as accepted
      const updated = await prisma.organisationInvitation.findUnique({
        where: { id: invitation.id },
      })
      expect(updated?.acceptedAt).not.toBeNull()
    })

    it('returns requiresAuth when user is not authenticated', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()

      const invitation = await prisma.organisationInvitation.create({
        data: {
          organisationId: org.id,
          email: 'new@example.com',
          role: 'ADMIN',
          invitedById: owner.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })

      const caller = createUnauthenticatedCaller()

      const result = await caller.organisations.acceptInvitation({
        token: invitation.token,
      })

      expect(result.requiresAuth).toBe(true)
      expect(result.email).toBe('new@example.com')
      expect(result.role).toBe('ADMIN')
    })

    it('throws NOT_FOUND for invalid token', async () => {
      const invitee = await createTestUser()
      const caller = createTestCaller(invitee.id, { email: invitee.email })

      await expect(
        caller.organisations.acceptInvitation({ token: 'invalid-token' })
      ).rejects.toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
    })

    it('throws BAD_REQUEST for expired invitation', async () => {
      const invitee = await createTestUser()
      const { user: owner, org } = await createTestOrgWithOwner()

      const invitation = await prisma.organisationInvitation.create({
        data: {
          organisationId: org.id,
          email: invitee.email,
          role: 'MEMBER',
          invitedById: owner.id,
          expiresAt: new Date(Date.now() - 1000), // Already expired
        },
      })

      const caller = createTestCaller(invitee.id, { email: invitee.email })

      await expect(
        caller.organisations.acceptInvitation({ token: invitation.token })
      ).rejects.toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }))
    })

    it('throws BAD_REQUEST for already accepted invitation', async () => {
      const invitee = await createTestUser()
      const { user: owner, org } = await createTestOrgWithOwner()

      const invitation = await prisma.organisationInvitation.create({
        data: {
          organisationId: org.id,
          email: invitee.email,
          role: 'MEMBER',
          invitedById: owner.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          acceptedAt: new Date(),
        },
      })

      const caller = createTestCaller(invitee.id, { email: invitee.email })

      await expect(
        caller.organisations.acceptInvitation({ token: invitation.token })
      ).rejects.toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }))
    })

    it('throws BAD_REQUEST for declined invitation', async () => {
      const invitee = await createTestUser()
      const { user: owner, org } = await createTestOrgWithOwner()

      const invitation = await prisma.organisationInvitation.create({
        data: {
          organisationId: org.id,
          email: invitee.email,
          role: 'MEMBER',
          invitedById: owner.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          declinedAt: new Date(),
        },
      })

      const caller = createTestCaller(invitee.id, { email: invitee.email })

      await expect(
        caller.organisations.acceptInvitation({ token: invitation.token })
      ).rejects.toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }))
    })

    it('throws FORBIDDEN when email does not match', async () => {
      const wrongUser = await createTestUser({ email: 'wrong@example.com' })
      const { user: owner, org } = await createTestOrgWithOwner()

      const invitation = await prisma.organisationInvitation.create({
        data: {
          organisationId: org.id,
          email: 'correct@example.com',
          role: 'MEMBER',
          invitedById: owner.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })

      const caller = createTestCaller(wrongUser.id, { email: wrongUser.email })

      await expect(
        caller.organisations.acceptInvitation({ token: invitation.token })
      ).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
    })

    it('handles accepting when already a member gracefully', async () => {
      const invitee = await createTestUser()
      const { user: owner, org } = await createTestOrgWithOwner()

      // Add as member first
      await prisma.organisationMember.create({
        data: { userId: invitee.id, organisationId: org.id, role: 'MEMBER' },
      })

      const invitation = await prisma.organisationInvitation.create({
        data: {
          organisationId: org.id,
          email: invitee.email,
          role: 'ADMIN',
          invitedById: owner.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })

      const caller = createTestCaller(invitee.id, { email: invitee.email })

      const result = await caller.organisations.acceptInvitation({
        token: invitation.token,
      })

      expect(result.requiresAuth).toBe(false)
      expect(result.alreadyMember).toBe(true)

      // Verify invitation was still marked as accepted
      const updated = await prisma.organisationInvitation.findUnique({
        where: { id: invitation.id },
      })
      expect(updated?.acceptedAt).not.toBeNull()
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
