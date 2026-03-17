import { prisma } from '@agentver/database'
import { type FileManifestEntry, fileManifestSchema } from '@agentver/shared'
import { NextResponse } from 'next/server'

type ResourceCategory = 'scripts' | 'references' | 'assets' | 'other'

type CategorisedResource = {
  category: ResourceCategory
  path: string
  size: number
  contentType: string
}

function categoriseFile(filePath: string): ResourceCategory {
  if (filePath.startsWith('scripts/')) return 'scripts'
  if (filePath.startsWith('references/')) return 'references'
  if (filePath.startsWith('assets/')) return 'assets'
  return 'other'
}

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
      id: true,
      versions: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          version: true,
          fileManifest: true,
          size: true,
        },
      },
    },
  })

  if (!pkg) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const latestVersion = pkg.versions[0]
  if (!latestVersion) {
    return NextResponse.json({
      version: null,
      resources: [],
      totalSize: 0,
    })
  }

  // Parse the file manifest from the version
  const parsed = fileManifestSchema.safeParse(latestVersion.fileManifest)

  if (!parsed.success) {
    // If the manifest doesn't conform to the schema, return empty
    return NextResponse.json({
      version: latestVersion.version,
      resources: [],
      totalSize: latestVersion.size,
    })
  }

  const manifest = parsed.data

  // Exclude the entry file — the instructions endpoint serves that
  const resourceFiles = manifest.files.filter(
    (f: FileManifestEntry) => f.path !== manifest.entryFile
  )

  const resources: CategorisedResource[] = resourceFiles.map((f: FileManifestEntry) => ({
    category: categoriseFile(f.path),
    path: f.path,
    size: f.size,
    contentType: f.contentType,
  }))

  return NextResponse.json({
    version: latestVersion.version,
    resources,
    totalSize: manifest.totalSize,
  })
}
