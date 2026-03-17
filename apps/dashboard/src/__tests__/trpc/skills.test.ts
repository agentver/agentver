import { prisma } from '@agentver/database/client'
import { TRPCError } from '@trpc/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTestOrgWithOwner,
  createTestPackage,
  createTestUser,
  createTestVersion,
} from '~/test/factories'
import { cleanDatabase, disconnectDatabase } from '~/test/helpers/db'
import { createTestCaller, createUnauthenticatedCaller } from '~/test/helpers/trpc'

vi.mock('@/lib/github/skills-repo', () => ({
  getRepoContents: vi.fn().mockResolvedValue({
    type: 'file',
    content: '# Test Skill',
    path: 'skills/test/SKILL.md',
    sha: 'abc123',
  }),
  commitFiles: vi.fn().mockResolvedValue({ sha: 'def456', branch: 'main' }),
  getDefaultBranch: vi.fn().mockResolvedValue('main'),
}))

beforeEach(async () => {
  await cleanDatabase()
})

afterAll(async () => {
  await disconnectDatabase()
})

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('skills.list', () => {
  it('returns empty list when no packages exist', async () => {
    const { org, user } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)

    const result = await caller.skills.list({ organisationId: org.id })

    expect(result.packages).toHaveLength(0)
    expect(result.nextCursor).toBeUndefined()
  })

  it('returns packages belonging to the organisation', async () => {
    const { org, user } = await createTestOrgWithOwner()
    await createTestPackage(org.id, user.id)
    await createTestPackage(org.id, user.id)

    const caller = createTestCaller(user.id)
    const result = await caller.skills.list({ organisationId: org.id })

    expect(result.packages).toHaveLength(2)
  })

  it('does not return packages from other organisations', async () => {
    const { org, user } = await createTestOrgWithOwner()
    const { org: otherOrg, user: otherUser } = await createTestOrgWithOwner()

    await createTestPackage(otherOrg.id, otherUser.id, { visibility: 'PUBLIC' })

    const caller = createTestCaller(user.id)
    const result = await caller.skills.list({ organisationId: org.id })

    expect(result.packages).toHaveLength(0)
  })

  it('filters by type', async () => {
    const { org, user } = await createTestOrgWithOwner()
    await createTestPackage(org.id, user.id, { type: 'SKILL' })
    await createTestPackage(org.id, user.id, { type: 'AGENT_CONFIG' })

    const caller = createTestCaller(user.id)
    const result = await caller.skills.list({ organisationId: org.id, type: 'SKILL' })

    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]?.type).toBe('SKILL')
  })

  it('filters by search term against name', async () => {
    const { org, user } = await createTestOrgWithOwner()
    await createTestPackage(org.id, user.id, { name: 'deploy-helper' })
    await createTestPackage(org.id, user.id, { name: 'review-agent' })

    const caller = createTestCaller(user.id)
    const result = await caller.skills.list({ organisationId: org.id, search: 'deploy' })

    expect(result.packages).toHaveLength(1)
    expect(result.packages[0]?.name).toBe('deploy-helper')
  })

  it('paginates results using cursor', async () => {
    const { org, user } = await createTestOrgWithOwner()

    for (let i = 0; i < 5; i++) {
      await createTestPackage(org.id, user.id)
    }

    const caller = createTestCaller(user.id)
    const firstPage = await caller.skills.list({ organisationId: org.id, limit: 3 })

    expect(firstPage.packages).toHaveLength(3)
    expect(firstPage.nextCursor).toBeDefined()

    const secondPage = await caller.skills.list({
      organisationId: org.id,
      limit: 3,
      cursor: firstPage.nextCursor,
    })

    expect(secondPage.packages).toHaveLength(2)
    expect(secondPage.nextCursor).toBeUndefined()
  })

  it('requires authentication', async () => {
    const caller = createUnauthenticatedCaller()

    await expect(caller.skills.list({ organisationId: 'any-org-id' })).rejects.toThrow(TRPCError)
  })
})

// ---------------------------------------------------------------------------
// getBySlug
// ---------------------------------------------------------------------------

