import { prisma } from '@agentver/database/client'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestOrgWithOwner } from '~/test/factories'
import { cleanDatabase, disconnectDatabase } from '~/test/helpers/db'

describe('Skills Repo API data layer', () => {
  beforeEach(async () => {
    await cleanDatabase()
  })

  afterAll(async () => {
    await disconnectDatabase()
  })

  describe('GET /api/v1/org/:orgId/skills-repo', () => {
    it('should return skills repo status when connected', async () => {
      const { org } = await createTestOrgWithOwner()

      // Simulate what the route does: update org with repo details then fetch
      await prisma.organisation.update({
        where: { id: org.id },
        data: {
          skillsRepoUrl: 'https://github.com/test-owner/skills-repo',
          skillsRepoOwner: 'test-owner',
          skillsRepoName: 'skills-repo',
          skillsRepoProvider: 'github',
        },
      })

      const result = await prisma.organisation.findUnique({
        where: { id: org.id },
        select: {
          skillsRepoUrl: true,
          skillsRepoOwner: true,
          skillsRepoName: true,
          skillsRepoProvider: true,
        },
      })

      // Verify the shape matches what the GET route would return
      expect(result).not.toBeNull()
      expect(result!.skillsRepoUrl).toBe('https://github.com/test-owner/skills-repo')
      expect(result!.skillsRepoOwner).toBe('test-owner')
      expect(result!.skillsRepoName).toBe('skills-repo')
      expect(result!.skillsRepoProvider).toBe('github')
    })

    it('should return not-connected status when no repo', async () => {
      const { org } = await createTestOrgWithOwner()

      const result = await prisma.organisation.findUnique({
        where: { id: org.id },
        select: {
          skillsRepoUrl: true,
          skillsRepoOwner: true,
          skillsRepoName: true,
          skillsRepoProvider: true,
        },
      })

      // Verify the empty state — all repo fields should be null by default (except provider has a default)
      expect(result).not.toBeNull()
      expect(result!.skillsRepoUrl).toBeNull()
      expect(result!.skillsRepoOwner).toBeNull()
      expect(result!.skillsRepoName).toBeNull()
    })
  })

  describe('PUT /api/v1/org/:orgId/skills-repo', () => {
    it('should store repo details on connect', async () => {
      const { org } = await createTestOrgWithOwner()

      // Simulate what the PUT route does: persist all repo connection fields
      const updated = await prisma.organisation.update({
        where: { id: org.id },
        data: {
          skillsRepoUrl: 'https://github.com/acme/agent-skills',
          skillsRepoOwner: 'acme',
          skillsRepoName: 'agent-skills',
          skillsRepoProvider: 'github',
        },
      })

      expect(updated.skillsRepoUrl).toBe('https://github.com/acme/agent-skills')
      expect(updated.skillsRepoOwner).toBe('acme')
      expect(updated.skillsRepoName).toBe('agent-skills')
      expect(updated.skillsRepoProvider).toBe('github')
    })

    it('should overwrite existing repo details when reconnecting', async () => {
      const { org } = await createTestOrgWithOwner()

      // Connect an initial repo
      await prisma.organisation.update({
        where: { id: org.id },
        data: {
          skillsRepoUrl: 'https://github.com/acme/old-repo',
          skillsRepoOwner: 'acme',
          skillsRepoName: 'old-repo',
          skillsRepoProvider: 'github',
        },
      })

      // Reconnect with new details (simulates PUT with different repo)
      const updated = await prisma.organisation.update({
        where: { id: org.id },
        data: {
          skillsRepoUrl: 'https://github.com/acme/new-repo',
          skillsRepoOwner: 'acme',
          skillsRepoName: 'new-repo',
          skillsRepoProvider: 'github',
        },
      })

      expect(updated.skillsRepoUrl).toBe('https://github.com/acme/new-repo')
      expect(updated.skillsRepoName).toBe('new-repo')
    })
  })

  describe('DELETE /api/v1/org/:orgId/skills-repo', () => {
    it('should clear all repo fields on disconnect', async () => {
      const { org } = await createTestOrgWithOwner()

      // First connect a repo
      await prisma.organisation.update({
        where: { id: org.id },
        data: {
          skillsRepoUrl: 'https://github.com/acme/skills-repo',
          skillsRepoOwner: 'acme',
          skillsRepoName: 'skills-repo',
          skillsRepoProvider: 'github',
        },
      })

      // Simulate DELETE: null all repo fields
      const disconnected = await prisma.organisation.update({
        where: { id: org.id },
        data: {
          skillsRepoUrl: null,
          skillsRepoOwner: null,
          skillsRepoName: null,
          skillsRepoProvider: null,
        },
      })

      expect(disconnected.skillsRepoUrl).toBeNull()
      expect(disconnected.skillsRepoOwner).toBeNull()
      expect(disconnected.skillsRepoName).toBeNull()
    })

    it('should be idempotent when disconnecting an already-disconnected repo', async () => {
      const { org } = await createTestOrgWithOwner()

      // Org has no repo connected — null all fields again (idempotent)
      const result = await prisma.organisation.update({
        where: { id: org.id },
        data: {
          skillsRepoUrl: null,
          skillsRepoOwner: null,
          skillsRepoName: null,
          skillsRepoProvider: null,
        },
      })

      expect(result.skillsRepoUrl).toBeNull()
      expect(result.skillsRepoOwner).toBeNull()
      expect(result.skillsRepoName).toBeNull()
    })
  })
})
