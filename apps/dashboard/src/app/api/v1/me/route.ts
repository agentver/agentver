import { prisma } from '@agentver/database'
import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth/api-auth'

export async function GET(request: Request) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: authResult.userId },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      memberships: {
        select: {
          role: true,
          organisation: {
            select: {
              slug: true,
              name: true,
            },
          },
        },
      },
    },
  })

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    organisations: user.memberships.map((m) => ({
      slug: m.organisation.slug,
      name: m.organisation.name,
      role: m.role,
    })),
  })
}
