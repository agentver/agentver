import { prisma } from '@agentver/database'
import { NextResponse } from 'next/server'
import { withCache } from '@/lib/redis/cache'

const PKG_CACHE_TTL = 120

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ org: string; name: string }> }
) {
  const { org, name } = await params

  const pkg = await withCache(`agentver:pkg:${org}:${name}`, PKG_CACHE_TTL, async () => {
    return prisma.package.findFirst({
      where: {
        name,
        organisation: { slug: org },
        visibility: 'PUBLIC',
      },
      include: {
        organisation: { select: { slug: true, name: true } },
        author: { select: { name: true, image: true } },
        versions: {
          orderBy: { createdAt: 'desc' },
          select: { version: true, changelog: true, createdAt: true, sha256: true },
        },
        _count: { select: { installationReports: true, forks: true } },
      },
    })
  })

  if (!pkg) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(pkg)
}
