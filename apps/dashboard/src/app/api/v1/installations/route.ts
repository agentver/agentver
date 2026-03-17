import { prisma } from '@agentver/database'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest } from '@/lib/auth/api-auth'

const installationSourceSchema = z.object({
  uri: z.string().min(1).optional(),
  path: z.string().optional(),
  ref: z.string().min(1).optional(),
  commit: z.string().min(7).optional(),
  type: z.string().optional(),
  baseUrl: z.string().optional(),
  hostname: z.string().optional(),
  skillName: z.string().optional(),
})

const installationBodySchema = z.object({
  packageSlug: z.string().min(1),
  source: installationSourceSchema.optional(),
  agents: z.array(z.string()).default([]),
  machineId: z.string().min(1),
  modified: z.boolean().default(false),
})

async function findOrCreatePackage(slug: string, userId: string) {
  const existing = await prisma.package.findFirst({ where: { slug } })
  if (existing) return existing

  const existingByName = await prisma.package.findFirst({
    where: { name: slug },
    include: { organisation: true },
  })
  if (existingByName) return existingByName

  const membership = await prisma.organisationMember.findFirst({
    where: { userId },
    include: { organisation: true },
  })

  if (!membership) return null

  return prisma.package.create({
    data: {
      name: slug,
      slug: `${membership.organisation.slug}/${slug}`,
      type: 'SKILL',
      visibility: 'PRIVATE',
      organisationId: membership.organisationId,
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

  const parsed = installationBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { packageSlug, source, agents, machineId, modified } = parsed.data

  const pkg = await findOrCreatePackage(packageSlug, authResult.userId)
  if (!pkg) {
    return NextResponse.json(
      { error: 'Could not resolve or create package. User must belong to an organisation.' },
      { status: 422 }
    )
  }

  const sourceFields = {
    sourceUri: source?.uri ?? null,
    sourcePath: source?.path ?? null,
    sourceRef: source?.ref ?? null,
    sourceCommit: source?.commit ?? null,
  }

  const report = await prisma.installationReport.upsert({
    where: {
      packageId_userId_machineId: {
        packageId: pkg.id,
        userId: authResult.userId,
        machineId,
      },
    },
    update: {
      agents,
      modified,
      lastSeenAt: new Date(),
      ...sourceFields,
    },
    create: {
      packageId: pkg.id,
      userId: authResult.userId,
      machineId,
      agents,
      modified,
      ...sourceFields,
    },
  })

  return NextResponse.json({ id: report.id })
}
