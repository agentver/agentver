import { prisma } from '@agentver/database'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest } from '@/lib/auth/api-auth'

function semverGt(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/-.+$/, '').split('.').map(Number)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false
  }
  return false
}

const checkUpdatesBodySchema = z.object({
  packages: z
    .array(
      z.object({
        name: z.string().min(1),
        version: z.string().min(1),
      })
    )
    .min(1),
})

export async function POST(request: Request) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const result = checkUpdatesBodySchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const packageList = result.data.packages
  const slugList = packageList.map((pkg) => pkg.name)

  const dbPackages = await prisma.package.findMany({
    where: { slug: { in: slugList } },
    include: {
      versions: {
        where: { status: { not: 'YANKED' } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { version: true },
      },
    },
  })

  const packagesBySlug = new Map(dbPackages.map((pkg) => [pkg.slug, pkg]))

  const updates: Array<{ name: string; current: string; latest: string }> = []

  for (const pkg of packageList) {
    const dbPackage = packagesBySlug.get(pkg.name)
    const latestVersion = dbPackage?.versions[0]?.version
    if (latestVersion && semverGt(latestVersion, pkg.version)) {
      updates.push({
        name: pkg.name,
        current: pkg.version,
        latest: latestVersion,
      })
    }
  }

  return NextResponse.json({ updates })
}
