import { prisma } from '@agentver/database'
import { bundleManifestSchema } from '@agentver/shared'
import { NextResponse } from 'next/server'
import { authenticateRequestWithDetails } from '@/lib/auth/api-auth'
import {
  findMissingCredentials,
  resolveBundle,
  validateBundleManifest,
} from '@/lib/mcp/bundle-resolver'

// ---------------------------------------------------------------------------
// GET /api/v1/bundles — List or search bundles
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const url = new URL(request.url)
  const query = url.searchParams.get('q')
  const org = url.searchParams.get('org')
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 100)
  const cursor = url.searchParams.get('cursor')

  const where: Record<string, unknown> = {
    type: 'BUNDLE',
  }

  if (query) {
    where.OR = [
      { name: { contains: query, mode: 'insensitive' } },
      { description: { contains: query, mode: 'insensitive' } },
    ]
  }

  if (org) {
    const organisation = await prisma.organisation.findUnique({
      where: { slug: org },
      select: { id: true },
    })

    if (!organisation) {
      return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })
    }

    where.organisationId = organisation.id
  } else {
    where.visibility = 'PUBLIC'
  }

  const bundles = await prisma.package.findMany({
    where,
    take: limit + 1,
    cursor: cursor ? { id: cursor } : undefined,
    include: {
      organisation: { select: { slug: true, name: true } },
      author: { select: { username: true, name: true } },
      _count: { select: { installs: true } },
    },
    orderBy: [{ installCount: 'desc' }, { name: 'asc' }],
  })

  const hasMore = bundles.length > limit
  const items = hasMore ? bundles.slice(0, -1) : bundles

  return NextResponse.json({
    items,
    nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
  })
}

// ---------------------------------------------------------------------------
// POST /api/v1/bundles — Resolve a bundle manifest
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const authResponse = await authenticateRequestWithDetails(request)
  if (!authResponse.ok) {
    return NextResponse.json(
      { error: authResponse.error.message },
      { status: authResponse.error.status }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = bundleManifestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid bundle manifest', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const manifest = parsed.data

  // Validate manifest
  const errors = validateBundleManifest(manifest)
  if (errors.length > 0) {
    return NextResponse.json(
      { error: 'Bundle validation failed', details: errors },
      { status: 400 }
    )
  }

  // Resolve the bundle
  const resolved = resolveBundle(manifest)

  // Check vault for available credentials
  const availableCredentials: Record<string, string> = {}

  if (authResponse.result.organisationId) {
    const secrets = await prisma.secretVault.findMany({
      where: {
        organisationId: authResponse.result.organisationId,
        key: { in: Array.from(resolved.credentials.keys()) },
      },
      select: { key: true },
    })

    for (const secret of secrets) {
      availableCredentials[secret.key] = '[available-in-vault]'
    }
  }

  const missingCredentials = findMissingCredentials(resolved, availableCredentials)

  return NextResponse.json({
    name: resolved.name,
    version: resolved.version,
    description: resolved.description,
    packages: resolved.packages,
    mcpServers: resolved.mcpServers.map((s) => ({
      name: s.name,
      description: s.description,
      transport: s.transport,
      command: s.command,
      args: s.args,
      url: s.url,
      credentialCount: s.credentials.length,
    })),
    credentials: {
      total: resolved.credentials.size,
      available: Object.keys(availableCredentials).length,
      missing: missingCredentials.map((c) => ({
        key: c.key,
        description: c.description,
        source: c.source,
        required: c.required,
      })),
    },
  })
}
