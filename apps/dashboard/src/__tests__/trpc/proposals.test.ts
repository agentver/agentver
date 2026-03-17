import { prisma } from '@agentver/database/client'
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

describe('proposals router', () => {
  beforeEach(async () => {
    await cleanDatabase()
    vi.clearAllMocks()
  })

  // ---------------------------------------------------------------------------
  // list
  // ---------------------------------------------------------------------------

  describe('list', () => {
    it('returns paginated proposals for a package', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'list-proposals-skill' })

      await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Proposal A',
          content: { body: 'Content A' },
          status: 'OPEN',
        },
      })
      await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Proposal B',
          content: { body: 'Content B' },
          status: 'OPEN',
        },
      })

      const caller = createTestCaller(owner.id)
      const result = await caller.proposals.list({ packageId: pkg.id, limit: 10 })

      expect(Array.isArray(result.proposals)).toBe(true)
      expect(result.proposals.length).toBe(2)
    })

    it('filters proposals by status', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'filter-proposals-skill' })

      await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Open Proposal',
          content: { body: 'Open' },
          status: 'OPEN',
        },
      })
      await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Merged Proposal',
          content: { body: 'Merged' },
          status: 'MERGED',
        },
      })

      const caller = createTestCaller(owner.id)
      const result = await caller.proposals.list({ packageId: pkg.id, status: 'OPEN', limit: 10 })

      expect(result.proposals.every((p) => p.status === 'OPEN')).toBe(true)
      expect(result.proposals.length).toBe(1)
    })

    it('paginates correctly using cursor', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'cursor-proposals-skill' })

      await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          prisma.changeProposal.create({
            data: {
              packageId: pkg.id,
              authorId: owner.id,
              title: `Proposal ${i}`,
              content: { body: `Content ${i}` },
              status: 'OPEN',
            },
          })
        )
      )

      const caller = createTestCaller(owner.id)
      const firstPage = await caller.proposals.list({ packageId: pkg.id, limit: 3 })
      expect(firstPage.proposals.length).toBe(3)
      expect(firstPage.nextCursor).toBeDefined()

      const secondPage = await caller.proposals.list({
        packageId: pkg.id,
        limit: 3,
        cursor: firstPage.nextCursor,
      })
      expect(secondPage.proposals.length).toBe(2)
    })

    it('throws FORBIDDEN when caller lacks package access', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const outsider = await createTestUser({ email: 'outsider-list@example.com' })
      const pkg = await createTestPackage(org.id, owner.id, {
        name: 'private-proposals-skill',
        visibility: 'PRIVATE',
      })

      const caller = createTestCaller(outsider.id)

      await expect(caller.proposals.list({ packageId: pkg.id })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
    })

    it('throws UNAUTHORIZED for unauthenticated caller', async () => {
      const caller = createUnauthenticatedCaller()

      await expect(caller.proposals.list({ packageId: 'any-id' })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      })
    })
  })

  // ---------------------------------------------------------------------------
  // getById
  // ---------------------------------------------------------------------------

  describe('getById', () => {
    it('returns proposal with comments, reviews and permissions', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'getbyid-skill' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Detailed Proposal',
          content: { body: 'Detailed content' },
          status: 'OPEN',
        },
      })

      const caller = createTestCaller(owner.id)
      const result = await caller.proposals.getById({ id: proposal.id })

      expect(result.id).toBe(proposal.id)
      expect(result.title).toBe('Detailed Proposal')
      expect(result.comments).toBeDefined()
      expect(result.reviews).toBeDefined()
      expect(result.permissions).toBeDefined()
    })

    it('throws NOT_FOUND for unknown proposal id', async () => {
      const { user: owner } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      await expect(caller.proposals.getById({ id: 'non-existent-proposal' })).rejects.toMatchObject(
        { code: 'NOT_FOUND' }
      )
    })

    it('throws UNAUTHORIZED for unauthenticated caller', async () => {
      const caller = createUnauthenticatedCaller()

      await expect(caller.proposals.getById({ id: 'any-id' })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      })
    })
  })

  // ---------------------------------------------------------------------------
  // listForUser
  // ---------------------------------------------------------------------------

  describe('listForUser', () => {
    it('returns proposals where user is author', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'user-proposals-skill' })

      await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'My Proposal',
          content: { body: 'Content' },
          status: 'OPEN',
        },
      })

      const caller = createTestCaller(owner.id)
      const result = await caller.proposals.listForUser({})

      expect(result.proposals.some((p) => p.authorId === owner.id)).toBe(true)
    })

    it('returns an empty list when user has no proposals or reviews', async () => {
      const user = await createTestUser({ email: 'no-proposals@example.com' })
      const caller = createTestCaller(user.id)
      const result = await caller.proposals.listForUser({})

      expect(result.proposals).toEqual([])
    })

    it('throws UNAUTHORIZED for unauthenticated caller', async () => {
      const caller = createUnauthenticatedCaller()

      await expect(caller.proposals.listForUser({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })
  })

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------

  describe('create', () => {
    it('creates a proposal with OPEN status for a package member', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'create-proposal-skill' })

      const caller = createTestCaller(owner.id)
      const result = await caller.proposals.create({
        packageId: pkg.id,
        title: 'New Feature Proposal',
        description: 'Add new feature',
        content: 'Feature content',
      })

      expect(result.status).toBe('OPEN')
      expect(result.title).toBe('New Feature Proposal')
      expect(result.authorId).toBe(owner.id)
    })

    it('throws FORBIDDEN when caller lacks package access', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const outsider = await createTestUser({ email: 'outsider-create@example.com' })
      const pkg = await createTestPackage(org.id, owner.id, {
        name: 'create-proposal-forbidden',
        visibility: 'PRIVATE',
      })

      const caller = createTestCaller(outsider.id)

      await expect(
        caller.proposals.create({
          packageId: pkg.id,
          title: 'Should fail',
          description: 'N/A',
          content: 'Body',
        })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('throws NOT_FOUND when packageId does not exist', async () => {
      const { user: owner } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      await expect(
        caller.proposals.create({
          packageId: 'non-existent-pkg',
          title: 'Title',
          description: 'Desc',
          content: 'Body',
        })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    it('throws UNAUTHORIZED for unauthenticated caller', async () => {
      const caller = createUnauthenticatedCaller()

      await expect(
        caller.proposals.create({
          packageId: 'any-id',
          title: 'Title',
          description: 'Desc',
          content: 'Body',
        })
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })
  })

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------

  describe('update', () => {
    it('allows the author to update an OPEN proposal', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'update-proposal-skill' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Original Title',
          content: { body: 'Original content' },
          status: 'OPEN',
        },
      })

      const caller = createTestCaller(owner.id)
      const result = await caller.proposals.update({
        id: proposal.id,
        title: 'Updated Title',
        content: 'Updated content',
      })

      expect(result.title).toBe('Updated Title')
    })

    it('allows the author to update an IN_REVIEW proposal', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'update-in-review-skill' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'In Review Proposal',
          content: { body: 'In review content' },
          status: 'IN_REVIEW',
        },
      })

      const caller = createTestCaller(owner.id)
      const result = await caller.proposals.update({
        id: proposal.id,
        description: 'Updated description',
      })

      expect(result).toBeDefined()
    })

    it('throws FORBIDDEN when a non-author tries to update', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const otherUser = await createTestUser({ email: 'other-update@example.com' })
      const pkg = await createTestPackage(org.id, owner.id, { name: 'update-forbidden-skill' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Someone else proposal',
          content: { body: 'Content' },
          status: 'OPEN',
        },
      })

      const caller = createTestCaller(otherUser.id)

      await expect(
        caller.proposals.update({ id: proposal.id, title: 'Hijacked' })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('throws BAD_REQUEST when attempting to update a MERGED proposal', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'update-merged-skill' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Merged Proposal',
          content: { body: 'Merged content' },
          status: 'MERGED',
        },
      })

      const caller = createTestCaller(owner.id)

      await expect(
        caller.proposals.update({ id: proposal.id, title: 'Cannot update' })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    })

    it('throws UNAUTHORIZED for unauthenticated caller', async () => {
      const caller = createUnauthenticatedCaller()

      await expect(caller.proposals.update({ id: 'any-id', title: 'Title' })).rejects.toMatchObject(
        { code: 'UNAUTHORIZED' }
      )
    })
  })

  // ---------------------------------------------------------------------------
  // comment
  // ---------------------------------------------------------------------------

  describe('comment', () => {
    it('allows a package member to comment on a proposal', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'comment-proposal-skill' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Commentable Proposal',
          content: { body: 'Content' },
          status: 'OPEN',
        },
      })

      const caller = createTestCaller(owner.id)
      const result = await caller.proposals.comment({
        proposalId: proposal.id,
        body: 'This looks great!',
      })

      expect(result).toBeDefined()
      expect(result.body).toBe('This looks great!')
    })

    it('throws FORBIDDEN when caller lacks package access', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const outsider = await createTestUser({ email: 'outsider-comment@example.com' })
      const pkg = await createTestPackage(org.id, owner.id, {
        name: 'comment-forbidden-skill',
        visibility: 'PRIVATE',
      })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Proposal',
          content: { body: 'Content' },
          status: 'OPEN',
        },
      })

      const caller = createTestCaller(outsider.id)

      await expect(
        caller.proposals.comment({ proposalId: proposal.id, body: 'Should fail' })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('throws UNAUTHORIZED for unauthenticated caller', async () => {
      const caller = createUnauthenticatedCaller()

      await expect(
        caller.proposals.comment({ proposalId: 'any-id', body: 'Body' })
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })
  })

  // ---------------------------------------------------------------------------
  // submitReview
  // ---------------------------------------------------------------------------

  describe('submitReview', () => {
    it('allows an org member to approve a proposal they did not author', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const reviewer = await createTestUser({ email: 'reviewer@example.com' })
      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: reviewer.id, role: 'MEMBER' },
      })
      const pkg = await createTestPackage(org.id, owner.id, { name: 'review-approve-skill' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Reviewable Proposal',
          content: { body: 'Content' },
          status: 'OPEN',
        },
      })

      const caller = createTestCaller(reviewer.id)
      const result = await caller.proposals.submitReview({
        proposalId: proposal.id,
        decision: 'APPROVED',
        body: 'Looks good to me.',
      })

      expect(result).toBeDefined()
    })

    it('submits a CHANGES_REQUESTED review with a body', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const reviewer = await createTestUser({ email: 'changes-reviewer@example.com' })
      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: reviewer.id, role: 'MEMBER' },
      })
      const pkg = await createTestPackage(org.id, owner.id, { name: 'review-changes-skill' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Needs Changes',
          content: { body: 'Content' },
          status: 'OPEN',
        },
      })

      const caller = createTestCaller(reviewer.id)
      const result = await caller.proposals.submitReview({
        proposalId: proposal.id,
        decision: 'CHANGES_REQUESTED',
        body: 'Please update the configuration section.',
      })

      expect(result).toBeDefined()
    })

    it('submits a COMMENTED review', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const reviewer = await createTestUser({ email: 'comment-reviewer@example.com' })
      await prisma.organisationMember.create({
        data: { organisationId: org.id, userId: reviewer.id, role: 'MEMBER' },
      })
      const pkg = await createTestPackage(org.id, owner.id, { name: 'review-comment-skill' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Comment Review',
          content: { body: 'Content' },
          status: 'OPEN',
        },
      })

      const caller = createTestCaller(reviewer.id)
      const result = await caller.proposals.submitReview({
        proposalId: proposal.id,
        decision: 'COMMENTED',
        body: 'Some general thoughts.',
      })

      expect(result).toBeDefined()
    })

    it('throws FORBIDDEN when the author tries to review their own proposal', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'review-own-skill' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Own Proposal',
          content: { body: 'Content' },
          status: 'OPEN',
        },
      })

      const caller = createTestCaller(owner.id)

      await expect(
        caller.proposals.submitReview({ proposalId: proposal.id, decision: 'APPROVED' })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('throws FORBIDDEN when caller is not an org member', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const nonMember = await createTestUser({ email: 'nonmember-review@example.com' })
      const pkg = await createTestPackage(org.id, owner.id, { name: 'review-nonmember-skill' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Non-member Proposal',
          content: { body: 'Content' },
          status: 'OPEN',
        },
      })

      const caller = createTestCaller(nonMember.id)

      await expect(
        caller.proposals.submitReview({ proposalId: proposal.id, decision: 'APPROVED' })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('throws UNAUTHORIZED for unauthenticated caller', async () => {
      const caller = createUnauthenticatedCaller()

      await expect(
        caller.proposals.submitReview({ proposalId: 'any-id', decision: 'APPROVED' })
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })
  })

  // ---------------------------------------------------------------------------
  // merge
  // ---------------------------------------------------------------------------

  describe('merge', () => {
    it('allows a package author to merge an APPROVED proposal', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'merge-approved-skill' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Ready to Merge',
          content: { body: 'Final content' },
          status: 'APPROVED',
        },
      })

      const caller = createTestCaller(owner.id)
      const result = await caller.proposals.merge({
        id: proposal.id,
        version: '0.0.2',
        changelog: 'Merged changes from proposal',
      })

      expect(result).toBeDefined()
      expect(result.status).toBe('MERGED')
    })

    it('allows merging an OPEN proposal without specifying version', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'merge-open-skill' })
      await createTestVersion(pkg.id, { version: '0.0.1' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Open Merge',
          content: { body: 'Updated content' },
          status: 'OPEN',
        },
      })

      const caller = createTestCaller(owner.id)
      const result = await caller.proposals.merge({ id: proposal.id })

      expect(result.status).toBe('MERGED')
    })

    it('throws FORBIDDEN when a non-admin tries to merge', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const nonAdmin = await createTestUser({ email: 'nonadmin-merge@example.com' })
      const pkg = await createTestPackage(org.id, owner.id, { name: 'merge-forbidden-skill' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Merge forbidden',
          content: { body: 'Content' },
          status: 'APPROVED',
        },
      })

      const caller = createTestCaller(nonAdmin.id)

      await expect(caller.proposals.merge({ id: proposal.id })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
    })

    it('throws BAD_REQUEST when proposal status is REJECTED', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'merge-rejected-skill' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Rejected Proposal',
          content: { body: 'Content' },
          status: 'REJECTED',
        },
      })

      const caller = createTestCaller(owner.id)

      await expect(caller.proposals.merge({ id: proposal.id })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      })
    })

    it('throws UNAUTHORIZED for unauthenticated caller', async () => {
      const caller = createUnauthenticatedCaller()

      await expect(caller.proposals.merge({ id: 'any-id' })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      })
    })
  })

  // ---------------------------------------------------------------------------
  // reject
  // ---------------------------------------------------------------------------

  describe('reject', () => {
    it('allows a package author/admin to reject a proposal', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'reject-skill' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'To Reject',
          content: { body: 'Content' },
          status: 'OPEN',
        },
      })

      const caller = createTestCaller(owner.id)
      const result = await caller.proposals.reject({ id: proposal.id })

      expect(result.status).toBe('REJECTED')
    })

    it('throws FORBIDDEN when a non-admin tries to reject', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const nonAdmin = await createTestUser({ email: 'nonadmin-reject@example.com' })
      const pkg = await createTestPackage(org.id, owner.id, { name: 'reject-forbidden-skill' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Reject forbidden',
          content: { body: 'Content' },
          status: 'OPEN',
        },
      })

      const caller = createTestCaller(nonAdmin.id)

      await expect(caller.proposals.reject({ id: proposal.id })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
    })

    it('throws NOT_FOUND for unknown proposal id', async () => {
      const { user: owner } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      await expect(caller.proposals.reject({ id: 'non-existent' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })

    it('throws UNAUTHORIZED for unauthenticated caller', async () => {
      const caller = createUnauthenticatedCaller()

      await expect(caller.proposals.reject({ id: 'any-id' })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      })
    })
  })

  // ---------------------------------------------------------------------------
  // close
  // ---------------------------------------------------------------------------

  describe('close', () => {
    it('allows the proposal author to close an OPEN proposal', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'close-skill' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'To Close',
          content: { body: 'Content' },
          status: 'OPEN',
        },
      })

      const caller = createTestCaller(owner.id)
      const result = await caller.proposals.close({ id: proposal.id })

      expect(result.status).toBe('CLOSED')
    })

    it('throws FORBIDDEN when a non-author tries to close', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const otherUser = await createTestUser({ email: 'other-close@example.com' })
      const pkg = await createTestPackage(org.id, owner.id, { name: 'close-forbidden-skill' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Close forbidden',
          content: { body: 'Content' },
          status: 'OPEN',
        },
      })

      const caller = createTestCaller(otherUser.id)

      await expect(caller.proposals.close({ id: proposal.id })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
    })

    it('throws BAD_REQUEST when attempting to close a MERGED proposal', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'close-merged-skill' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Merged Cannot Close',
          content: { body: 'Content' },
          status: 'MERGED',
        },
      })

      const caller = createTestCaller(owner.id)

      await expect(caller.proposals.close({ id: proposal.id })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      })
    })

    it('throws BAD_REQUEST when attempting to close a REJECTED proposal', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'close-rejected-skill' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Rejected Cannot Close',
          content: { body: 'Content' },
          status: 'REJECTED',
        },
      })

      const caller = createTestCaller(owner.id)

      await expect(caller.proposals.close({ id: proposal.id })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      })
    })

    it('throws UNAUTHORIZED for unauthenticated caller', async () => {
      const caller = createUnauthenticatedCaller()

      await expect(caller.proposals.close({ id: 'any-id' })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      })
    })
  })

  // ---------------------------------------------------------------------------
  // reopen
  // ---------------------------------------------------------------------------

  describe('reopen', () => {
    it('allows the author to reopen a CLOSED proposal', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'reopen-skill' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'To Reopen',
          content: { body: 'Content' },
          status: 'CLOSED',
        },
      })

      const caller = createTestCaller(owner.id)
      const result = await caller.proposals.reopen({ id: proposal.id })

      expect(result.status).toBe('OPEN')
    })

    it('throws FORBIDDEN when a non-author tries to reopen', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const otherUser = await createTestUser({ email: 'other-reopen@example.com' })
      const pkg = await createTestPackage(org.id, owner.id, { name: 'reopen-forbidden-skill' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Reopen forbidden',
          content: { body: 'Content' },
          status: 'CLOSED',
        },
      })

      const caller = createTestCaller(otherUser.id)

      await expect(caller.proposals.reopen({ id: proposal.id })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
    })

    it('throws BAD_REQUEST when proposal is not in CLOSED status', async () => {
      const { user: owner, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, owner.id, { name: 'reopen-open-skill' })
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.id,
          authorId: owner.id,
          title: 'Already Open',
          content: { body: 'Content' },
          status: 'OPEN',
        },
      })

      const caller = createTestCaller(owner.id)

      await expect(caller.proposals.reopen({ id: proposal.id })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      })
    })

    it('throws NOT_FOUND for unknown proposal id', async () => {
      const { user: owner } = await createTestOrgWithOwner()
      const caller = createTestCaller(owner.id)

      await expect(caller.proposals.reopen({ id: 'non-existent' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })

    it('throws UNAUTHORIZED for unauthenticated caller', async () => {
      const caller = createUnauthenticatedCaller()

      await expect(caller.proposals.reopen({ id: 'any-id' })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      })
    })
  })
})
