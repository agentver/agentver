import { prisma } from '@agentver/database'
import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth/api-auth'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ org: string; name: string; version: string }> }
) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { org, name, version } = await params

  const pkg = await prisma.package.findFirst({
    where: { name, organisation: { slug: org } },
    select: {
      id: true,
      readme: true,
      gitUri: true,
      gitPath: true,
    },
  })

  if (!pkg) {
    return NextResponse.json({ error: 'Package not found' }, { status: 404 })
  }

  const pkgVersion = await prisma.packageVersion.findFirst({
    where: { packageId: pkg.id, version },
    select: {
      version: true,
      fileManifest: true,
      sha256: true,
      size: true,
      gitRef: true,
      gitCommitSha: true,
      createdAt: true,
    },
  })

  if (!pkgVersion) {
    return NextResponse.json({ error: 'Version not found' }, { status: 404 })
  }

  return NextResponse.json({
    version: pkgVersion.version,
    content: pkg.readme ?? null,
    fileManifest: pkgVersion.fileManifest,
    sha256: pkgVersion.sha256,
    size: pkgVersion.size,
    gitRef: pkgVersion.gitRef,
    gitCommitSha: pkgVersion.gitCommitSha,
    gitUri: pkg.gitUri,
    gitPath: pkg.gitPath,
    createdAt: pkgVersion.createdAt,
  })
}
