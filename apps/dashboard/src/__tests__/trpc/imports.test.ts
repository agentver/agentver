import { prisma } from '@agentver/database/client'
import { TRPCError } from '@trpc/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestOrgWithOwner, createTestPackage } from '~/test/factories'
import { cleanDatabase, disconnectDatabase } from '~/test/helpers/db'
import { createTestCaller } from '~/test/helpers/trpc'

vi.mock('@/lib/import/github', () => ({
  scanRepoForSkills: vi.fn().mockResolvedValue([
    {
      path: 'skills/test/SKILL.md',
      name: 'SKILL.md',
      type: 'skill',
      detectedType: 'SKILL',
      agentId: 'claude-code',
      downloadUrl: 'https://raw.githubusercontent.com/test',
      preview: '# Test',
    },
  ]),
  fetchFileContent: vi.fn().mockResolvedValue('# Test Skill Content'),
  getRepoDefaultBranch: vi.fn().mockResolvedValue('main'),
}))

vi.mock('@/lib/import/github-webhook', () => ({
  registerWebhook: vi.fn().mockResolvedValue({ webhookId: 12345 }),
  deleteWebhook: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/import/gitlab', () => ({
  scanGitLabRepo: vi.fn().mockResolvedValue([
    {
      path: 'skills/test/SKILL.md',
      name: 'SKILL.md',
      type: 'skill',
      detectedType: 'SKILL',
      agentId: 'claude-code',
      projectId: 1,
      ref: 'main',
      preview: '# Test',
    },
  ]),
  fetchGitLabFileContent: vi.fn().mockResolvedValue('# GitLab Skill'),
}))

vi.mock('@/lib/import/bitbucket', () => ({
  scanBitbucketRepo: vi.fn().mockResolvedValue([
    {
      path: 'skills/test/SKILL.md',
      name: 'SKILL.md',
      type: 'skill',
      detectedType: 'SKILL',
      agentId: 'claude-code',
      downloadUrl: 'https://api.bitbucket.org/test',
      preview: '# Test',
    },
  ]),
  fetchBitbucketFileContent: vi.fn().mockResolvedValue('# Bitbucket Skill'),
  listBitbucketRepos: vi
    .fn()
    .mockResolvedValue([
      { workspace: 'acme', slug: 'skills', name: 'Skills', defaultBranch: 'main' },
    ]),
}))

vi.mock('@/lib/import/google-drive', () => ({
  scanGoogleDriveFolder: vi.fn().mockResolvedValue({
    files: [
      {
        path: 'test-skill.md',
        name: 'test-skill.md',
        type: 'skill',
        detectedType: 'SKILL',
        fileId: 'drive-file-1',
        preview: '# Drive Skill',
      },
    ],
    skippedPaths: [],
  }),
  fetchGoogleDriveFileContent: vi.fn().mockResolvedValue('# Drive Skill Content'),
  listGoogleDriveFiles: vi.fn().mockResolvedValue([]),
  refreshGoogleToken: vi.fn().mockResolvedValue({
    accessToken: 'new-google-token',
    expiresAt: new Date(Date.now() + 3600 * 1000),
  }),
}))

vi.mock('@/lib/import/onedrive', () => ({
  scanOneDriveFolder: vi.fn().mockResolvedValue({
    files: [
      {
        path: 'test-skill.md',
        name: 'test-skill.md',
        type: 'skill',
        detectedType: 'SKILL',
        itemId: 'od-item-1',
        preview: '# OneDrive Skill',
      },
    ],
    skippedPaths: [],
  }),
  fetchOneDriveFileContent: vi.fn().mockResolvedValue('# OneDrive Skill Content'),
  listOneDriveFiles: vi.fn().mockResolvedValue([]),
  refreshMicrosoftToken: vi.fn().mockResolvedValue({
    accessToken: 'new-ms-token',
    expiresAt: new Date(Date.now() + 3600 * 1000),
  }),
}))

