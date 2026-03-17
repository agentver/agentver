import { prisma } from '@agentver/database'
import { getSpecComplianceLevel, type SpecComplianceLevel } from '@agentver/shared'
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
      visibility: 'PUBLIC',
    },
    select: {
      name: true,
      slug: true,
      description: true,
      type: true,
      tags: true,
      readme: true,
      versions: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          version: true,
          fileManifest: true,
          size: true,
          createdAt: true,
        },
      },
      _count: { select: { installationReports: true, forks: true } },
    },
  })

  if (!pkg) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const latestVersion = pkg.versions[0]

  // Extract compatibility and licence from the fileManifest metadata if available
  const manifest = latestVersion?.fileManifest as Record<string, unknown> | null
  const compatibility = extractStringArray(manifest, 'compatibility')
  const license = extractString(manifest, 'license')
  const metadata = extractStringRecord(manifest, 'metadata')

  // Determine spec compliance for SKILL types
  let specCompliance: SpecComplianceLevel | undefined
  if (pkg.type === 'SKILL' && pkg.readme) {
    specCompliance = getSpecComplianceLevel(pkg.readme)
  }

  return NextResponse.json({
    name: pkg.name,
    slug: pkg.slug,
    description: pkg.description,
    type: pkg.type,
    tags: pkg.tags,
    license: license ?? null,
    compatibility,
    metadata: metadata ?? null,
    specCompliance: specCompliance ?? null,
    version: latestVersion
      ? {
          version: latestVersion.version,
          size: latestVersion.size,
          createdAt: latestVersion.createdAt,
        }
      : null,
    downloads: pkg._count.installationReports,
    forks: pkg._count.forks,
  })
}

function extractStringArray(obj: Record<string, unknown> | null, key: string): string[] {
  if (!obj) return []
  const val = obj[key]
  if (!Array.isArray(val)) return []
  return val.filter((v): v is string => typeof v === 'string')
}

function extractString(obj: Record<string, unknown> | null, key: string): string | undefined {
  if (!obj) return undefined
  const val = obj[key]
  return typeof val === 'string' ? val : undefined
}

function extractStringRecord(
  obj: Record<string, unknown> | null,
  key: string
): Record<string, string> | undefined {
  if (!obj) return undefined
  const val = obj[key]
  if (typeof val !== 'object' || val === null || Array.isArray(val)) return undefined
  const record: Record<string, string> = {}
  for (const [k, v] of Object.entries(val)) {
    if (typeof v === 'string') {
      record[k] = v
    }
  }
  return Object.keys(record).length > 0 ? record : undefined
}
