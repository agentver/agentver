import { prisma } from '@agentver/database'
import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth/api-auth'

type RouteParams = { params: Promise<{ org: string; name: string }> }

async function findPackageByOrgAndName(org: string, name: string) {
  return prisma.package.findFirst({
    where: {
      name,
      organisation: { slug: org },
    },
    select: {
      id: true,
      visibility: true,
      organisationId: true,
      starCount: true,
    },
  })
}

export async function PUT(request: Request, { params }: RouteParams) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { org, name } = await params
  const pkg = await findPackageByOrgAndName(org, name)

  if (!pkg) {
    return NextResponse.json({ error: 'Package not found' }, { status: 404 })
  }

  await prisma.$transaction(async (tx) => {
    await tx.star.upsert({
      where: {
        userId_packageId: {
          userId: authResult.userId,
          packageId: pkg.id,
        },
      },
      create: {
        userId: authResult.userId,
        packageId: pkg.id,
      },
      update: {},
    })

    // Sync starCount with actual star records
    const count = await tx.star.count({
      where: { packageId: pkg.id },
    })

    await tx.package.update({
      where: { id: pkg.id },
      data: { starCount: count },
    })
  })

  const count = await prisma.star.count({
    where: { packageId: pkg.id },
  })

  return NextResponse.json({ starred: true, count })
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { org, name } = await params
  const pkg = await findPackageByOrgAndName(org, name)

  if (!pkg) {
    return NextResponse.json({ error: 'Package not found' }, { status: 404 })
  }

  const existing = await prisma.star.findUnique({
    where: {
      userId_packageId: {
        userId: authResult.userId,
        packageId: pkg.id,
      },
    },
  })

  if (existing) {
    await prisma.$transaction(async (tx) => {
      await tx.star.delete({
        where: {
          userId_packageId: {
            userId: authResult.userId,
            packageId: pkg.id,
          },
        },
      })

      const count = await tx.star.count({
        where: { packageId: pkg.id },
      })

      await tx.package.update({
        where: { id: pkg.id },
        data: { starCount: count },
      })
    })
  }

  const count = await prisma.star.count({
    where: { packageId: pkg.id },
  })

  return NextResponse.json({ starred: false, count })
}

export async function GET(request: Request, { params }: RouteParams) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { org, name } = await params
  const pkg = await findPackageByOrgAndName(org, name)

  if (!pkg) {
    return NextResponse.json({ error: 'Package not found' }, { status: 404 })
  }

  const star = await prisma.star.findUnique({
    where: {
      userId_packageId: {
        userId: authResult.userId,
        packageId: pkg.id,
      },
    },
  })

  const count = await prisma.star.count({
    where: { packageId: pkg.id },
  })

  return NextResponse.json({ starred: !!star, count })
}