describe('skills.getBySlug', () => {
  it('returns a package with versions and fork count', async () => {
    const { org, user } = await createTestOrgWithOwner()
    const pkg = await createTestPackage(org.id, user.id, { visibility: 'PUBLIC' })
    await createTestVersion(pkg.id, { version: '1.0.0' })

    const caller = createUnauthenticatedCaller()
    const result = await caller.skills.getBySlug({ org: org.slug, name: pkg.name })

    expect(result.id).toBe(pkg.id)
    expect(result.versions).toHaveLength(1)
    expect(typeof result._count.forks).toBe('number')
  })

  it('throws NOT_FOUND for an unknown slug', async () => {
    const caller = createUnauthenticatedCaller()

    await expect(
      caller.skills.getBySlug({ org: 'nonexistent-org', name: 'nonexistent-skill' })
    ).rejects.toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
  })

  it('is accessible without authentication', async () => {
    const { org, user } = await createTestOrgWithOwner()
    const pkg = await createTestPackage(org.id, user.id, { visibility: 'PUBLIC' })

    const caller = createUnauthenticatedCaller()
    await expect(caller.skills.getBySlug({ org: org.slug, name: pkg.name })).resolves.toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('skills.create', () => {
  it('creates a package record for an org member', async () => {
    const { org, user } = await createTestOrgWithOwner()
    const caller = createTestCaller(user.id)

    const result = await caller.skills.create({
      organisationId: org.id,
      name: 'my-new-skill',
      description: 'A freshly created skill',
      type: 'SKILL',
      gitUri: 'https://github.com/test-owner/test-repo',
      gitDefaultRef: 'main',
      gitPath: 'skills/my-new-skill',
    })

    expect(result.name).toBe('my-new-skill')
    expect(result.organisationId).toBe(org.id)
  })

  it('throws when the caller is not a member of the organisation', async () => {
    const { org } = await createTestOrgWithOwner()
    const outsider = await createTestUser()
    const caller = createTestCaller(outsider.id)

    await expect(
      caller.skills.create({
        organisationId: org.id,
        name: 'sneaky-skill',
        description: 'Should be rejected',
        type: 'SKILL',
        gitUri: 'https://github.com/test-owner/test-repo',
        gitDefaultRef: 'main',
        gitPath: 'skills/sneaky-skill',
      })
    ).rejects.toThrow(TRPCError)
  })

  it('requires authentication', async () => {
    const caller = createUnauthenticatedCaller()

    await expect(
      caller.skills.create({
        organisationId: 'any-org-id',
        name: 'test-skill',
        description: 'Test',
        type: 'SKILL',
        gitUri: 'https://github.com/test-owner/test-repo',
        gitDefaultRef: 'main',
        gitPath: 'skills/test-skill',
      })
    ).rejects.toThrow(TRPCError)
  })
})

// ---------------------------------------------------------------------------
// createViaWeb
// ---------------------------------------------------------------------------

describe('skills.createViaWeb', () => {
  it('creates a package and initial version via web editor on the happy path', async () => {
    const { org, user } = await createTestOrgWithOwner()

    await prisma.organisation.update({
      where: { id: org.id },
      data: {
        skillsRepoOwner: 'test-owner',
        skillsRepoName: 'test-repo',
        skillsRepoUrl: 'https://github.com/test-owner/test-repo',
      },
    })

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

    const result = await caller.skills.createViaWeb({
      organisationId: org.id,
      name: 'web-created-skill',
      description: 'Created through the web editor',
      type: 'SKILL',
      content: '# Web Created Skill\n\nThis was created via the web editor.',
    })

    expect(result.name).toBe('web-created-skill')

    const version = await prisma.packageVersion.findFirst({
      where: { packageId: result.id },
    })
    expect(version?.version).toBe('1.0.0')
  })

  it('throws when the org has no skills repo configured', async () => {
    const { org, user } = await createTestOrgWithOwner()

    await prisma.connectedAccount.create({
      data: {
        userId: user.id,
        provider: 'GITHUB',
        providerAccountId: 'gh-456',
        accessToken: 'test-token',
        scopes: ['repo'],
      },
    })

    const caller = createTestCaller(user.id)

    await expect(
      caller.skills.createViaWeb({
        organisationId: org.id,
        name: 'orphan-skill',
        description: 'No repo configured',
        type: 'SKILL',
        content: '# Orphan',
      })
    ).rejects.toThrow(TRPCError)
  })

  it('throws when the caller has no GitHub connected account', async () => {
    const { org, user } = await createTestOrgWithOwner()

    await prisma.organisation.update({
      where: { id: org.id },
      data: {
        skillsRepoOwner: 'test-owner',
        skillsRepoName: 'test-repo',
        skillsRepoUrl: 'https://github.com/test-owner/test-repo',
      },
    })

    const caller = createTestCaller(user.id)

    await expect(
      caller.skills.createViaWeb({
        organisationId: org.id,
        name: 'no-token-skill',
        description: 'No GitHub token',
        type: 'SKILL',
        content: '# No Token',
      })
    ).rejects.toThrow(TRPCError)
  })
})

// ---------------------------------------------------------------------------
// getSkillContent
// ---------------------------------------------------------------------------

describe('skills.getSkillContent', () => {
  it('returns content from git on the happy path', async () => {
    const { org, user } = await createTestOrgWithOwner()
    const pkg = await createTestPackage(org.id, user.id)

    const caller = createTestCaller(user.id)

    const result = await caller.skills.getSkillContent({ packageId: pkg.id })

    // The mock resolves with '# Test Skill'
    expect(result.content).toBeDefined()
  })

  it('requires authentication', async () => {
    const caller = createUnauthenticatedCaller()

    await expect(caller.skills.getSkillContent({ packageId: 'any-id' })).rejects.toThrow(TRPCError)
  })
})

// ---------------------------------------------------------------------------
// saveSkillContent
// ---------------------------------------------------------------------------

describe('skills.saveSkillContent', () => {
  it('commits updated content and auto-increments the version', async () => {
    const { org, user } = await createTestOrgWithOwner()

    await prisma.organisation.update({
      where: { id: org.id },
      data: {
        skillsRepoOwner: 'test-owner',
        skillsRepoName: 'test-repo',
        skillsRepoUrl: 'https://github.com/test-owner/test-repo',
      },
    })

    await prisma.connectedAccount.create({
      data: {
        userId: user.id,
        provider: 'GITHUB',
        providerAccountId: 'gh-789',
        accessToken: 'test-token',
        scopes: ['repo'],
      },
    })

    const pkg = await createTestPackage(org.id, user.id)
    await createTestVersion(pkg.id, { version: '1.0.0' })

    const caller = createTestCaller(user.id)

    const result = await caller.skills.saveSkillContent({
      packageId: pkg.id,
      content: '# Updated content',
    })

    expect(result).toBeDefined()

    const versions = await prisma.packageVersion.findMany({
      where: { packageId: pkg.id },
      orderBy: { createdAt: 'desc' },
    })
    // Should have a new version beyond 1.0.0
    expect(versions.length).toBeGreaterThan(1)
  })

  it('throws when a non-author non-admin attempts to save', async () => {
    const { org, user } = await createTestOrgWithOwner()
    const member = await createTestUser()

    await prisma.organisationMember.create({
      data: { organisationId: org.id, userId: member.id, role: 'MEMBER' },
    })

    const pkg = await createTestPackage(org.id, user.id)
    const caller = createTestCaller(member.id)

    await expect(
      caller.skills.saveSkillContent({ packageId: pkg.id, content: '# Hijacked' })
    ).rejects.toThrow(TRPCError)
  })
})

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe('skills.update', () => {
  it('allows the author to update description and visibility', async () => {
    const { org, user } = await createTestOrgWithOwner()
    const pkg = await createTestPackage(org.id, user.id)

    const caller = createTestCaller(user.id)

    const result = await caller.skills.update({
      id: pkg.id,
      description: 'Updated description',
      visibility: 'PUBLIC',
    })

    expect(result.description).toBe('Updated description')
    expect(result.visibility).toBe('PUBLIC')
  })

  it('allows an org admin to update a skill they did not author', async () => {
    const { org, user: owner } = await createTestOrgWithOwner()
    const author = await createTestUser()

    await prisma.organisationMember.create({
      data: { organisationId: org.id, userId: author.id, role: 'MEMBER' },
    })

    const pkg = await createTestPackage(org.id, author.id)
    const caller = createTestCaller(owner.id)

    const result = await caller.skills.update({ id: pkg.id, description: 'Admin override' })

    expect(result.description).toBe('Admin override')
  })

  it(`throws FORBIDDEN when a regular member tries to update another author's skill`, async () => {
    const { org } = await createTestOrgWithOwner()
    const author = await createTestUser()
    const interloper = await createTestUser()

    await prisma.organisationMember.createMany({
      data: [
        { organisationId: org.id, userId: author.id, role: 'MEMBER' },
        { organisationId: org.id, userId: interloper.id, role: 'MEMBER' },
      ],
    })

    const pkg = await createTestPackage(org.id, author.id)
    const caller = createTestCaller(interloper.id)

    await expect(
      caller.skills.update({ id: pkg.id, description: 'Forbidden update' })
    ).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
  })

  it('requires authentication', async () => {
    const caller = createUnauthenticatedCaller()

    await expect(caller.skills.update({ id: 'any-id', description: 'nope' })).rejects.toThrow(
      TRPCError
    )
  })
})

// ---------------------------------------------------------------------------
// fork
// ---------------------------------------------------------------------------

describe('skills.fork', () => {
  it('copies the package to the target org and sets visibility to PRIVATE', async () => {
    const { org: sourceOrg, user: sourceUser } = await createTestOrgWithOwner()
    const { org: targetOrg, user: targetUser } = await createTestOrgWithOwner()

    const pkg = await createTestPackage(sourceOrg.id, sourceUser.id, { visibility: 'PUBLIC' })

    const caller = createTestCaller(targetUser.id)

    const forked = await caller.skills.fork({
      packageId: pkg.id,
      organisationId: targetOrg.id,
    })

    expect(forked.organisationId).toBe(targetOrg.id)
    expect(forked.visibility).toBe('PRIVATE')
    expect(forked.forkedFromId).toBe(pkg.id)
  })

  it('throws when the caller is not a member of the target org', async () => {
    const { org: sourceOrg, user: sourceUser } = await createTestOrgWithOwner()
    const { org: targetOrg } = await createTestOrgWithOwner()
    const outsider = await createTestUser()

    const pkg = await createTestPackage(sourceOrg.id, sourceUser.id, { visibility: 'PUBLIC' })

    const caller = createTestCaller(outsider.id)

    await expect(
      caller.skills.fork({ packageId: pkg.id, organisationId: targetOrg.id })
    ).rejects.toThrow(TRPCError)
  })

  it('creates a notification after a successful fork', async () => {
    const { org: sourceOrg, user: sourceUser } = await createTestOrgWithOwner()
    const { org: targetOrg, user: targetUser } = await createTestOrgWithOwner()

    const pkg = await createTestPackage(sourceOrg.id, sourceUser.id, { visibility: 'PUBLIC' })

    const caller = createTestCaller(targetUser.id)
    await caller.skills.fork({ packageId: pkg.id, organisationId: targetOrg.id })

    // createNotification is fire-and-forget in the router, so wait for it to complete
    await vi.waitFor(
      async () => {
        const notification = await prisma.notification.findFirst({
          where: { userId: sourceUser.id },
        })
        expect(notification).not.toBeNull()
      },
      { timeout: 2000 }
    )
  })

  it('requires authentication', async () => {
    const caller = createUnauthenticatedCaller()

    await expect(
      caller.skills.fork({ packageId: 'any-id', organisationId: 'any-org' })
    ).rejects.toThrow(TRPCError)
  })
})

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('skills.delete', () => {
  it('allows an org owner to delete a package', async () => {
    const { org, user } = await createTestOrgWithOwner()
    const pkg = await createTestPackage(org.id, user.id)

    const caller = createTestCaller(user.id)
    await caller.skills.delete({ id: pkg.id })

    const deleted = await prisma.package.findUnique({ where: { id: pkg.id } })
    expect(deleted).toBeNull()
  })

  it('allows an org admin to delete a package', async () => {
    const { org, user: owner } = await createTestOrgWithOwner()
    const admin = await createTestUser()

    await prisma.organisationMember.create({
      data: { organisationId: org.id, userId: admin.id, role: 'ADMIN' },
    })

    const pkg = await createTestPackage(org.id, owner.id)
    const caller = createTestCaller(admin.id)

    await caller.skills.delete({ id: pkg.id })

    const deleted = await prisma.package.findUnique({ where: { id: pkg.id } })
    expect(deleted).toBeNull()
  })

  it('throws FORBIDDEN when a regular member attempts to delete', async () => {
    const { org, user: owner } = await createTestOrgWithOwner()
    const member = await createTestUser()

    await prisma.organisationMember.create({
      data: { organisationId: org.id, userId: member.id, role: 'MEMBER' },
    })

    const pkg = await createTestPackage(org.id, owner.id)
    const caller = createTestCaller(member.id)

    await expect(caller.skills.delete({ id: pkg.id })).rejects.toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' })
    )
  })

  it('throws when the caller does not belong to the org', async () => {
    const { org, user } = await createTestOrgWithOwner()
    const outsider = await createTestUser()

    const pkg = await createTestPackage(org.id, user.id)
    const caller = createTestCaller(outsider.id)

    await expect(caller.skills.delete({ id: pkg.id })).rejects.toThrow(TRPCError)
  })

  it('requires authentication', async () => {
    const caller = createUnauthenticatedCaller()

    await expect(caller.skills.delete({ id: 'any-id' })).rejects.toThrow(TRPCError)
  })
})

// ---------------------------------------------------------------------------
// installationStats
// ---------------------------------------------------------------------------

describe('skills.installationStats', () => {
  it('returns installation reports for a package', async () => {
    const { org, user } = await createTestOrgWithOwner()
    const pkg = await createTestPackage(org.id, user.id)

    await prisma.installationReport.create({
      data: {
        packageId: pkg.id,
        userId: user.id,
        machineId: 'machine-1',
      },
    })

    const caller = createTestCaller(user.id)
    const result = await caller.skills.installationStats({ packageId: pkg.id })

    expect(result.reports.length).toBeGreaterThan(0)
  })

  it('returns an empty array when there are no install reports', async () => {
    const { org, user } = await createTestOrgWithOwner()
    const pkg = await createTestPackage(org.id, user.id)

    const caller = createTestCaller(user.id)
    const result = await caller.skills.installationStats({ packageId: pkg.id })

    expect(result.reports).toHaveLength(0)
  })

  it('requires authentication', async () => {
    const caller = createUnauthenticatedCaller()

    await expect(caller.skills.installationStats({ packageId: 'any-id' })).rejects.toThrow(
      TRPCError
    )
  })
})
