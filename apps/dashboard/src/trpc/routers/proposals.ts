import { type Prisma, prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { logAudit } from '@/lib/audit/logger'
import { validateBranchProtection } from '@/lib/branch-protection'
import { calculateDiffStat, parseUnifiedDiff } from '@/lib/diff-parser'
import { GitProviderConfigError, getGitProvider } from '@/lib/git'
import { deliverEvent } from '@/lib/webhooks/service'
import { protectedProcedure, router } from '../init'

const logger = createLogger('proposals-router')

const proposalStatusSchema = z.enum([
  'OPEN',
  'IN_REVIEW',
  'APPROVED',
  'MERGED',
  'REJECTED',
  'CLOSED',
])

const reviewDecisionSchema = z.enum(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'])

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type DiffStatJson = {
  filesChanged: number
  additions: number
  deletions: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a user has read access to a package.
 * Public packages are readable by anyone; private/team packages require org membership.
 */
async function hasPackageAccess(packageId: string, userId: string): Promise<boolean> {
  const pkg = await prisma.package.findUnique({
    where: { id: packageId },
    select: {
      visibility: true,
      organisationId: true,
      teamId: true,
    },
  })

  if (!pkg) return false
  if (pkg.visibility === 'PUBLIC') return true

  if (pkg.visibility === 'TEAM' && pkg.teamId) {
    const teamMember = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: pkg.teamId, userId } },
    })
    if (teamMember) return true
  }

  const orgMember = await prisma.organisationMember.findUnique({
    where: { userId_organisationId: { userId, organisationId: pkg.organisationId } },
  })

  return !!orgMember
}

/**
 * Check whether an organisation uses Agentver-managed git storage.
 */
function isAgentverGitOrg(provider: string | null | undefined): boolean {
  return provider === 'agentver'
}

/**
 * Create a notification record (non-blocking).
 */
