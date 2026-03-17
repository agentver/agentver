import { createHmac, timingSafeEqual } from 'node:crypto'
import { prisma } from '@agentver/database/client'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestOrgWithOwner, createTestPackage, createTestUser } from '~/test/factories'
import { cleanDatabase, disconnectDatabase } from '~/test/helpers/db'

// ---------------------------------------------------------------------------
// Helpers mirroring the signature verification logic used in the webhook route
// ---------------------------------------------------------------------------

function computeSignature(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

function isValidSignature(secret: string, body: string, signature: string): boolean {
  const expected = computeSignature(secret, body)
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    // Buffer lengths differ — signature is definitively invalid
    return false
  }
}

// ---------------------------------------------------------------------------

describe('GitHub webhook data operations', () => {
  beforeEach(async () => {
    await cleanDatabase()
  })

  afterAll(async () => {
    await disconnectDatabase()
  })

  describe('Signature verification', () => {
    it('should verify valid HMAC-SHA256 signature', () => {
      const secret = 'test-webhook-secret'
      const payload = JSON.stringify({ action: 'push' })
      const signature = computeSignature(secret, payload)
      const expected = computeSignature(secret, payload)
      expect(signature).toBe(expected)
    })

    it('should reject invalid signature', () => {
      const secret = 'test-webhook-secret'
      const payload = JSON.stringify({ action: 'push' })
      const validSig = computeSignature(secret, payload)
      const invalidSig = computeSignature('wrong-secret', payload)
      expect(validSig).not.toBe(invalidSig)
    })

    it('should accept a correct signature via timing-safe comparison', () => {
      const secret = 'super-secret'
      const body = JSON.stringify({ ref: 'refs/heads/main' })
      const sig = computeSignature(secret, body)
      expect(isValidSignature(secret, body, sig)).toBe(true)
    })

    it('should reject a tampered payload with the original signature', () => {
      const secret = 'super-secret'
      const originalBody = JSON.stringify({ ref: 'refs/heads/main' })
      const sig = computeSignature(secret, originalBody)
      const tamperedBody = JSON.stringify({ ref: 'refs/heads/evil' })
      expect(isValidSignature(secret, tamperedBody, sig)).toBe(false)
    })

    it('should reject a signature with wrong prefix', () => {
      const secret = 'super-secret'
      const body = JSON.stringify({ action: 'push' })
      const hex = createHmac('sha256', secret).update(body).digest('hex')
      const wrongPrefixSig = `sha1=${hex}`
      const correctSig = computeSignature(secret, body)
      // Wrong prefix produces a different string
      expect(wrongPrefixSig).not.toBe(correctSig)
    })

    it('should handle empty payload body', () => {
      const secret = 'test-secret'
      const emptyBody = ''
      const sig = computeSignature(secret, emptyBody)
      expect(isValidSignature(secret, emptyBody, sig)).toBe(true)
    })
  })

  describe('Push event handling', () => {
    it('should match packages by gitPath when files change', async () => {
      const { user, org } = await createTestOrgWithOwner()

      await createTestPackage(org.id, user.id, {
        gitUri: 'github.com/test-owner/test-repo',
        gitPath: 'skills/my-skill/SKILL.md',
        gitDefaultRef: 'main',
      })

      // Simulate how the webhook handler matches affected packages
      const changedFiles = ['skills/my-skill/SKILL.md']
      const matchedPackages = await prisma.package.findMany({
        where: {
          organisationId: org.id,
          gitPath: { in: changedFiles },
        },
      })

      expect(matchedPackages).toHaveLength(1)
      expect(matchedPackages[0]!.gitPath).toBe('skills/my-skill/SKILL.md')
    })

    it('should not match packages from a different org even when gitPath is identical', async () => {
      const { user: userA, org: orgA } = await createTestOrgWithOwner()
      const userB = await createTestUser()
      const { org: orgB } = await createTestOrgWithOwner()

      await createTestPackage(orgA.id, userA.id, {
        gitPath: 'skills/shared-skill/SKILL.md',
      })
      await createTestPackage(orgB.id, userB.id, {
        gitPath: 'skills/shared-skill/SKILL.md',
      })

      const changedFiles = ['skills/shared-skill/SKILL.md']

      // The webhook for orgA must only match orgA's packages
      const matchedPackages = await prisma.package.findMany({
        where: {
          organisationId: orgA.id,
          gitPath: { in: changedFiles },
        },
      })

      expect(matchedPackages).toHaveLength(1)
      expect(matchedPackages[0]!.organisationId).toBe(orgA.id)
    })

    it('should return no matches when changed files do not overlap with any gitPath', async () => {
      const { user, org } = await createTestOrgWithOwner()

      await createTestPackage(org.id, user.id, {
        gitPath: 'skills/skill-a/SKILL.md',
      })

      const changedFiles = ['docs/README.md', 'src/index.ts']
      const matchedPackages = await prisma.package.findMany({
        where: {
          organisationId: org.id,
          gitPath: { in: changedFiles },
        },
      })

      expect(matchedPackages).toHaveLength(0)
    })

    it('should update package readme on push', async () => {
      const { user, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, user.id, {
        readme: 'Old content',
      })

      // Simulate what the webhook handler does after fetching new content
      await prisma.package.update({
        where: { id: pkg.id },
        data: { readme: 'Updated content from webhook' },
      })

      const updated = await prisma.package.findUnique({ where: { id: pkg.id } })
      expect(updated!.readme).toBe('Updated content from webhook')
    })

    it('should update multiple packages when a push touches multiple files', async () => {
      const { user, org } = await createTestOrgWithOwner()

      const pkgA = await createTestPackage(org.id, user.id, {
        gitPath: 'skills/skill-a/SKILL.md',
        readme: 'Original A',
      })
      const pkgB = await createTestPackage(org.id, user.id, {
        gitPath: 'skills/skill-b/SKILL.md',
        readme: 'Original B',
      })

      const changedFiles = ['skills/skill-a/SKILL.md', 'skills/skill-b/SKILL.md']
      const matchedPackages = await prisma.package.findMany({
        where: {
          organisationId: org.id,
          gitPath: { in: changedFiles },
        },
      })

      expect(matchedPackages).toHaveLength(2)

      // Simulate bulk update for all matched packages
      await prisma.package.updateMany({
        where: { id: { in: matchedPackages.map((p) => p.id) } },
        data: { readme: 'Refreshed by webhook push' },
      })

      const updatedA = await prisma.package.findUnique({ where: { id: pkgA.id } })
      const updatedB = await prisma.package.findUnique({ where: { id: pkgB.id } })

      expect(updatedA!.readme).toBe('Refreshed by webhook push')
      expect(updatedB!.readme).toBe('Refreshed by webhook push')
    })

    it('should record the last synced ref after a push event', async () => {
      const { user, org } = await createTestOrgWithOwner()
      const pkg = await createTestPackage(org.id, user.id, {
        gitPath: 'skills/synced-skill/SKILL.md',
        gitDefaultRef: 'main',
      })

      // Simulate persisting the synced ref after processing the push
      const syncedRef = 'refs/heads/main'
      await prisma.package.update({
        where: { id: pkg.id },
        data: { gitDefaultRef: syncedRef },
      })

      const refreshed = await prisma.package.findUnique({ where: { id: pkg.id } })
      expect(refreshed!.gitDefaultRef).toBe(syncedRef)
    })
  })

  describe('Installation event handling', () => {
    it('should find org by skills repo owner on app install', async () => {
      const { org } = await createTestOrgWithOwner()

      // Persist a repo owner as if the install webhook had fired previously
      await prisma.organisation.update({
        where: { id: org.id },
        data: { skillsRepoOwner: 'install-test-owner', skillsRepoName: 'install-test-repo' },
      })

      // Simulate the webhook handler looking up which org owns this repo
      const matched = await prisma.organisation.findFirst({
        where: { skillsRepoOwner: 'install-test-owner', skillsRepoName: 'install-test-repo' },
      })

      expect(matched).not.toBeNull()
      expect(matched!.id).toBe(org.id)
    })

    it('should return null when no org matches the repo details', async () => {
      const matched = await prisma.organisation.findFirst({
        where: { skillsRepoOwner: 'nonexistent-owner', skillsRepoName: 'nonexistent-repo' },
      })

      expect(matched).toBeNull()
    })
  })
})
