import { type Prisma, prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { logAudit } from '@/lib/audit/logger'
import { GitProviderConfigError, getGitProvider } from '@/lib/git'
import { commitFiles, getDefaultBranch } from '@/lib/github/skills-repo'
import { getGitHubToken } from '@/lib/github/token'
import { fetchGitHubUpstreamContent } from '@/lib/sources/upstream'
import { protectedProcedure, router } from '../init'

const logger = createLogger('forks-router')

/**
 * Extract owner and repo from a gitUri like "github.com/owner/repo".
 */
function parseGitHubRepoFromUri(gitUri: string): { owner: string; repo: string } | null {
  const stripped = gitUri.replace(/^https?:\/\//, '').replace(/^github\.com\//, '')
  const parts = stripped.split('/')
  if (!parts[0] || !parts[1]) return null
  return { owner: parts[0], repo: parts[1] }
}

export const forksRouter = router({
  /**
   * Check whether the upstream (parent) package has new versions
   * since the fork was created or last synced.
   */
  checkUpstreamUpdates: protectedProcedure
    .input(z.object({ packageId: z.string() }))
    .query(async ({ ctx, input }) => {
      const pkg = await prisma.package.findUnique({
        where: { id: input.packageId },
        include: {
          organisation: {
            include: {
              members: { where: { userId: ctx.user.id }, select: { id: true } },
            },
          },
          forkedFrom: {
            include: {
              versions: {
                orderBy: { createdAt: 'desc' },
                select: { version: true, changelog: true, createdAt: true },
              },
              organisation: { select: { slug: true } },
            },
          },
          versions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { version: true, createdAt: true },
          },
        },
      })

      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' })
      }

      const isMember = pkg.organisation.members.length > 0
      if (pkg.visibility !== 'PUBLIC' && !isMember) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorised to access this package' })
      }

      if (!pkg.forkedFrom) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This package is not a fork',
        })
      }

      const currentVersion = pkg.versions[0]?.version ?? '0.0.0'
      const upstreamVersions = pkg.forkedFrom.versions
      const upstreamLatestVersion = upstreamVersions[0]?.version ?? '0.0.0'

      // Versions published on upstream after the fork's latest version was created
      const forkLatestDate = pkg.versions[0]?.createdAt ?? pkg.createdAt
      const newUpstreamVersions = upstreamVersions.filter(
        (v) => new Date(v.createdAt) > new Date(forkLatestDate)
      )

      return {
        hasUpdates: newUpstreamVersions.length > 0,
        upstreamLatestVersion,
        currentVersion,
        upstreamVersions: newUpstreamVersions.map((v) => ({
          version: v.version,
          changelog: v.changelog,
          createdAt: v.createdAt,
        })),
      }
    }),

  /**
   * Get the diff between the fork's current content and
   * the upstream's latest content for side-by-side comparison.
   */
  getUpstreamDiff: protectedProcedure
    .input(z.object({ packageId: z.string() }))
    .query(async ({ ctx, input }) => {
      const pkg = await prisma.package.findUnique({
        where: { id: input.packageId },
        include: {
          organisation: {
            include: {
              members: { where: { userId: ctx.user.id }, select: { id: true } },
            },
          },
          forkedFrom: {
            include: {
              organisation: { select: { slug: true, name: true } },
              versions: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { version: true },
              },
            },
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

      const isMember = pkg.organisation.members.length > 0
      if (pkg.visibility !== 'PUBLIC' && !isMember) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorised to access this package' })
      }

      if (!pkg.forkedFrom) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This package is not a fork',
        })
      }

      const forkContent = pkg.readme ?? ''

      // Fetch live upstream content rather than relying on stale DB cache
      let upstreamContent: string
      const upstreamGitUri = pkg.forkedFrom.gitUri
      const upstreamGitPath = pkg.forkedFrom.gitPath
      const isUpstreamAgentver = upstreamGitUri?.startsWith('agentver://')

      if (isUpstreamAgentver) {
        try {
          const content = await getGitProvider().getSkillFile(
            pkg.forkedFrom.organisation.slug,
            pkg.forkedFrom.name,
            'SKILL.md'
          )
          upstreamContent = content ?? pkg.forkedFrom.readme ?? ''
        } catch (error) {
          logger.warn(
            'Failed to fetch upstream from Forgejo for diff, falling back to database cache',
            {
              upstreamOrg: pkg.forkedFrom.organisation.slug,
              upstreamName: pkg.forkedFrom.name,
              error: error instanceof Error ? error.message : String(error),
            }
          )
          upstreamContent = pkg.forkedFrom.readme ?? ''
        }
      } else if (upstreamGitUri && upstreamGitPath) {
        const githubToken = await getGitHubToken(ctx.user.id)
        const parsed = parseGitHubRepoFromUri(upstreamGitUri)
        if (githubToken && parsed) {
          try {
            const filePath = `${upstreamGitPath}/SKILL.md`
            upstreamContent = await fetchGitHubUpstreamContent(
              githubToken,
              parsed.owner,
              parsed.repo,
              filePath
            )
          } catch (error) {
            logger.warn(
              'Failed to fetch upstream from GitHub for diff, falling back to database cache',
              {
                gitUri: upstreamGitUri,
                gitPath: upstreamGitPath,
                error: error instanceof Error ? error.message : String(error),
              }
            )
            upstreamContent = pkg.forkedFrom.readme ?? ''
          }
        } else {
          upstreamContent = pkg.forkedFrom.readme ?? ''
        }
      } else {
        upstreamContent = pkg.forkedFrom.readme ?? ''
      }

      return {
        forkContent,
        upstreamContent,
        forkVersion: pkg.versions[0]?.version ?? '0.0.0',
        upstreamVersion: pkg.forkedFrom.versions[0]?.version ?? '0.0.0',
        upstreamOrg: pkg.forkedFrom.organisation.slug,
        upstreamName: pkg.forkedFrom.name,
      }
    }),

  /**
   * Pull the latest content from the upstream package into the fork.
   * Creates a new version on the fork with a descriptive changelog.
   * Routes to Agentver Forgejo or GitHub based on the org's provider.
   */
  syncFromUpstream: protectedProcedure
    .input(z.object({ packageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const pkg = await prisma.package.findUnique({
        where: { id: input.packageId },
        include: {
          organisation: {
            include: {
              members: { where: { userId: ctx.user.id } },
            },
          },
          forkedFrom: {
            include: {
              organisation: { select: { slug: true } },
              versions: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { version: true, fileManifest: true },
              },
            },
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

      if (!pkg.forkedFrom) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This package is not a fork',
        })
      }

      const membership = pkg.organisation.members[0]
      const isAuthor = pkg.authorId === ctx.user.id
      const isAdminOrOwner = membership?.role === 'ADMIN' || membership?.role === 'OWNER'

      if (!isAuthor && !isAdminOrOwner) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the fork owner or organisation admins can sync from the original',
        })
      }

      const isAgentver = pkg.organisation.skillsRepoProvider === 'agentver'
      const hasExternalRepo =
        !!pkg.organisation.skillsRepoOwner && !!pkg.organisation.skillsRepoName

      if (!isAgentver && !hasExternalRepo) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'No skills repository connected for this organisation',
        })
      }

      const upstreamOrgSlug = pkg.forkedFrom.organisation.slug
      const upstreamName = pkg.forkedFrom.name
      const upstreamVersion = pkg.forkedFrom.versions[0]?.version ?? '0.0.0'
      const upstreamManifest = pkg.forkedFrom.versions[0]?.fileManifest

      // Bump fork version
      const currentVersion = pkg.versions[0]?.version ?? '0.0.0'
      const parts = currentVersion.split('.')
      const patchNum = Number.parseInt(parts[2] ?? '0', 10)
      const newVersion = `${parts[0]}.${parts[1]}.${patchNum + 1}`

      const changelog = `Synced from ${upstreamOrgSlug}/${upstreamName} v${upstreamVersion}`

      let upstreamContent: string
      let commitSha: string
      let defaultBranch: string

      if (isAgentver) {
        // Fetch upstream content from Forgejo
        try {
          const content = await getGitProvider().getSkillFile(
            upstreamOrgSlug,
            upstreamName,
            'SKILL.md'
          )
          upstreamContent = content ?? pkg.forkedFrom.readme ?? ''
        } catch (error) {
          if (error instanceof GitProviderConfigError) {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
          }
          logger.warn('Failed to fetch upstream from Forgejo, using database readme', {
            upstreamOrgSlug,
            upstreamName,
            error: error instanceof Error ? error.message : String(error),
          })
          upstreamContent = pkg.forkedFrom.readme ?? ''
        }

        // Commit to the fork's namespace in Forgejo
        defaultBranch = 'main'
        try {
          const result = await getGitProvider().updateSkillFile(
            pkg.organisation.slug,
            pkg.name,
            'SKILL.md',
            upstreamContent,
            changelog
          )
          commitSha = result.commitSha
        } catch (error) {
          if (error instanceof GitProviderConfigError) {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
          }
          logger.error('Failed to commit synced content to Forgejo', {
            orgSlug: pkg.organisation.slug,
            packageName: pkg.name,
            error: error instanceof Error ? error.message : String(error),
          })
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to sync content to Agentver storage',
          })
        }
      } else {
        // GitHub-backed path — fetch latest content from the source repo
        const githubToken = await getGitHubToken(ctx.user.id)
        if (!githubToken) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'No GitHub account connected. Please connect your GitHub account first.',
          })
        }

        // Fetch latest upstream content from the source GitHub repo
        const upstreamGitUri = pkg.forkedFrom.gitUri
        const upstreamGitPath = pkg.forkedFrom.gitPath
        const parsed = upstreamGitUri ? parseGitHubRepoFromUri(upstreamGitUri) : null
        if (parsed && upstreamGitPath) {
          try {
            const filePath = `${upstreamGitPath}/SKILL.md`
            upstreamContent = await fetchGitHubUpstreamContent(
              githubToken,
              parsed.owner,
              parsed.repo,
              filePath
            )
          } catch (error) {
            logger.warn(
              'Failed to fetch upstream content from GitHub, falling back to database cache',
              {
                gitUri: upstreamGitUri,
                gitPath: upstreamGitPath,
                error: error instanceof Error ? error.message : String(error),
              }
            )
            upstreamContent = pkg.forkedFrom.readme ?? ''
          }
        } else {
          logger.warn('Upstream package missing gitUri/gitPath, falling back to database cache', {
            upstreamPackageId: pkg.forkedFrom.id,
          })
          upstreamContent = pkg.forkedFrom.readme ?? ''
        }

        const repoOwner = pkg.organisation.skillsRepoOwner!
        const repoName = pkg.organisation.skillsRepoName!
        defaultBranch = await getDefaultBranch(repoOwner, repoName, githubToken)

        const gitPath = pkg.gitPath ?? `skills/${pkg.name}`
        const commitResult = await commitFiles(
          repoOwner,
          repoName,
          [{ path: `${gitPath}/SKILL.md`, content: upstreamContent }],
          changelog,
          defaultBranch,
          githubToken
        )
        commitSha = commitResult.sha
      }

      const manifestJson = (upstreamManifest ?? {}) as Prisma.InputJsonValue

      // Create the new version and update the package content in a transaction
      const [version] = await prisma.$transaction([
        prisma.packageVersion.create({
          data: {
            packageId: input.packageId,
            version: newVersion,
            changelog,
            fileManifest: manifestJson,
            gitRef: defaultBranch,
            gitCommitSha: commitSha,
          },
        }),
        prisma.package.update({
          where: { id: input.packageId },
          data: { readme: upstreamContent },
        }),
      ])

      logAudit({
        userId: ctx.user.id,
        action: 'PACKAGE_SYNCED',
        resource: 'Package',
        resourceId: input.packageId,
        metadata: {
          fromPackageId: pkg.forkedFrom.id,
          upstreamVersion,
          newVersion,
          commitSha,
        },
      })

      return {
        version: version.version,
        changelog: version.changelog,
      }
    }),

  /**
   * Create a change proposal on the upstream (parent) package
   * from the fork's current content.
   */
  createUpstreamProposal: protectedProcedure
    .input(
      z.object({
        packageId: z.string(),
        description: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const pkg = await prisma.package.findUnique({
        where: { id: input.packageId },
        include: {
          organisation: {
            include: {
              members: { where: { userId: ctx.user.id } },
            },
          },
          forkedFrom: {
            include: {
              organisation: { select: { slug: true } },
              versions: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { version: true },
              },
            },
          },
        },
      })

      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' })
      }

      if (!pkg.forkedFrom) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This package is not a fork',
        })
      }

      if (pkg.organisation.members.length === 0) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You must be a member of the fork organisation to suggest changes',
        })
      }

      const forkOrgSlug = pkg.organisation.slug
      const forkName = pkg.name
      const upstreamVersion = pkg.forkedFrom.versions[0]?.version ?? null

      const title = `Proposed changes from ${forkOrgSlug}/${forkName}`

      const proposal = await prisma.changeProposal.create({
        data: {
          packageId: pkg.forkedFrom.id,
          authorId: ctx.user.id,
          title,
          description: input.description ?? null,
          content: { body: pkg.readme ?? '' } as Prisma.InputJsonValue,
          status: 'OPEN',
          baseVersion: upstreamVersion,
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'PROPOSAL_CREATED',
        resource: 'ChangeProposal',
        resourceId: proposal.id,
        metadata: {
          packageId: pkg.forkedFrom.id,
          fromForkId: input.packageId,
          title,
        },
      })

      return proposal
    }),

  /**
   * List all forks of a given package.
   */
  listForks: protectedProcedure
    .input(z.object({ packageId: z.string() }))
    .query(async ({ input }) => {
      return prisma.package.findMany({
        where: { forkedFromId: input.packageId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          createdAt: true,
          organisation: { select: { slug: true, name: true } },
          author: { select: { name: true, image: true } },
          _count: { select: { installationReports: true } },
        },
      })
    }),
})
