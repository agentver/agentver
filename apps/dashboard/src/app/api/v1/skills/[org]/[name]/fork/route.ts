import { prisma } from '@agentver/database'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest } from '@/lib/auth/api-auth'

const forkSchema = z.object({
  targetOrgSlug: z.string().min(1, 'Target organisation slug is required'),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ org: string; name: string }> }
) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  if (!authResult.scopes.includes('WRITE')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = forkSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { org, name } = await params
  const { targetOrgSlug } = parsed.data

  const sourcePkg = await prisma.package.findFirst({
    where: {
      name,
      organisation: { slug: org },
    },
    include: {
      organisation: {
        include: { members: { where: { userId: authResult.userId } } },
      },
      versions: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { fileManifest: true },
      },
    },
  })

  if (!sourcePkg) {
    return NextResponse.json({ error: 'Package not found' }, { status: 404 })
  }

  const isPublic = sourcePkg.visibility === 'PUBLIC'
  const isMemberOfSource = sourcePkg.organisation.members.length > 0
  if (!isPublic && !isMemberOfSource) {
    return NextResponse.json({ error: 'No access to source package' }, { status: 403 })
  }

  const targetOrg = await prisma.organisation.findUnique({
    where: { slug: targetOrgSlug },
    include: {
      members: { where: { userId: authResult.userId } },
    },
  })

  if (!targetOrg) {
    return NextResponse.json({ error: 'Target organisation not found' }, { status: 404 })
  }

  if (targetOrg.members.length === 0) {
    return NextResponse.json({ error: 'Not a member of target organisation' }, { status: 403 })
  }

  const existingName = await prisma.package.findFirst({
    where: { name: sourcePkg.name, organisationId: targetOrg.id },
  })
  const forkName = existingName ? `${sourcePkg.name}-fork` : sourcePkg.name
  const forkSlug = `${targetOrg.slug}/${forkName}`

  const forkedPkg = await prisma.package.create({
    data: {
      name: forkName,
      slug: forkSlug,
      description: sourcePkg.description,
      type: sourcePkg.type,
      visibility: 'PRIVATE',
      tags: sourcePkg.tags,
      readme: sourcePkg.readme,
      organisationId: targetOrg.id,
      authorId: authResult.userId,
      forkedFromId: sourcePkg.id,
    },
    include: {
      organisation: { select: { slug: true, name: true } },
      forkedFrom: {
        select: {
          name: true,
          organisation: { select: { slug: true } },
        },
      },
    },
  })

  return NextResponse.json(forkedPkg, { status: 201 })
}
