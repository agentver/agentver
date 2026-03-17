import { prisma } from '@agentver/database'
import { NextResponse } from 'next/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ org: string; name: string }> }
) {
  const { org, name } = await params

  const pkg = await prisma.package.findFirst({
    where: {
      name,
      organisation: { slug: org },
    },
    select: {
      isVerified: true,
      organisation: {
        select: {
          slug: true,
          name: true,
          isVerified: true,
        },
      },
      author: {
        select: {
          isVerifiedPublisher: true,
        },
      },
      versions: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          version: true,
          sha256: true,
          fileManifest: true,
        },
      },
    },
  })

  if (!pkg) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const latestVersion = pkg.versions[0]

  return NextResponse.json({
    isVerified: pkg.isVerified,
    publisherVerified: pkg.organisation.isVerified,
    publisherName: pkg.organisation.name,
    publisherSlug: pkg.organisation.slug,
    authorVerified: pkg.author.isVerifiedPublisher,
    latestVersion: latestVersion?.version ?? null,
    sha256: latestVersion?.sha256 ?? null,
  })
}
