import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { z } from 'zod'

const logger = createLogger('branch-protection')

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const branchProtectionRuleSchema = z.object({
  branch: z.string().min(1),
  requireApproval: z.boolean().default(true),
  requiredApprovals: z.number().int().min(0).max(10).default(1),
  requireUpToDate: z.boolean().default(false),
  allowedMergeRoles: z.array(z.enum(['OWNER', 'ADMIN', 'MEMBER'])).default(['OWNER', 'ADMIN']),
})

export type BranchProtectionRule = z.infer<typeof branchProtectionRuleSchema>

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export type BranchProtectionResult = {
  allowed: boolean
  violations: string[]
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Validate whether a merge is permitted under the branch protection rules
 * configured for an organisation. Returns a result object containing an
 * `allowed` flag and any violation messages.
 */
export async function validateBranchProtection(params: {
  organisationId: string
  targetBranch: string
  proposalId: string
  mergerRole: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'
}): Promise<BranchProtectionResult> {
  const { organisationId, targetBranch, proposalId, mergerRole } = params
  const violations: string[] = []

  const org = await prisma.organisation.findUnique({
    where: { id: organisationId },
    select: { branchProtectionRules: true },
  })

  if (!org) {
    return { allowed: false, violations: ['Organisation not found'] }
  }

  // No rules configured — allow by default
  if (!org.branchProtectionRules) {
    return { allowed: true, violations: [] }
  }

  // Parse the rules from the JSON column
  let rules: BranchProtectionRule[]
  try {
    const parsed = z.array(branchProtectionRuleSchema).safeParse(org.branchProtectionRules)
    if (!parsed.success) {
      logger.warn('Invalid branch protection rules, allowing merge', {
        organisationId,
        error: parsed.error.message,
      })
      return { allowed: true, violations: [] }
    }
    rules = parsed.data
  } catch {
    return { allowed: true, violations: [] }
  }

  // Find the rule that matches the target branch
  const rule = rules.find((r) => r.branch === targetBranch)
  if (!rule) {
    return { allowed: true, violations: [] }
  }

  // Check role-based access
  if (!rule.allowedMergeRoles.includes(mergerRole as 'OWNER' | 'ADMIN' | 'MEMBER')) {
    violations.push(
      `Your role (${mergerRole}) is not permitted to merge into ${targetBranch}. ` +
        `Allowed roles: ${rule.allowedMergeRoles.join(', ')}`
    )
  }

  // Check approval requirements
  if (rule.requireApproval && rule.requiredApprovals > 0) {
    // Deduplicate by reviewer — only count the latest review per reviewer
    const latestReviews = await prisma.proposalReview.findMany({
      where: { proposalId },
      orderBy: { createdAt: 'desc' },
      distinct: ['reviewerId'],
      select: { decision: true },
    })

    const uniqueApprovals = latestReviews.filter((r) => r.decision === 'APPROVED').length

    if (uniqueApprovals < rule.requiredApprovals) {
      violations.push(
        `Requires ${rule.requiredApprovals} approval(s) but only has ${uniqueApprovals}`
      )
    }
  }

  return {
    allowed: violations.length === 0,
    violations,
  }
}
