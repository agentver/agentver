import { prisma } from '@agentver/database'
import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth/api-auth'

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  if (!authResult.scopes.includes('ADMIN')) {
    return NextResponse.json(
      { error: 'Insufficient permissions. ADMIN scope required.' },
      { status: 403 }
    )
  }

  const { slug } = await params
  const machineId = request.headers.get('x-machine-id')

  const pkg = await prisma.package.findFirst({
    where: {
      OR: [{ slug }, { name: slug }],
    },
  })

  if (!pkg) {
    return NextResponse.json({ error: 'Package not found' }, { status: 404 })
  }

  const whereClause = machineId
    ? {
        packageId_userId_machineId: {
          packageId: pkg.id,
          userId: authResult.userId,
          machineId,
        },
      }
    : undefined

  if (whereClause) {
    try {
      await prisma.installationReport.delete({ where: whereClause })
    } catch {
      return NextResponse.json({ error: 'Installation report not found' }, { status: 404 })
    }
  } else {
    await prisma.installationReport.deleteMany({
      where: {
        packageId: pkg.id,
        userId: authResult.userId,
      },
    })
  }

  return NextResponse.json({ success: true })
}
