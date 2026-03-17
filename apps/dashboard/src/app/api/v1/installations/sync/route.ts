import { prisma } from '@agentver/database'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest } from '@/lib/auth/api-auth'

const syncPackageSourceSchema = z.object({
  uri: z.string().min(1).optional(),
  path: z.string().optional(),
  ref: z.string().min(1).optional(),
  commit: z.string().min(7).optional(),
  type: z.string().optional(),
  baseUrl: z.string().optional(),
  hostname: z.string().optional(),
  skillName: z.string().optional(),
})

const syncPackageSchema = z.object({
  source: syncPackageSourceSchema.optional(),
  agents: z.array(z.string()).default([]),
  modified: z.boolean().default(false),
})

const syncBodySchema = z.object({
  machineId: z.string().min(1),
  packages: z.record(z.string(), syncPackageSchema),
})

async function findOrCreatePackage(slug: string, userId: string, organisationId?: string) {
  const existing = await prisma.package.findFirst({
    where: {
      OR: [{ slug }, { name: slug }],
    },
  })
  if (existing) return existing

  const orgId =
    organisationId ??
    (await prisma.organisationMember.findFirst({
      where: { userId },
      select: { organisationId: true, organisation: { select: { slug: true } } },
    }))

  if (!orgId) return null

  const orgSlug = typeof orgId === 'string' ? '' : orgId.organisation.slug
  const resolvedOrgId = typeof orgId === 'string' ? orgId : orgId.organisationId

  return prisma.package.create({
    data: {
      name: slug,
      slug: orgSlug ? `${orgSlug}/${slug}` : slug,
      type: 'SKILL',
      visibility: 'PRIVATE',
      organisationId: resolvedOrgId,
      authorId: userId,
    },
  })
}

export async function POST(request: Request) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  if (!authResult.scopes.includes('WRITE')) {
    return NextResponse.json(
      { error: 'Insufficient permissions. WRITE scope required.' },
      { status: 403 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = syncBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { machineId, packages } = parsed.data

  let synced = 0
  const syncedPackageIds: string[] = []

  for (const [slug, entry] of Object.entries(packages)) {
    const pkg = await findOrCreatePackage(slug, authResult.userId, authResult.organisationId)
    if (!pkg) continue

    const sourceFields = {
      sourceUri: entry.source?.uri ?? null,
      sourcePath: entry.source?.path ?? null,
      sourceRef: entry.source?.ref ?? null,
      sourceCommit: entry.source?.commit ?? null,
    }

    await prisma.installationReport.upsert({
      where: {
        packageId_userId_machineId: {
          packageId: pkg.id,
          userId: authResult.userId,
          machineId,
        },
      },
      update: {
        agents: entry.agents,
        modified: entry.modified,
        lastSeenAt: new Date(),
        ...sourceFields,
      },
      create: {
        packageId: pkg.id,
        userId: authResult.userId,
        machineId,
        agents: entry.agents,
        modified: entry.modified,
        ...sourceFields,
      },
    })

    syncedPackageIds.push(pkg.id)
    synced++
  }

  const staleReports = await prisma.installationReport.deleteMany({
    where: {
      userId: authResult.userId,
      machineId,
      packageId: { notIn: syncedPackageIds },
    },
  })

  return NextResponse.json({ synced, removed: staleReports.count })
}