vi.mock('@/lib/import/shared', () => ({
  commitImportedFiles: vi.fn().mockResolvedValue({
    commitSha: 'abc123',
    branch: 'main',
    packageId: 'pkg-1',
    versionId: 'ver-1',
    filesCommitted: 1,
  }),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupGitHubAccount(userId: string) {
  return prisma.connectedAccount.create({
    data: {
      userId,
      provider: 'GITHUB',
      providerAccountId: 'gh-123',
      accessToken: 'test-token',
      scopes: ['repo'],
    },
  })
}

async function setupBitbucketAccount(userId: string) {
  return prisma.connectedAccount.create({
    data: {
      userId,
      provider: 'BITBUCKET',
      providerAccountId: 'bb-123',
      accessToken: 'test-token',
      scopes: ['repository'],
    },
  })
}

async function setupGoogleDriveAccount(userId: string) {
  return prisma.connectedAccount.create({
    data: {
      userId,
      provider: 'GOOGLE',
      providerAccountId: 'google-123',
      accessToken: 'test-token',
      refreshToken: 'test-refresh-token',
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    },
  })
}

async function setupOneDriveAccount(userId: string) {
  return prisma.connectedAccount.create({
    data: {
      userId,
      provider: 'MICROSOFT',
      providerAccountId: 'ms-123',
      accessToken: 'test-token',
      refreshToken: 'test-ms-refresh-token',
      scopes: ['Files.Read'],
    },
  })
}

async function setupOrgWithSkillsRepo(orgId: string) {
  return prisma.organisation.update({
    where: { id: orgId },
    data: {
      skillsRepoOwner: 'test-owner',
      skillsRepoName: 'test-repo',
      skillsRepoUrl: 'https://github.com/test-owner/test-repo',
    },
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('imports router', () => {
  beforeEach(async () => {
    await cleanDatabase()
    vi.clearAllMocks()
  })

  afterAll(async () => {
    await disconnectDatabase()
  })

  // -------------------------------------------------------------------------
  // GitHub
  // -------------------------------------------------------------------------

  describe('scanGitHub', () => {
    it('returns scanned files for a connected GitHub account', async () => {
      const { user } = await createTestOrgWithOwner()
      await setupGitHubAccount(user.id)

      const caller = createTestCaller(user.id)
      const result = await caller.imports.scanGitHub({
        repoOwner: 'acme',
        repoName: 'skills',
      })

      expect(result).toHaveProperty('repo')
      expect(result).toHaveProperty('files')
      expect(result.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'skills/test/SKILL.md',
            detectedType: 'SKILL',
            agentId: 'claude-code',
          }),
        ])
      )
    })

    it('accepts a repoUrl instead of owner+name', async () => {
      const { user } = await createTestOrgWithOwner()
      await setupGitHubAccount(user.id)

      const caller = createTestCaller(user.id)
      const result = await caller.imports.scanGitHub({
        repoUrl: 'https://github.com/acme/skills',
      })

      expect(result).toHaveProperty('repo')
      expect(Array.isArray(result.files)).toBe(true)
    })

    it('throws PRECONDITION_FAILED when no GitHub account is connected', async () => {
      const { user } = await createTestOrgWithOwner()

      const caller = createTestCaller(user.id)

      await expect(
        caller.imports.scanGitHub({
          repoOwner: 'acme',
          repoName: 'skills',
        })
      ).rejects.toThrow(TRPCError)
    })
  })

  describe('importFromGitHub — COPY mode', () => {
    it('commits files to the skills repo and returns results with syncStatus not_requested', async () => {
      const { user, org } = await createTestOrgWithOwner()
      await setupGitHubAccount(user.id)
      await setupOrgWithSkillsRepo(org.id)

      const caller = createTestCaller(user.id)
      const result = await caller.imports.importFromGitHub({
        repo: 'acme/skills',
        organisationId: org.id,
        adoptionMode: 'COPY',
        files: [
          {
            path: 'skills/test/SKILL.md',
            name: 'SKILL.md',
            type: 'skill',
            detectedType: 'SKILL',
            agentId: 'claude-code',
            downloadUrl: 'https://raw.githubusercontent.com/test',
          },
        ],
      })

      expect(result).toHaveProperty('imported')
      expect(result).toHaveProperty('errors')
      expect(result.syncStatus).toBe('not_requested')
    })

    it('throws when the organisation has no skills repo configured', async () => {
      const { user, org } = await createTestOrgWithOwner()
      await setupGitHubAccount(user.id)
      // Deliberately skip setupOrgWithSkillsRepo

      const caller = createTestCaller(user.id)

      await expect(
        caller.imports.importFromGitHub({
          repo: 'acme/skills',
          organisationId: org.id,
          adoptionMode: 'COPY',
          files: [
            {
              path: 'skills/test/SKILL.md',
              name: 'SKILL.md',
              type: 'skill',
              detectedType: 'SKILL',
              agentId: 'claude-code',
              downloadUrl: 'https://raw.githubusercontent.com/test',
            },
          ],
        })
      ).rejects.toThrow(TRPCError)
    })
  })

  describe('importFromGitHub — LINK mode', () => {
    it('creates a DB reference only without committing files', async () => {
      const { commitImportedFiles } = await import('@/lib/import/shared')
      const { user, org } = await createTestOrgWithOwner()
      await setupGitHubAccount(user.id)

      const caller = createTestCaller(user.id)
      await caller.imports.importFromGitHub({
        repo: 'acme/skills',
        organisationId: org.id,
        adoptionMode: 'LINK',
        files: [
          {
            path: 'skills/test/SKILL.md',
            name: 'SKILL.md',
            type: 'skill',
            detectedType: 'SKILL',
            agentId: 'claude-code',
            downloadUrl: 'https://raw.githubusercontent.com/test',
          },
        ],
      })

      // LINK mode must not perform a git commit
      expect(commitImportedFiles).not.toHaveBeenCalled()
    })
  })

  describe('importFromGitHub — MIRROR mode', () => {
    it('registers a webhook and returns syncStatus active', async () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://example.com'
      const { registerWebhook } = await import('@/lib/import/github-webhook')
      const { commitImportedFiles } = await import('@/lib/import/shared')
      const { user, org } = await createTestOrgWithOwner()
      await setupGitHubAccount(user.id)
      await setupOrgWithSkillsRepo(org.id)

      // Create a real package so the MIRROR mode prisma.package.update succeeds
      const pkg = await createTestPackage(org.id, user.id)
      vi.mocked(commitImportedFiles).mockResolvedValueOnce({
        commitSha: 'abc123',
        branch: 'main',
        packageId: pkg.id,
        versionId: 'ver-1',
        filesCommitted: 1,
      })

      const caller = createTestCaller(user.id)
      const result = await caller.imports.importFromGitHub({
        repo: 'acme/skills',
        organisationId: org.id,
        adoptionMode: 'MIRROR',
        files: [
          {
            path: 'skills/test/SKILL.md',
            name: 'SKILL.md',
            type: 'skill',
            detectedType: 'SKILL',
            agentId: 'claude-code',
            downloadUrl: 'https://raw.githubusercontent.com/test',
          },
        ],
      })

      expect(registerWebhook).toHaveBeenCalled()
      expect(result.syncStatus).toBe('active')
      delete process.env.NEXT_PUBLIC_APP_URL
    })

    it('returns syncStatus failed when webhook registration throws', async () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://example.com'
      const { registerWebhook } = await import('@/lib/import/github-webhook')
      const { commitImportedFiles } = await import('@/lib/import/shared')
      vi.mocked(registerWebhook).mockRejectedValueOnce(new Error('GitHub API rate limit'))

      const { user, org } = await createTestOrgWithOwner()
      await setupGitHubAccount(user.id)
      await setupOrgWithSkillsRepo(org.id)

      const pkg = await createTestPackage(org.id, user.id)
      vi.mocked(commitImportedFiles).mockResolvedValueOnce({
        commitSha: 'abc123',
        branch: 'main',
        packageId: pkg.id,
        versionId: 'ver-1',
        filesCommitted: 1,
      })

      const caller = createTestCaller(user.id)
      const result = await caller.imports.importFromGitHub({
        repo: 'acme/skills',
        organisationId: org.id,
        adoptionMode: 'MIRROR',
        files: [
          {
            path: 'skills/test/SKILL.md',
            name: 'SKILL.md',
            type: 'skill',
            detectedType: 'SKILL',
            agentId: 'claude-code',
            downloadUrl: 'https://raw.githubusercontent.com/test',
          },
        ],
      })

      expect(result.syncStatus).toBe('failed')
      expect(result.imported.length).toBeGreaterThan(0)
      delete process.env.NEXT_PUBLIC_APP_URL
    })
  })

  describe('enableGitHubSync', () => {
    it('registers a webhook for the repository', async () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://example.com'
      const { registerWebhook } = await import('@/lib/import/github-webhook')
      const { user } = await createTestOrgWithOwner()
      await setupGitHubAccount(user.id)

      const caller = createTestCaller(user.id)
      await caller.imports.enableGitHubSync({ repoOwner: 'test-owner', repoName: 'test-repo' })

      expect(registerWebhook).toHaveBeenCalled()
      delete process.env.NEXT_PUBLIC_APP_URL
    })

    it('throws PRECONDITION_FAILED when no GitHub account is connected', async () => {
      const { user } = await createTestOrgWithOwner()

      const caller = createTestCaller(user.id)

      await expect(
        caller.imports.enableGitHubSync({ repoOwner: 'owner', repoName: 'repo' })
      ).rejects.toThrow(TRPCError)
    })
  })

  describe('disableGitHubSync', () => {
    it('deregisters the webhook for the repository', async () => {
      const { deleteWebhook } = await import('@/lib/import/github-webhook')
      const { user } = await createTestOrgWithOwner()
      const account = await setupGitHubAccount(user.id)

      // Store webhook metadata so disableGitHubSync can find the webhookId
      await prisma.connectedAccount.update({
        where: { id: account.id },
        data: {
          metadata: {
            repos: [
              { owner: 'test-owner', name: 'test-repo', webhookId: 12345, syncEnabled: true },
            ],
          },
        },
      })

      const caller = createTestCaller(user.id)
      await caller.imports.disableGitHubSync({ repoOwner: 'test-owner', repoName: 'test-repo' })

      expect(deleteWebhook).toHaveBeenCalled()
    })

    it('throws PRECONDITION_FAILED when no GitHub account is connected', async () => {
      const { user } = await createTestOrgWithOwner()

      const caller = createTestCaller(user.id)

      await expect(
        caller.imports.disableGitHubSync({ repoOwner: 'owner', repoName: 'repo' })
      ).rejects.toThrow(TRPCError)
    })
  })

  // -------------------------------------------------------------------------
  // Bitbucket
  // -------------------------------------------------------------------------

  describe('scanBitbucket', () => {
    it('returns scanned files for a connected Bitbucket account', async () => {
      const { user } = await createTestOrgWithOwner()
      await setupBitbucketAccount(user.id)

      const caller = createTestCaller(user.id)
      const result = await caller.imports.scanBitbucket({
        workspace: 'acme',
        repoSlug: 'skills',
      })

      expect(result).toHaveProperty('files')
      expect(result.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'skills/test/SKILL.md',
            detectedType: 'SKILL',
          }),
        ])
      )
    })

    it('throws PRECONDITION_FAILED when no Bitbucket account is connected', async () => {
      const { user } = await createTestOrgWithOwner()

      const caller = createTestCaller(user.id)

      await expect(
        caller.imports.scanBitbucket({
          workspace: 'acme',
          repoSlug: 'skills',
        })
      ).rejects.toThrow(TRPCError)
    })
  })

  describe('importFromBitbucket', () => {
    it('commits files in COPY mode', async () => {
      const { commitImportedFiles } = await import('@/lib/import/shared')
      const { user, org } = await createTestOrgWithOwner()
      await setupBitbucketAccount(user.id)
      await setupOrgWithSkillsRepo(org.id)

      const caller = createTestCaller(user.id)
      const result = await caller.imports.importFromBitbucket({
        repo: 'acme/skills',
        workspace: 'acme',
        repoSlug: 'skills',
        mainBranch: 'main',
        organisationId: org.id,
        adoptionMode: 'COPY',
        files: [
          {
            path: 'skills/test/SKILL.md',
            name: 'SKILL.md',
            type: 'skill',
            detectedType: 'SKILL',
            agentId: 'claude-code',
            downloadUrl: 'https://api.bitbucket.org/test',
          },
        ],
      })

      expect(commitImportedFiles).toHaveBeenCalled()
      expect(result).toHaveProperty('imported')
    })

    it('throws when the organisation has no skills repo configured', async () => {
      const { user, org } = await createTestOrgWithOwner()
      await setupBitbucketAccount(user.id)

      const caller = createTestCaller(user.id)

      await expect(
        caller.imports.importFromBitbucket({
          repo: 'acme/skills',
          workspace: 'acme',
          repoSlug: 'skills',
          mainBranch: 'main',
          organisationId: org.id,
          adoptionMode: 'COPY',
          files: [
            {
              path: 'skills/test/SKILL.md',
              name: 'SKILL.md',
              type: 'skill',
              detectedType: 'SKILL',
              agentId: 'claude-code',
              downloadUrl: 'https://api.bitbucket.org/test',
            },
          ],
        })
      ).rejects.toThrow(TRPCError)
    })
  })

  // -------------------------------------------------------------------------
  // Google Drive
  // -------------------------------------------------------------------------

  describe('scanGoogleDrive', () => {
    it('returns scanned files for a connected Google account', async () => {
      const { user } = await createTestOrgWithOwner()
      await setupGoogleDriveAccount(user.id)

      const caller = createTestCaller(user.id)
      const result = await caller.imports.scanGoogleDrive({
        folderId: 'root',
      })

      expect(result).toHaveProperty('files')
      expect(result.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'test-skill.md',
            detectedType: 'SKILL',
            fileId: 'drive-file-1',
          }),
        ])
      )
    })

    it('refreshes the token before scanning', async () => {
      const { refreshGoogleToken } = await import('@/lib/import/google-drive')
      const { user } = await createTestOrgWithOwner()
      await setupGoogleDriveAccount(user.id)

      const caller = createTestCaller(user.id)
      await caller.imports.scanGoogleDrive({ folderId: 'root' })

      expect(refreshGoogleToken).toHaveBeenCalled()
    })

    it('throws PRECONDITION_FAILED when no Google account is connected', async () => {
      const { user } = await createTestOrgWithOwner()

      const caller = createTestCaller(user.id)

      await expect(caller.imports.scanGoogleDrive({ folderId: 'root' })).rejects.toThrow(TRPCError)
    })
  })

  describe('importFromGoogleDrive', () => {
    it('downloads files and commits them to the skills repo', async () => {
      const { commitImportedFiles } = await import('@/lib/import/shared')
      const { user, org } = await createTestOrgWithOwner()
      await setupGoogleDriveAccount(user.id)
      await setupOrgWithSkillsRepo(org.id)

      const caller = createTestCaller(user.id)
      const result = await caller.imports.importFromGoogleDrive({
        folderId: 'root',
        organisationId: org.id,
        files: [
          {
            path: 'test-skill.md',
            name: 'test-skill.md',
            type: 'skill',
            detectedType: 'SKILL',
            agentId: 'claude-code',
            fileId: 'drive-file-1',
          },
        ],
      })

      expect(commitImportedFiles).toHaveBeenCalled()
      expect(result).toHaveProperty('imported')
    })

    it('throws when the organisation has no skills repo configured', async () => {
      const { user, org } = await createTestOrgWithOwner()
      await setupGoogleDriveAccount(user.id)

      const caller = createTestCaller(user.id)

      await expect(
        caller.imports.importFromGoogleDrive({
          folderId: 'root',
          organisationId: org.id,
          files: [
            {
              path: 'test-skill.md',
              name: 'test-skill.md',
              type: 'skill',
              detectedType: 'SKILL',
              agentId: 'claude-code',
              fileId: 'drive-file-1',
            },
          ],
        })
      ).rejects.toThrow(TRPCError)
    })
  })

  // -------------------------------------------------------------------------
  // OneDrive
  // -------------------------------------------------------------------------

  describe('scanOneDrive', () => {
    it('returns scanned files for a connected Microsoft account', async () => {
      const { user } = await createTestOrgWithOwner()
      await setupOneDriveAccount(user.id)

      const caller = createTestCaller(user.id)
      const result = await caller.imports.scanOneDrive({
        folderId: 'root',
      })

      expect(result).toHaveProperty('files')
      expect(result.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'test-skill.md',
            detectedType: 'SKILL',
            itemId: 'od-item-1',
          }),
        ])
      )
    })

    it('refreshes the token before scanning', async () => {
      const { refreshMicrosoftToken } = await import('@/lib/import/onedrive')
      const { user } = await createTestOrgWithOwner()
      await setupOneDriveAccount(user.id)

      const caller = createTestCaller(user.id)
      await caller.imports.scanOneDrive({ folderId: 'root' })

      expect(refreshMicrosoftToken).toHaveBeenCalled()
    })

    it('throws PRECONDITION_FAILED when no Microsoft account is connected', async () => {
      const { user } = await createTestOrgWithOwner()

      const caller = createTestCaller(user.id)

      await expect(caller.imports.scanOneDrive({ folderId: 'root' })).rejects.toThrow(TRPCError)
    })
  })

  describe('importFromOneDrive', () => {
    it('downloads files and commits them to the skills repo', async () => {
      const { commitImportedFiles } = await import('@/lib/import/shared')
      const { user, org } = await createTestOrgWithOwner()
      await setupOneDriveAccount(user.id)
      await setupOrgWithSkillsRepo(org.id)

      const caller = createTestCaller(user.id)
      const result = await caller.imports.importFromOneDrive({
        folderId: 'root',
        organisationId: org.id,
        files: [
          {
            path: 'test-skill.md',
            name: 'test-skill.md',
            type: 'skill',
            detectedType: 'SKILL',
            agentId: 'claude-code',
            itemId: 'od-item-1',
          },
        ],
      })

      expect(commitImportedFiles).toHaveBeenCalled()
      expect(result).toHaveProperty('imported')
    })

    it('throws when the organisation has no skills repo configured', async () => {
      const { user, org } = await createTestOrgWithOwner()
      await setupOneDriveAccount(user.id)

      const caller = createTestCaller(user.id)

      await expect(
        caller.imports.importFromOneDrive({
          folderId: 'root',
          organisationId: org.id,
          files: [
            {
              path: 'test-skill.md',
              name: 'test-skill.md',
              type: 'skill',
              detectedType: 'SKILL',
              agentId: 'claude-code',
              itemId: 'od-item-1',
            },
          ],
        })
      ).rejects.toThrow(TRPCError)
    })
  })
})
