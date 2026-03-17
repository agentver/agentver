import { createLogger } from '@agentver/shared'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { logAudit } from '@/lib/audit/logger'
import { authenticateRequest } from '@/lib/auth/api-auth'
import { fetchGoogleDriveFileContent, listGoogleDriveFiles } from '@/lib/import/google-drive'
import type { ImportFile } from '@/lib/import/shared'
import {
  commitImportedFiles,
  getProviderToken,
  ImportError,
  resolveOrgWithRepo,
  validateImportFiles,
  validateTargetPath,
} from '@/lib/import/shared'

const logger = createLogger('api:org:import:drive')

type RouteContext = {
  params: Promise<{ orgId: string }>
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const importDriveSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1).max(50),
  targetPath: z.string().min(1),
  commitMessage: z.string().optional(),
})

const listDriveSchema = z.object({
  folderId: z.string().optional(),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get a valid Google access token, refreshing if needed.
 * For now we rely on the stored access token; refresh can be added when
 * expiry tracking is in place.
 */
async function getGoogleAccessToken(userId: string): Promise<string> {
  const token = await getProviderToken(userId, 'GOOGLE')
  return token
}

// ---------------------------------------------------------------------------
// GET — List files from Google Drive
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/org/[orgId]/import/drive?folderId=...
 * List files from the user's Google Drive.
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
    const parsed = listDriveSchema.safeParse({
      folderId: searchParams.get('folderId') ?? undefined,
    })

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const accessToken = await getGoogleAccessToken(authResult.userId)
    const files = await listGoogleDriveFiles(accessToken, parsed.data.folderId)

    return NextResponse.json({ files })
  } catch (error) {
    if (error instanceof ImportError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }

    logger.error('Failed to list Google Drive files', {
      orgId,
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json({ error: 'Failed to list Google Drive files' }, { status: 502 })
  }
}

// ---------------------------------------------------------------------------
// POST — Import files from Google Drive into the skills repo
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/org/[orgId]/import/drive
 * Fetch files from Google Drive and commit them to the org's skills repo.
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

  const parsed = importDriveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { fileIds, targetPath, commitMessage } = parsed.data

  // Validate target path
  const pathValidation = validateTargetPath(targetPath)
  if (!pathValidation.valid) {
    return NextResponse.json(
      { error: 'Invalid target path', details: pathValidation.errors },
      { status: 400 }
    )
  }

  try {
    // Get Google access token
    const accessToken = await getGoogleAccessToken(authResult.userId)

    // Fetch all file contents from Drive
    const files: ImportFile[] = []

    for (const fileId of fileIds) {
      // Fetch metadata to get the file name
      const metaResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        }
      )

      if (!metaResponse.ok) {
        throw new ImportError(
          `Failed to fetch metadata for Google Drive file ${fileId}: ${metaResponse.status}`,
          502
        )
      }

      const meta = (await metaResponse.json()) as { name: string; mimeType: string }
      const content = await fetchGoogleDriveFileContent(accessToken, fileId)

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
      commitMessage ?? `import: add files from Google Drive to ${targetPath}`,
      authResult.userId,
      {
        provider: 'google-drive',
        sourceId: fileIds.join(','),
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
        provider: 'google-drive',
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

    logger.error('Google Drive import failed', {
      orgId,
      fileIds,
      targetPath,
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json({ error: 'Failed to import files from Google Drive' }, { status: 502 })
  }
}
