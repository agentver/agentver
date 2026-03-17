import { createLogger } from '@agentver/shared'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { logAudit } from '@/lib/audit/logger'
import { authenticateRequest } from '@/lib/auth/api-auth'
import { fetchOneDriveFileContent, listOneDriveFiles } from '@/lib/import/onedrive'
import type { ImportFile } from '@/lib/import/shared'
import {
  commitImportedFiles,
  getProviderToken,
  ImportError,
  resolveOrgWithRepo,
  validateImportFiles,
  validateTargetPath,
} from '@/lib/import/shared'

const logger = createLogger('api:org:import:onedrive')

type RouteContext = {
  params: Promise<{ orgId: string }>
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const importOneDriveSchema = z.object({
  itemIds: z.array(z.string().min(1)).min(1).max(50),
  targetPath: z.string().min(1),
  commitMessage: z.string().optional(),
})

const listOneDriveSchema = z.object({
  folderId: z.string().optional(),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0/me/drive'

/**
 * Get a valid Microsoft access token for the user.
 */
async function getMicrosoftAccessToken(userId: string): Promise<string> {
  const token = await getProviderToken(userId, 'MICROSOFT')
  return token
}

// ---------------------------------------------------------------------------
// GET — List files from OneDrive
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/org/[orgId]/import/onedrive?folderId=...
 * List files from the user's OneDrive.
 */
export async function GET(request: Request, { params }: RouteContext) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { orgId } = await params

  try {
    // Verify org membership
    await resolveOrgWithRepo(orgId, authResult.userId)

    const { searchParams } = new URL(request.url)
    const parsed = listOneDriveSchema.safeParse({
      folderId: searchParams.get('folderId') ?? undefined,
    })

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const accessToken = await getMicrosoftAccessToken(authResult.userId)
    const files = await listOneDriveFiles(accessToken, parsed.data.folderId)

    return NextResponse.json({ files })
  } catch (error) {
    if (error instanceof ImportError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }

    logger.error('Failed to list OneDrive files', {
      orgId,
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json({ error: 'Failed to list OneDrive files' }, { status: 502 })
  }
}

// ---------------------------------------------------------------------------
// POST — Import files from OneDrive into the skills repo
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/org/[orgId]/import/onedrive
 * Fetch files from OneDrive and commit them to the org's skills repo.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  if (!authResult.scopes.includes('WRITE')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { orgId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = importOneDriveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { itemIds, targetPath, commitMessage } = parsed.data

  // Validate target path
  const pathValidation = validateTargetPath(targetPath)
  if (!pathValidation.valid) {
    return NextResponse.json(
      { error: 'Invalid target path', details: pathValidation.errors },
      { status: 400 }
    )
  }

  try {
    // Get Microsoft access token
    const accessToken = await getMicrosoftAccessToken(authResult.userId)

    // Fetch all file contents from OneDrive
    const files: ImportFile[] = []

    for (const itemId of itemIds) {
      // Fetch metadata to get the file name
      const metaResponse = await fetch(`${GRAPH_BASE}/items/${itemId}?$select=name,file`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })

      if (!metaResponse.ok) {
        throw new ImportError(
          `Failed to fetch metadata for OneDrive item ${itemId}: ${metaResponse.status}`,
          502
        )
      }

      const meta = (await metaResponse.json()) as {
        name: string
        file?: { mimeType: string }
      }

      const content = await fetchOneDriveFileContent(accessToken, itemId)
      files.push({ name: meta.name, content })
    }

    // Validate files
    const fileValidation = validateImportFiles(files)
    if (!fileValidation.valid) {
      return NextResponse.json(
        { error: 'File validation failed', details: fileValidation.errors },
        { status: 400 }
      )
    }

    // Commit to skills repo and create records
    const result = await commitImportedFiles(
      orgId,
      files,
      targetPath,
      commitMessage ?? `import: add files from OneDrive to ${targetPath}`,
      authResult.userId,
      {
        provider: 'onedrive',
        sourceId: itemIds.join(','),
        importedAt: new Date().toISOString(),
        importedBy: authResult.userId,
      }
    )

    logAudit({
      userId: authResult.userId,
      action: 'IMPORT_COMPLETED',
      resource: 'package',
      resourceId: result.packageId,
      metadata: {
        provider: 'onedrive',
        fileCount: files.length,
        targetPath,
        commitSha: result.commitSha,
      },
    })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ImportError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }

    logger.error('OneDrive import failed', {
      orgId,
      itemIds,
      targetPath,
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json({ error: 'Failed to import files from OneDrive' }, { status: 502 })
  }
}
