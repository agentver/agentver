import { type Prisma, prisma } from '@agentver/database'
import { type BundleManifest, bundleManifestSchema, createLogger } from '@agentver/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { logAudit } from '@/lib/audit/logger'
import {
  findMissingCredentials,
  type ResolvedCredential,
  resolveBundle,
  validateBundleManifest,
} from '@/lib/mcp/bundle-resolver'
import { protectedProcedure, publicProcedure, router } from '../init'

const logger = createLogger('bundles-router')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireOrgMembership(userId: string, organisationId: string) {
  const membership = await prisma.organisationMember.findUnique({
    where: {
      userId_organisationId: { userId, organisationId },
    },
  })

  if (!membership) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this organisation' })
  }

  return membership
}

async function requireOrgAdminOrOwner(userId: string, organisationId: string) {
  const membership = await requireOrgMembership(userId, organisationId)

  if (!(['OWNER', 'ADMIN'] as const).includes(membership.role as 'OWNER' | 'ADMIN')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only owners and admins can manage bundles',
    })
  }

  return membership
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const bundlesRouter = router({
  /**
   * List bundles with optional filters.
   */
  list: publicProcedure
    .input(
      z.object({
        organisationId: z.string().optional(),
        teamId: z.string().optional(),
        visibility: z.enum(['PUBLIC', 'PRIVATE', 'TEAM']).optional(),
        search: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.PackageWhereInput = {
        type: 'BUNDLE',
        ...(input.organisationId && { organisationId: input.organisationId }),
        ...(input.teamId && { teamId: input.teamId }),
        ...(input.visibility && { visibility: input.visibility }),
        ...(input.search && {
          OR: [
            { name: { contains: input.search, mode: 'insensitive' as const } },
            { description: { contains: input.search, mode: 'insensitive' as const } },
          ],
        }),
        AND: [
          {
            OR: [
              { visibility: 'PUBLIC' as const },
              ...(ctx.user
                ? [
                    {
                      organisation: {
                        members: { some: { userId: ctx.user.id } },
                      },
                    },
                    {
                      visibility: 'TEAM' as const,
                      team: {
                        members: { some: { userId: ctx.user.id } },
                      },
                    },
                  ]
                : []),
            ],
          },
        ],
      }

      const fetchLimit = input.limit + 1

      const packages = await prisma.package.findMany({
        where,
        take: fetchLimit,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        orderBy: { updatedAt: 'desc' },
        include: {
          organisation: { select: { slug: true, name: true } },
          author: { select: { name: true, image: true } },
          versions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { version: true, createdAt: true },
          },
          _count: { select: { installationReports: true } },
        },
      })

      let nextCursor: string | undefined
      const items =
        packages.length > input.limit
          ? (() => {
              const sliced = packages.slice(0, input.limit)
              nextCursor = packages[input.limit]?.id
              return sliced
            })()
          : packages

      return { bundles: items, nextCursor }
    }),

  /**
   * Get a single bundle by org slug and package slug.
   */
  getBySlug: publicProcedure
    .input(z.object({ org: z.string(), name: z.string() }))
    .query(async ({ input }) => {
      const pkg = await prisma.package.findFirst({
        where: {
          name: input.name,
          type: 'BUNDLE',
          organisation: { slug: input.org },
        },
        include: {
          organisation: {
            select: {
              slug: true,
              name: true,
              id: true,
            },
          },
          author: { select: { name: true, image: true } },
          versions: {
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: {
              id: true,
              version: true,
              changelog: true,
              fileManifest: true,
              createdAt: true,
            },
          },
          _count: { select: { installationReports: true, forks: true } },
        },
      })

      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Bundle not found' })
      }

      return pkg
    }),

  /**
   * Create a new bundle package.
   */
  create: protectedProcedure
    .input(
      z.object({
        organisationId: z.string(),
        name: z
          .string()
          .min(1)
          .max(64)
          .regex(
            /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
            'Name must be lowercase alphanumeric with hyphens'
          ),
        description: z.string().max(1000).optional(),
        visibility: z.enum(['PUBLIC', 'PRIVATE', 'TEAM']).default('PRIVATE'),
        teamId: z.string().optional(),
        manifest: bundleManifestSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgAdminOrOwner(ctx.user.id, input.organisationId)

      // Validate team belongs to org if provided
      if (input.teamId) {
        const team = await prisma.team.findUnique({
          where: { id: input.teamId },
          select: { organisationId: true },
        })

        if (!team || team.organisationId !== input.organisationId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Team does not belong to this organisation',
          })
        }
      }

      // Validate name uniqueness within org
      const existing = await prisma.package.findUnique({
        where: {
          organisationId_name: {
            organisationId: input.organisationId,
            name: input.name,
          },
        },
      })

      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'A package with this name already exists in this organisation',
        })
      }

      // Validate the manifest
      const validationErrors = validateBundleManifest(input.manifest)
      if (validationErrors.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Invalid bundle manifest: ${validationErrors.join('; ')}`,
        })
      }

      const org = await prisma.organisation.findUnique({
        where: { id: input.organisationId },
        select: { slug: true },
      })

      if (!org) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Organisation not found' })
      }

      const slug = `${org.slug}/${input.name}`

      const pkg = await prisma.package.create({
        data: {
          name: input.name,
          slug,
          description: input.description,
          type: 'BUNDLE',
          visibility: input.visibility,
          organisationId: input.organisationId,
          teamId: input.teamId,
          authorId: ctx.user.id,
          versions: {
            create: {
              version: input.manifest.version,
              fileManifest: input.manifest as unknown as Prisma.InputJsonValue,
            },
          },
        },
        include: {
          organisation: { select: { slug: true, name: true } },
          author: { select: { name: true, image: true } },
          versions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, version: true, createdAt: true },
          },
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'PACKAGE_CREATED',
        resource: 'Package',
        resourceId: pkg.id,
        metadata: {
          name: input.name,
          slug,
          type: 'BUNDLE',
          organisationId: input.organisationId,
        },
      })

      logger.info('Bundle created', {
        userId: ctx.user.id,
        packageId: pkg.id,
        name: input.name,
        organisationId: input.organisationId,
      })

      return pkg
    }),

  /**
   * Update a bundle's metadata (description, visibility, tags).
   */
  update: protectedProcedure
    .input(
      z.object({
        packageId: z.string(),
        description: z.string().max(1000).optional(),
        visibility: z.enum(['PUBLIC', 'PRIVATE', 'TEAM']).optional(),
        tags: z.array(z.string().max(50)).max(20).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const pkg = await prisma.package.findUnique({
        where: { id: input.packageId },
        select: { id: true, name: true, type: true, organisationId: true },
      })

      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Bundle not found' })
      }

      if (pkg.type !== 'BUNDLE') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Package is not a bundle' })
      }

      await requireOrgAdminOrOwner(ctx.user.id, pkg.organisationId)

      const updated = await prisma.package.update({
        where: { id: input.packageId },
        data: {
          ...(input.description !== undefined && { description: input.description }),
          ...(input.visibility && { visibility: input.visibility }),
          ...(input.tags && { tags: input.tags }),
        },
        include: {
          organisation: { select: { slug: true, name: true } },
          author: { select: { name: true, image: true } },
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'PACKAGE_UPDATED',
        resource: 'Package',
        resourceId: pkg.id,
        metadata: {
          name: pkg.name,
          type: 'BUNDLE',
          changes: {
            ...(input.description !== undefined && { description: input.description }),
            ...(input.visibility && { visibility: input.visibility }),
            ...(input.tags && { tags: input.tags }),
          },
        },
      })

      logger.info('Bundle updated', {
        userId: ctx.user.id,
        packageId: pkg.id,
        name: pkg.name,
      })

      return updated
    }),

  /**
   * Publish a new version of a bundle.
   */
  publishVersion: protectedProcedure
    .input(
      z.object({
        packageId: z.string(),
        version: z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/, 'Must be valid semver'),
        manifest: bundleManifestSchema,
        changelog: z.string().max(5000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const pkg = await prisma.package.findUnique({
        where: { id: input.packageId },
        select: { id: true, name: true, slug: true, type: true, organisationId: true },
      })

      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Bundle not found' })
      }

      if (pkg.type !== 'BUNDLE') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Package is not a bundle' })
      }

      await requireOrgAdminOrOwner(ctx.user.id, pkg.organisationId)

      // Check version doesn't already exist
      const existingVersion = await prisma.packageVersion.findUnique({
        where: {
          packageId_version: {
            packageId: input.packageId,
            version: input.version,
          },
        },
      })

      if (existingVersion) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Version ${input.version} already exists for this bundle`,
        })
      }

      // Validate the manifest
      const validationErrors = validateBundleManifest(input.manifest)
      if (validationErrors.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Invalid bundle manifest: ${validationErrors.join('; ')}`,
        })
      }

      const version = await prisma.packageVersion.create({
        data: {
          packageId: input.packageId,
          version: input.version,
          changelog: input.changelog,
          fileManifest: input.manifest as unknown as Prisma.InputJsonValue,
        },
        select: {
          id: true,
          version: true,
          changelog: true,
          createdAt: true,
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'VERSION_PUBLISHED',
        resource: 'PackageVersion',
        resourceId: version.id,
        metadata: {
          packageId: pkg.id,
          packageName: pkg.name,
          version: input.version,
          type: 'BUNDLE',
        },
      })

      logger.info('Bundle version published', {
        userId: ctx.user.id,
        packageId: pkg.id,
        version: input.version,
      })

      return version
    }),

  /**
   * Resolve a bundle manifest into a flat list of packages, MCP servers, and credentials.
   */
  resolve: publicProcedure
    .input(
      z.object({
        manifest: bundleManifestSchema,
      })
    )
    .query(({ input }) => {
      const validationErrors = validateBundleManifest(input.manifest)
      if (validationErrors.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Invalid bundle manifest: ${validationErrors.join('; ')}`,
        })
      }

      const resolved = resolveBundle(input.manifest)

      // Convert Map to plain object for serialisation
      const credentials: Record<string, ResolvedCredential> = {}
      for (const [key, value] of resolved.credentials) {
        credentials[key] = value
      }

      return {
        name: resolved.name,
        version: resolved.version,
        description: resolved.description,
        packages: resolved.packages,
        mcpServers: resolved.mcpServers,
        credentials,
        extends: resolved.extends,
      }
    }),

  /**
   * Get an installation plan for a bundle.
   * Returns packages to install, MCP servers to configure,
   * and credential availability from the vault.
   */
  getInstallPlan: protectedProcedure
    .input(
      z.object({
        packageId: z.string(),
        organisationId: z.string(),
        teamId: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await requireOrgMembership(ctx.user.id, input.organisationId)

      const pkg = await prisma.package.findUnique({
        where: { id: input.packageId },
        select: {
          id: true,
          name: true,
          type: true,
          organisationId: true,
          versions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, version: true, fileManifest: true },
          },
        },
      })

      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Bundle not found' })
      }

      if (pkg.type !== 'BUNDLE') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Package is not a bundle' })
      }

      const latestVersion = pkg.versions[0]
      if (!latestVersion?.fileManifest) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No published version found for this bundle',
        })
      }

      // Parse the stored manifest
      const parseResult = bundleManifestSchema.safeParse(latestVersion.fileManifest)
      if (!parseResult.success) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Stored bundle manifest is invalid',
        })
      }

      const manifest: BundleManifest = parseResult.data
      const resolved = resolveBundle(manifest)

      // Look up which credentials are available in the vault
      const credentialKeys = Array.from(resolved.credentials.keys())
      const availableCredentials: Record<string, string> = {}

      if (credentialKeys.length > 0) {
        const secrets = await prisma.secretVault.findMany({
          where: {
            organisationId: input.organisationId,
            key: { in: credentialKeys },
            OR: [{ teamId: input.teamId ?? null }, { teamId: null }],
          },
          select: { key: true },
        })

        for (const secret of secrets) {
          // Mark as available (we don't expose the actual value here)
          availableCredentials[secret.key] = 'available'
        }
      }

      const missingCredentials = findMissingCredentials(resolved, availableCredentials)

      // Convert credentials Map to plain object with availability flag
      const allCredentials: Record<string, ResolvedCredential & { available: boolean }> = {}
      for (const [key, value] of resolved.credentials) {
        allCredentials[key] = {
          ...value,
          available: key in availableCredentials,
        }
      }

      return {
        bundle: {
          id: pkg.id,
          name: pkg.name,
          version: latestVersion.version,
        },
        packages: resolved.packages,
        mcpServers: resolved.mcpServers,
        credentials: allCredentials,
        missingCredentials,
        extends: resolved.extends,
      }
    }),
})
