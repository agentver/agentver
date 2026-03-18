import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { logAudit } from '@/lib/audit/logger'
import { invalidateOnSkillWrite } from '@/lib/redis/invalidation'
import { deliverEvent } from '@/lib/webhooks/service'
import { protectedProcedure, publicProcedure, router } from '../init'

const logger = createLogger('mcp-catalogue-router')

const mcpSourceTypeSchema = z.enum(['npm', 'git', 'docker', 'url'])
const mcpTransportSchema = z.enum(['stdio', 'http', 'sse'])

export const mcpCatalogueRouter = router({
  /**
   * Browse MCP server definitions with optional filters.
   */
  list: publicProcedure
    .input(
      z.object({
        category: z.string().optional(),
        transport: mcpTransportSchema.optional(),
        verified: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const where: Record<string, unknown> = {}

      if (input.category) {
        where.categories = { has: input.category }
      }

      if (input.transport) {
        where.transport = input.transport
      }

      if (input.verified !== undefined) {
        where.verified = input.verified
      }

      const definitions = await prisma.mcpServerDefinition.findMany({
        where,
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        orderBy: [{ verified: 'desc' }, { installCount: 'desc' }, { name: 'asc' }],
      })

      const hasMore = definitions.length > input.limit
      const items = hasMore ? definitions.slice(0, -1) : definitions

      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
      }
    }),

  /**
   * Search MCP server definitions by name or description.
   */
  search: publicProcedure
    .input(
      z.object({
        query: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ input }) => {
      const results = await prisma.mcpServerDefinition.findMany({
        where: {
          OR: [
            { name: { contains: input.query, mode: 'insensitive' } },
            { displayName: { contains: input.query, mode: 'insensitive' } },
            { description: { contains: input.query, mode: 'insensitive' } },
          ],
        },
        take: input.limit,
        orderBy: [{ verified: 'desc' }, { installCount: 'desc' }],
      })

      return results
    }),

  /**
   * Get a single MCP server definition by name.
   */
  getByName: publicProcedure.input(z.object({ name: z.string() })).query(async ({ input }) => {
    const definition = await prisma.mcpServerDefinition.findUnique({
      where: { name: input.name },
    })

    if (!definition) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `MCP server "${input.name}" not found` })
    }

    return definition
  }),

  /**
   * Create or update an MCP server definition. Admin only (verified publishers).
   */
  upsert: protectedProcedure
    .input(
      z.object({
        name: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z0-9-]+$/),
        displayName: z.string().min(1).max(128),
        description: z.string().min(1).max(1000),
        author: z.string().min(1).max(128),

        sourceType: mcpSourceTypeSchema,
        sourcePackage: z.string().optional(),
        sourceUri: z.string().optional(),
        latestVersion: z.string().optional(),

        transport: mcpTransportSchema.default('stdio'),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        url: z.string().url().optional(),

        credentialSchema: z.any().optional(),
        toolManifest: z.any().optional(),
        compatibility: z.array(z.string()).optional(),
        categories: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = await prisma.user.findUnique({
        where: { id: ctx.user.id },
        select: { isVerifiedPublisher: true },
      })

      if (!user?.isVerifiedPublisher) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only verified publishers can manage MCP server catalogue entries',
        })
      }

      const definition = await prisma.mcpServerDefinition.upsert({
        where: { name: input.name },
        create: {
          name: input.name,
          displayName: input.displayName,
          description: input.description,
          author: input.author,
          sourceType: input.sourceType,
          sourcePackage: input.sourcePackage,
          sourceUri: input.sourceUri,
          latestVersion: input.latestVersion,
          transport: input.transport,
          command: input.command,
          args: input.args ?? [],
          url: input.url,
          credentialSchema: input.credentialSchema ?? undefined,
          toolManifest: input.toolManifest ?? undefined,
          compatibility: input.compatibility ?? [],
          categories: input.categories ?? [],
        },
        update: {
          displayName: input.displayName,
          description: input.description,
          author: input.author,
          sourceType: input.sourceType,
          sourcePackage: input.sourcePackage,
          sourceUri: input.sourceUri,
          latestVersion: input.latestVersion,
          transport: input.transport,
          command: input.command,
          args: input.args ?? [],
          url: input.url,
          credentialSchema: input.credentialSchema ?? undefined,
          toolManifest: input.toolManifest ?? undefined,
          compatibility: input.compatibility ?? [],
          categories: input.categories ?? [],
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'MCP_SERVER_UPSERTED',
        resource: 'McpServerDefinition',
        resourceId: definition.id,
        metadata: { name: input.name },
      })

      logger.info('MCP server definition upserted', {
        userId: ctx.user.id,
        name: input.name,
      })

      return definition
    }),

  /**
   * Get all distinct categories from the catalogue.
   */
  categories: publicProcedure.query(async () => {
    const definitions = await prisma.mcpServerDefinition.findMany({
      select: { categories: true },
    })

    const categorySet = new Set<string>()
    for (const def of definitions) {
      for (const cat of def.categories) {
        categorySet.add(cat)
      }
    }

    return Array.from(categorySet).sort()
  }),

  /**
   * Get the total number of MCP server definitions in the catalogue.
   */
  count: publicProcedure.query(async () => {
    return prisma.mcpServerDefinition.count()
  }),

  /**
   * Add an MCP server from the catalogue to an organisation as an AGENT_CONFIG package.
   */
  addToOrg: protectedProcedure
    .input(
      z.object({
        organisationId: z.string(),
        serverName: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify org membership
      const org = await prisma.organisation.findUnique({
        where: { id: input.organisationId },
        include: {
          members: { where: { userId: ctx.user.id } },
        },
      })

      if (!org) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Organisation not found' })
      }

      if (org.members.length === 0) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this organisation' })
      }

      // Look up the MCP server definition
      const serverDef = await prisma.mcpServerDefinition.findUnique({
        where: { name: input.serverName },
      })

      if (!serverDef) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `MCP server "${input.serverName}" not found in the catalogue`,
        })
      }

      // Build the MCP config content as a SKILL.md-style document
      const configJson = buildMcpConfigJson(serverDef)
      const packageName = `mcp-${serverDef.name}`

      const content = [
        '---',
        `name: ${packageName}`,
        `description: MCP server configuration for ${serverDef.displayName}`,
        'type: AGENT_CONFIG',
        serverDef.compatibility.length > 0
          ? `compatibility:\n${serverDef.compatibility.map((a) => `  - ${a}`).join('\n')}`
          : '',
        '---',
        '',
        `# ${serverDef.displayName} MCP Configuration`,
        '',
        serverDef.description,
        '',
        '## Configuration',
        '',
        'Add this to your MCP client configuration:',
        '',
        '```json',
        configJson,
        '```',
      ]
        .filter((line) => line !== '')
        .join('\n')

      // Check for name collision
      const existing = await prisma.package.findFirst({
        where: { name: packageName, organisationId: input.organisationId },
      })

      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `A package named "${packageName}" already exists in this organisation.`,
        })
      }

      const slug = `${org.slug}/${packageName}`

      const pkg = await prisma.package.create({
        data: {
          name: packageName,
          slug,
          description: `MCP server configuration for ${serverDef.displayName}`,
          type: 'AGENT_CONFIG',
          visibility: 'PRIVATE',
          tags: ['mcp', ...serverDef.categories],
          readme: content,
          compatibilityAgents: serverDef.compatibility,
          organisationId: input.organisationId,
          authorId: ctx.user.id,
        },
        include: {
          organisation: { select: { slug: true, name: true } },
        },
      })

      // Create initial version
      await prisma.packageVersion.create({
        data: {
          packageId: pkg.id,
          version: '1.0.0',
          changelog: `Added ${serverDef.displayName} MCP server from catalogue`,
        },
      })

      // Increment the install count on the catalogue entry
      await prisma.mcpServerDefinition.update({
        where: { id: serverDef.id },
        data: { installCount: { increment: 1 } },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'PACKAGE_CREATED',
        resource: 'Package',
        resourceId: pkg.id,
        metadata: {
          name: packageName,
          type: 'AGENT_CONFIG',
          organisationId: input.organisationId,
          mcpServerName: serverDef.name,
        },
      })

      void deliverEvent(
        input.organisationId,
        'skill.created',
        { id: ctx.user.id, username: ctx.user.name ?? ctx.user.email },
        { skill: { name: packageName, slug } }
      )

      logger.info('MCP server added to org from catalogue', {
        packageId: pkg.id,
        serverName: serverDef.name,
        organisationId: input.organisationId,
      })

      invalidateOnSkillWrite(org.slug, packageName).catch(() => {})

      return { package: pkg, configJson }
    }),
})

/**
 * Build the MCP configuration JSON string for a server definition.
 */
function buildMcpConfigJson(server: {
  name: string
  transport: string
  command: string | null
  args: string[]
  url: string | null
  sourcePackage: string | null
}): string {
  if (server.transport === 'stdio') {
    const cmd = server.command ?? 'npx'
    const args =
      server.args.length > 0
        ? server.args
        : server.sourcePackage
          ? ['-y', server.sourcePackage]
          : []

    return JSON.stringify(
      {
        mcpServers: {
          [server.name]: {
            command: cmd,
            args,
          },
        },
      },
      null,
      2
    )
  }

  return JSON.stringify(
    {
      mcpServers: {
        [server.name]: {
          url: server.url ?? `https://${server.name}.example.com/mcp`,
        },
      },
    },
    null,
    2
  )
}