function createNotification(params: {
  userId: string
  type:
    | 'PROPOSAL_OPENED'
    | 'PROPOSAL_APPROVED'
    | 'PROPOSAL_MERGED'
    | 'PROPOSAL_REJECTED'
    | 'PROPOSAL_COMMENTED'
    | 'REVIEW_REQUESTED'
  title: string
  body?: string
  resourceId?: string
  resourceType?: string
  actorId?: string
}): void {
  prisma.notification
    .create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        body: params.body ?? null,
        resourceId: params.resourceId ?? null,
        resourceType: params.resourceType ?? null,
        actorId: params.actorId ?? null,
      },
    })
    .catch(() => {
      // Swallow notification failures silently
    })
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const proposalsRouter = router({
  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  list: protectedProcedure
    .input(
      z.object({
        packageId: z.string(),
        status: proposalStatusSchema.optional(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const canAccess = await hasPackageAccess(input.packageId, ctx.user.id)
      if (!canAccess) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No access to this package' })
      }

      const where: Prisma.ChangeProposalWhereInput = {
        packageId: input.packageId,
        ...(input.status && { status: input.status }),
      }

      const proposals = await prisma.changeProposal.findMany({
        where,
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        orderBy: { createdAt: 'desc' },
        include: {
          author: { select: { id: true, name: true, image: true } },
          _count: { select: { comments: true, reviews: true } },
        },
      })

      let nextCursor: string | undefined
      if (proposals.length > input.limit) {
        const next = proposals.pop()
        nextCursor = next?.id
      }

      return { proposals, nextCursor }
    }),

  getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const proposal = await prisma.changeProposal.findUnique({
      where: { id: input.id },
      include: {
        author: { select: { id: true, name: true, image: true, email: true } },
        package: {
          select: {
            id: true,
            name: true,
            slug: true,
            readme: true,
            authorId: true,
            organisationId: true,
            organisation: {
              select: { slug: true, name: true, skillsRepoProvider: true },
            },
          },
        },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: {
            author: { select: { id: true, name: true, image: true } },
            replies: {
              orderBy: { createdAt: 'asc' },
              include: {
                author: { select: { id: true, name: true, image: true } },
              },
            },
          },
        },
        reviews: {
          orderBy: { createdAt: 'desc' },
          include: {
            reviewer: { select: { id: true, name: true, image: true } },
          },
        },
      },
    })

    if (!proposal) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposal not found' })
    }

    const canAccess = await hasPackageAccess(proposal.packageId, ctx.user.id)
    if (!canAccess) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'No access to this package' })
    }

    // Determine the current user's role on this package
    const membership = await prisma.organisationMember.findUnique({
      where: {
        userId_organisationId: {
          userId: ctx.user.id,
          organisationId: proposal.package.organisationId,
        },
      },
      select: { role: true },
    })

    const isPackageAuthor = proposal.package.authorId === ctx.user.id
    const isProposalAuthor = proposal.authorId === ctx.user.id
    const isOrgAdminOrOwner = membership?.role === 'ADMIN' || membership?.role === 'OWNER'
    const isOrgMember = !!membership
    const canMerge = isPackageAuthor || isOrgAdminOrOwner
    const canReview = isOrgMember && !isProposalAuthor

    // Fetch diff if this is an Agentver-backed proposal with git SHAs
    let diff: ReturnType<typeof parseUnifiedDiff> | null = null
    let diffStatSummary: DiffStatJson | null = null

    if (
      isAgentverGitOrg(proposal.package.organisation.skillsRepoProvider) &&
      proposal.baseSha &&
      proposal.headSha
    ) {
      try {
        const gitService = getGitProvider()
        const rawDiff = await gitService.getDiff(
          proposal.package.organisation.slug,
          proposal.baseSha,
          proposal.headSha
        )
        diff = parseUnifiedDiff(rawDiff)
        diffStatSummary = calculateDiffStat(diff)
      } catch (error) {
        if (error instanceof GitProviderConfigError) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
        }
        logger.warn('Failed to fetch diff for proposal', {
          proposalId: input.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Group inline comments by file path for UI rendering
    const inlineComments = proposal.comments.filter((c) => c.filePath !== null)
    const generalComments = proposal.comments.filter(
      (c) => c.filePath === null && c.parentId === null
    )

    const commentsByFile = new Map<string, typeof inlineComments>()
    for (const comment of inlineComments) {
      const filePath = comment.filePath!
      const existing = commentsByFile.get(filePath) ?? []
      existing.push(comment)
      commentsByFile.set(filePath, existing)
    }

    return {
      ...proposal,
      diff,
      diffStat: diffStatSummary ?? (proposal.diffStat as DiffStatJson | null),
      generalComments,
      commentsByFile: Object.fromEntries(commentsByFile),
      permissions: {
        isProposalAuthor,
        isPackageAuthor,
        isOrgAdminOrOwner,
        isOrgMember,
        canMerge,
        canReview,
      },
    }
  }),

  listForUser: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const proposals = await prisma.changeProposal.findMany({
        where: {
          OR: [{ authorId: ctx.user.id }, { reviews: { some: { reviewerId: ctx.user.id } } }],
        },
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        orderBy: { createdAt: 'desc' },
        include: {
          author: { select: { id: true, name: true, image: true } },
          package: {
            select: {
              name: true,
              organisation: { select: { slug: true } },
            },
          },
          _count: { select: { comments: true, reviews: true } },
        },
      })

      let nextCursor: string | undefined
      if (proposals.length > input.limit) {
        const next = proposals.pop()
        nextCursor = next?.id
      }

      return { proposals, nextCursor }
    }),

  getDiff: protectedProcedure
    .input(z.object({ proposalId: z.string() }))
    .query(async ({ ctx, input }) => {
      const proposal = await prisma.changeProposal.findUnique({
        where: { id: input.proposalId },
        include: {
          package: {
            select: {
              id: true,
              organisationId: true,
              organisation: {
                select: { slug: true, skillsRepoProvider: true },
              },
            },
          },
        },
      })

      if (!proposal) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposal not found' })
      }

      const canAccess = await hasPackageAccess(proposal.packageId, ctx.user.id)
      if (!canAccess) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No access to this package' })
      }

      if (!isAgentverGitOrg(proposal.package.organisation.skillsRepoProvider)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Diffs are only available for Agentver-backed organisations',
        })
      }

      if (!proposal.baseSha || !proposal.headSha) {
        return { files: [], raw: '' }
      }

      try {
        const gitService = getGitProvider()
        const rawDiff = await gitService.getDiff(
          proposal.package.organisation.slug,
          proposal.baseSha,
          proposal.headSha
        )
        const files = parseUnifiedDiff(rawDiff)

        return { files, raw: rawDiff }
      } catch (error) {
        if (error instanceof GitProviderConfigError) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
        }
        logger.error('Failed to fetch proposal diff', {
          proposalId: input.proposalId,
          error: error instanceof Error ? error.message : String(error),
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch diff from Git',
        })
      }
    }),

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  create: protectedProcedure
    .input(
      z.object({
        packageId: z.string(),
        title: z.string().min(1).max(200),
        description: z.string().max(5000).optional(),
        content: z.string().min(1),
        files: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const pkg = await prisma.package.findUnique({
        where: { id: input.packageId },
        include: {
          organisation: {
            include: { members: { where: { userId: ctx.user.id } } },
          },
          versions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { version: true },
          },
        },
      })

      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' })
      }

      const isPublic = pkg.visibility === 'PUBLIC'
      const isMember = pkg.organisation.members.length > 0
      if (!isPublic && !isMember) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No access to this package' })
      }

      const baseVersion = pkg.versions[0]?.version ?? null
      const useGit = isAgentverGitOrg(pkg.organisation.skillsRepoProvider)
      const orgSlug = pkg.organisation.slug

      // Build the content JSON — either legacy body or files format
      const contentJson: Prisma.InputJsonValue = input.files
        ? ({ files: input.files } as unknown as Prisma.InputJsonValue)
        : ({ body: input.content } as Prisma.InputJsonValue)

      // Create the proposal record first to get the ID
      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: input.packageId,
          authorId: ctx.user.id,
          title: input.title,
          description: input.description,
          content: contentJson,
          status: 'OPEN',
          baseVersion,
          targetBranch: 'main',
        },
        include: {
          author: { select: { id: true, name: true, image: true } },
        },
      })

      // For Agentver-backed orgs, create a git branch and optionally commit files
      if (useGit) {
        try {
          const gitService = getGitProvider()

          // Create the suggestion branch
          const { branchName, baseSha } = await gitService.createSuggestionBranch(
            orgSlug,
            proposal.id
          )

          let headSha = baseSha
          let diffStat: Prisma.InputJsonValue | undefined

          // If the proposal includes file changes, commit them to the branch
          if (input.files && input.files.length > 0) {
            const commitResult = await gitService.commitFilesToBranch(
              orgSlug,
              branchName,
              input.files,
              `suggestion: ${input.title}`
            )
            headSha = commitResult.commitSha

            // Calculate diff stats
            try {
              const rawDiff = await gitService.getDiff(orgSlug, baseSha, headSha)
              const parsed = parseUnifiedDiff(rawDiff)
              const stats = calculateDiffStat(parsed)
              diffStat = stats as unknown as Prisma.InputJsonValue
            } catch {
              // Diff stat calculation is best-effort
            }
          }

          // Update the proposal with git metadata
          await prisma.changeProposal.update({
            where: { id: proposal.id },
            data: {
              sourceBranch: branchName,
              baseSha,
              headSha,
              ...(diffStat && { diffStat }),
            },
          })
        } catch (error) {
          if (error instanceof GitProviderConfigError) {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
          }
          logger.error('Failed to create suggestion branch', {
            proposalId: proposal.id,
            orgSlug,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      logAudit({
        userId: ctx.user.id,
        action: 'PROPOSAL_CREATED',
        resource: 'ChangeProposal',
        resourceId: proposal.id,
        metadata: { packageId: input.packageId, title: input.title },
      })

      // Notify the package author
      if (pkg.authorId !== ctx.user.id) {
        createNotification({
          userId: pkg.authorId,
          type: 'PROPOSAL_OPENED',
          title: `New proposal on ${pkg.name}`,
          body: input.title,
          resourceId: proposal.id,
          resourceType: 'proposal',
          actorId: ctx.user.id,
        })
      }

      void deliverEvent(
        pkg.organisationId,
        'suggestion.opened',
        { id: ctx.user.id, username: ctx.user.name ?? ctx.user.email },
        { proposal: { id: proposal.id, title: input.title }, skill: { name: pkg.name } }
      )

      return proposal
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(5000).optional(),
        content: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const proposal = await prisma.changeProposal.findUnique({
        where: { id: input.id },
        select: { authorId: true, status: true },
      })

      if (!proposal) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposal not found' })
      }

      if (proposal.authorId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the proposal author can edit' })
      }

      const editableStatuses = ['OPEN', 'IN_REVIEW'] as const
      if (!editableStatuses.includes(proposal.status as (typeof editableStatuses)[number])) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Proposals can only be edited while open or in review',
        })
      }

      const updated = await prisma.changeProposal.update({
        where: { id: input.id },
        data: {
          ...(input.title !== undefined && { title: input.title }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.content !== undefined && {
            content: { body: input.content } as Prisma.InputJsonValue,
          }),
        },
      })

      return updated
    }),

  updateContent: protectedProcedure
    .input(
      z.object({
        proposalId: z.string(),
        files: z.array(z.object({ path: z.string(), content: z.string() })),
        message: z.string().min(1).max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const proposal = await prisma.changeProposal.findUnique({
        where: { id: input.proposalId },
        include: {
          package: {
            select: {
              organisationId: true,
              organisation: {
                select: { slug: true, skillsRepoProvider: true },
              },
            },
          },
        },
      })

      if (!proposal) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposal not found' })
      }

      if (proposal.authorId !== ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the proposal author can update content',
        })
      }

      const editableStatuses = ['OPEN', 'IN_REVIEW'] as const
      if (!editableStatuses.includes(proposal.status as (typeof editableStatuses)[number])) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot update content on a closed or merged proposal',
        })
      }

      if (!isAgentverGitOrg(proposal.package.organisation.skillsRepoProvider)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Content updates are only supported for Agentver-backed organisations',
        })
      }

      if (!proposal.sourceBranch) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This proposal has no associated suggestion branch',
        })
      }

      const orgSlug = proposal.package.organisation.slug

      try {
        const gitService = getGitProvider()

        // Commit the new files to the suggestion branch
        const { commitSha } = await gitService.commitFilesToBranch(
          orgSlug,
          proposal.sourceBranch,
          input.files,
          input.message
        )

        // Recalculate diff stats
        let diffStat: Prisma.InputJsonValue | undefined
        if (proposal.baseSha) {
          try {
            const rawDiff = await gitService.getDiff(orgSlug, proposal.baseSha, commitSha)
            const parsed = parseUnifiedDiff(rawDiff)
            const stats = calculateDiffStat(parsed)
            diffStat = stats as unknown as Prisma.InputJsonValue
          } catch {
            // Best-effort diff stat calculation
          }
        }

        // Update the proposal with the new head SHA and content
        const updated = await prisma.changeProposal.update({
          where: { id: input.proposalId },
          data: {
            headSha: commitSha,
            content: { files: input.files } as unknown as Prisma.InputJsonValue,
            ...(diffStat && { diffStat }),
          },
        })

        return updated
      } catch (error) {
        if (error instanceof TRPCError) throw error
        if (error instanceof GitProviderConfigError) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
        }

        logger.error('Failed to update suggestion content', {
          proposalId: input.proposalId,
          error: error instanceof Error ? error.message : String(error),
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to commit content changes to the suggestion branch',
        })
      }
    }),

  comment: protectedProcedure
    .input(
      z.object({
        proposalId: z.string(),
        body: z.string().min(1).max(10000),
        filePath: z.string().optional(),
        lineStart: z.number().int().positive().optional(),
        lineEnd: z.number().int().positive().optional(),
        side: z.enum(['left', 'right']).optional(),
        parentId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const proposal = await prisma.changeProposal.findUnique({
        where: { id: input.proposalId },
        select: {
          id: true,
          authorId: true,
          packageId: true,
          title: true,
          reviews: { select: { reviewerId: true }, distinct: ['reviewerId'] },
        },
      })

      if (!proposal) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposal not found' })
      }

      const canAccess = await hasPackageAccess(proposal.packageId, ctx.user.id)
      if (!canAccess) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No access to this package' })
      }

      // If parentId is provided, verify the parent comment exists on this proposal
      if (input.parentId) {
        const parentComment = await prisma.proposalComment.findUnique({
          where: { id: input.parentId },
          select: { proposalId: true },
        })

        if (!parentComment || parentComment.proposalId !== input.proposalId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Parent comment not found or belongs to a different proposal',
          })
        }
      }

      const comment = await prisma.proposalComment.create({
        data: {
          proposalId: input.proposalId,
          authorId: ctx.user.id,
          body: input.body,
          filePath: input.filePath ?? null,
          lineStart: input.lineStart ?? null,
          lineEnd: input.lineEnd ?? null,
          side: input.side ?? null,
          parentId: input.parentId ?? null,
        },
        include: {
          author: { select: { id: true, name: true, image: true } },
        },
      })

      // Notify proposal author + reviewers (excluding commenter)
      const notifyUserIds = new Set<string>()
      if (proposal.authorId !== ctx.user.id) {
        notifyUserIds.add(proposal.authorId)
      }
      for (const review of proposal.reviews) {
        if (review.reviewerId !== ctx.user.id) {
          notifyUserIds.add(review.reviewerId)
        }
      }

      for (const userId of notifyUserIds) {
        createNotification({
          userId,
          type: 'PROPOSAL_COMMENTED',
          title: `New comment on "${proposal.title}"`,
          body: input.body.slice(0, 200),
          resourceId: proposal.id,
          resourceType: 'proposal',
          actorId: ctx.user.id,
        })
      }

      return comment
    }),

  resolveComment: protectedProcedure
    .input(z.object({ commentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const comment = await prisma.proposalComment.findUnique({
        where: { id: input.commentId },
        include: {
          proposal: {
            select: {
              packageId: true,
              package: {
                select: {
                  organisationId: true,
                  organisation: {
                    select: {
                      members: {
                        where: { userId: ctx.user.id },
                        select: { role: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      })

      if (!comment) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found' })
      }

      // Only the comment author or org admin/owner can resolve
      const membership = comment.proposal.package.organisation.members[0]
      const isCommentAuthor = comment.authorId === ctx.user.id
      const isAdminOrOwner = membership?.role === 'ADMIN' || membership?.role === 'OWNER'

      if (!isCommentAuthor && !isAdminOrOwner) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the comment author or organisation admins can resolve comments',
        })
      }

      const resolved = await prisma.proposalComment.update({
        where: { id: input.commentId },
        data: { resolved: true },
      })

      return resolved
    }),

  submitReview: protectedProcedure
    .input(
      z.object({
        proposalId: z.string(),
        decision: reviewDecisionSchema,
        body: z.string().max(10000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const proposal = await prisma.changeProposal.findUnique({
        where: { id: input.proposalId },
        include: {
          package: {
            select: {
              organisationId: true,
              name: true,
              organisation: {
                include: { members: { where: { userId: ctx.user.id } } },
              },
            },
          },
          reviews: { select: { reviewerId: true, decision: true } },
        },
      })

      if (!proposal) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposal not found' })
      }

      if (proposal.authorId === ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You cannot review your own proposal',
        })
      }

      const isMember = proposal.package.organisation.members.length > 0
      if (!isMember) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only organisation members can submit reviews',
        })
      }

      const review = await prisma.proposalReview.create({
        data: {
          proposalId: input.proposalId,
          reviewerId: ctx.user.id,
          decision: input.decision,
          body: input.body,
        },
        include: {
          reviewer: { select: { id: true, name: true, image: true } },
        },
      })

      // Check if all reviews are now APPROVED — if so, auto-set status to APPROVED
      if (input.decision === 'APPROVED') {
        const allReviews = await prisma.proposalReview.findMany({
          where: { proposalId: input.proposalId },
          orderBy: { createdAt: 'desc' },
          distinct: ['reviewerId'],
          select: { decision: true },
        })

        const allApproved = allReviews.every((r) => r.decision === 'APPROVED')
        if (allApproved && allReviews.length > 0) {
          await prisma.changeProposal.update({
            where: { id: input.proposalId },
            data: { status: 'APPROVED' },
          })
        }
      } else if (input.decision === 'CHANGES_REQUESTED') {
        await prisma.changeProposal.update({
          where: { id: input.proposalId },
          data: { status: 'IN_REVIEW' },
        })
      }

      // Notify the proposal author
      if (proposal.authorId !== ctx.user.id) {
        const decisionLabel =
          input.decision === 'APPROVED'
            ? 'approved'
            : input.decision === 'CHANGES_REQUESTED'
              ? 'requested changes on'
              : 'commented on'

        createNotification({
          userId: proposal.authorId,
          type: input.decision === 'APPROVED' ? 'PROPOSAL_APPROVED' : 'REVIEW_REQUESTED',
          title: `Review ${decisionLabel} "${proposal.title}"`,
          body: input.body?.slice(0, 200),
          resourceId: proposal.id,
          resourceType: 'proposal',
          actorId: ctx.user.id,
        })
      }

      return review
    }),

  merge: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        version: z
          .string()
          .regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/)
          .optional(),
        changelog: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const proposal = await prisma.changeProposal.findUnique({
        where: { id: input.id },
        include: {
          package: {
            include: {
              organisation: {
                include: { members: { where: { userId: ctx.user.id } } },
              },
            },
          },
        },
      })

      if (!proposal) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposal not found' })
      }

      const membership = proposal.package.organisation.members[0]
      const isPackageAuthor = proposal.package.authorId === ctx.user.id
      const isAdminOrOwner = membership?.role === 'ADMIN' || membership?.role === 'OWNER'

      if (!isPackageAuthor && !isAdminOrOwner) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the package author or organisation admins can merge proposals',
        })
      }

      if (proposal.status !== 'APPROVED' && proposal.status !== 'OPEN') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only open or approved proposals can be merged',
        })
      }

      // Validate branch protection rules
      const mergerRole = membership?.role ?? (isPackageAuthor ? 'ADMIN' : 'MEMBER')
      const branchCheck = await validateBranchProtection({
        organisationId: proposal.package.organisationId,
        targetBranch: proposal.targetBranch ?? 'main',
        proposalId: proposal.id,
        mergerRole: mergerRole as 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER',
      })

      if (!branchCheck.allowed) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `Branch protection violation: ${branchCheck.violations.join('; ')}`,
        })
      }

      const useGit = isAgentverGitOrg(proposal.package.organisation.skillsRepoProvider)
      const orgSlug = proposal.package.organisation.slug

      // Determine the next version number
      const latestVersion = await prisma.packageVersion.findFirst({
        where: { packageId: proposal.packageId },
        orderBy: { createdAt: 'desc' },
        select: { version: true },
      })

      const currentVersion = latestVersion?.version ?? '0.0.0'
      const parts = currentVersion.split('.')
      const major = Number.parseInt(parts[0]!, 10) || 0
      const minor = Number.parseInt(parts[1]!, 10) || 0
      const patch = Number.parseInt(parts[2]!, 10) || 0
      const nextVersion = input.version ?? `${major}.${minor}.${patch + 1}`

      let mergeCommitSha: string | null = null

      if (useGit && proposal.sourceBranch) {
        // Perform real git merge via Forgejo
        try {
          const gitService = getGitProvider()

          const mergeResult = await gitService.mergeDraft(
            orgSlug,
            proposal.sourceBranch,
            `Merge suggestion: ${proposal.title}`
          )
          mergeCommitSha = mergeResult.commitSha

          // Clean up the suggestion branch after merge
          try {
            await gitService.deleteSuggestionBranch(orgSlug, proposal.id)
          } catch (cleanupError) {
            logger.warn('Failed to delete suggestion branch after merge', {
              proposalId: proposal.id,
              error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            })
          }
        } catch (error) {
          if (error instanceof GitProviderConfigError) {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
          }
          logger.error('Failed to merge suggestion branch', {
            proposalId: proposal.id,
            orgSlug,
            sourceBranch: proposal.sourceBranch,
            error: error instanceof Error ? error.message : String(error),
          })
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to merge the suggestion branch. There may be conflicts.',
          })
        }
      } else {
        // Non-git org: apply the content to the package readme (legacy behaviour)
        const proposalContent = proposal.content as { body?: string } | null
        const newContent = proposalContent?.body ?? ''

        await prisma.package.update({
          where: { id: proposal.packageId },
          data: { readme: newContent },
        })
      }

      // Create a PackageVersion to track the merge in version history
      await prisma.packageVersion.create({
        data: {
          packageId: proposal.packageId,
          version: nextVersion,
          changelog: input.changelog ?? `Merged proposal: ${proposal.title}`,
          ...(mergeCommitSha && {
            gitCommitSha: mergeCommitSha,
            gitRef: 'main',
          }),
        },
      })

      // Set proposal as merged
      const merged = await prisma.changeProposal.update({
        where: { id: input.id },
        data: {
          status: 'MERGED',
          mergedAt: new Date(),
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'PROPOSAL_MERGED',
        resource: 'ChangeProposal',
        resourceId: input.id,
        metadata: {
          packageId: proposal.packageId,
          title: proposal.title,
          version: nextVersion,
          commitSha: mergeCommitSha,
        },
      })

      // Notify proposal author
      if (proposal.authorId !== ctx.user.id) {
        createNotification({
          userId: proposal.authorId,
          type: 'PROPOSAL_MERGED',
          title: `Your proposal "${proposal.title}" was merged`,
          resourceId: proposal.id,
          resourceType: 'proposal',
          actorId: ctx.user.id,
        })
      }

      void deliverEvent(
        proposal.package.organisationId,
        'suggestion.merged',
        { id: ctx.user.id, username: ctx.user.name ?? ctx.user.email },
        {
          proposal: { id: proposal.id, title: proposal.title },
          skill: { name: proposal.package.name },
          version: nextVersion,
        }
      )

      return merged
    }),

  reject: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const proposal = await prisma.changeProposal.findUnique({
        where: { id: input.id },
        include: {
          package: {
            include: {
              organisation: {
                include: { members: { where: { userId: ctx.user.id } } },
              },
            },
          },
        },
      })

      if (!proposal) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposal not found' })
      }

      const membership = proposal.package.organisation.members[0]
      const isPackageAuthor = proposal.package.authorId === ctx.user.id
      const isAdminOrOwner = membership?.role === 'ADMIN' || membership?.role === 'OWNER'

      if (!isPackageAuthor && !isAdminOrOwner) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the package author or organisation admins can reject proposals',
        })
      }

      const rejected = await prisma.changeProposal.update({
        where: { id: input.id },
        data: {
          status: 'REJECTED',
          closedAt: new Date(),
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'PROPOSAL_REJECTED',
        resource: 'ChangeProposal',
        resourceId: input.id,
        metadata: { packageId: proposal.packageId, title: proposal.title },
      })

      if (proposal.authorId !== ctx.user.id) {
        createNotification({
          userId: proposal.authorId,
          type: 'PROPOSAL_REJECTED',
          title: `Your proposal "${proposal.title}" was rejected`,
          resourceId: proposal.id,
          resourceType: 'proposal',
          actorId: ctx.user.id,
        })
      }

      void deliverEvent(
        proposal.package.organisationId,
        'suggestion.rejected',
        { id: ctx.user.id, username: ctx.user.name ?? ctx.user.email },
        {
          proposal: { id: proposal.id, title: proposal.title },
          skill: { name: proposal.package.name },
        }
      )

      return rejected
    }),

  close: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const proposal = await prisma.changeProposal.findUnique({
      where: { id: input.id },
      select: { authorId: true, status: true },
    })

    if (!proposal) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposal not found' })
    }

    if (proposal.authorId !== ctx.user.id) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only the proposal author can close it',
      })
    }

    if (proposal.status === 'MERGED' || proposal.status === 'REJECTED') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Cannot close a merged or rejected proposal',
      })
    }

    const closed = await prisma.changeProposal.update({
      where: { id: input.id },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
      },
    })

    logAudit({
      userId: ctx.user.id,
      action: 'PROPOSAL_CLOSED',
      resource: 'ChangeProposal',
      resourceId: input.id,
    })

    return closed
  }),

  reopen: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const proposal = await prisma.changeProposal.findUnique({
        where: { id: input.id },
        select: { authorId: true, status: true },
      })

      if (!proposal) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposal not found' })
      }

      if (proposal.authorId !== ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the proposal author can reopen it',
        })
      }

      if (proposal.status !== 'CLOSED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only closed proposals can be reopened',
        })
      }

      const reopened = await prisma.changeProposal.update({
        where: { id: input.id },
        data: {
          status: 'OPEN',
          closedAt: null,
        },
      })

      return reopened
    }),

  inlineComment: protectedProcedure
    .input(
      z.object({
        proposalId: z.string(),
        body: z.string().min(1).max(10000),
        filePath: z.string().optional(),
        lineStart: z.number().int().optional(),
        lineEnd: z.number().int().optional(),
        side: z.string().optional(),
        parentId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const proposal = await prisma.changeProposal.findUnique({
        where: { id: input.proposalId },
        select: {
          id: true,
          authorId: true,
          packageId: true,
          title: true,
        },
      })

      if (!proposal) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposal not found' })
      }

      const canAccess = await hasPackageAccess(proposal.packageId, ctx.user.id)
      if (!canAccess) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No access to this package' })
      }

      const comment = await prisma.proposalComment.create({
        data: {
          proposalId: input.proposalId,
          authorId: ctx.user.id,
          body: input.body,
          filePath: input.filePath ?? null,
          lineStart: input.lineStart ?? null,
          lineEnd: input.lineEnd ?? null,
          side: input.side ?? null,
          parentId: input.parentId ?? null,
        },
        include: {
          author: { select: { id: true, name: true, image: true } },
        },
      })

      if (proposal.authorId !== ctx.user.id) {
        createNotification({
          userId: proposal.authorId,
          type: 'PROPOSAL_COMMENTED',
          title: `New inline comment on "${proposal.title}"`,
          body: input.body.slice(0, 200),
          resourceId: proposal.id,
          resourceType: 'proposal',
          actorId: ctx.user.id,
        })
      }

      return comment
    }),
})
