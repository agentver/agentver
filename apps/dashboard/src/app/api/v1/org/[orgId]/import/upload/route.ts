import { createLogger } from '@agentver/shared'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { logAudit } from '@/lib/audit/logger'
import { authenticateRequest } from '@/lib/auth/api-auth'
import type { ImportFile } from '@/lib/import/shared'
import {
  commitImportedFiles,
  ImportError,
  validateImportFiles,
  validateTargetPath,
} from '@/lib/import/shared'

const logger = createLogger('api:org:import:upload')

type RouteContext = {
  params: Promise<{ orgId: string }>
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const uploadFileSchema = z.object({
  name: z.string().min(1).max(255),
  content: z.string().min(1),
  encoding: z.enum(['base64', 'utf-8']).default('utf-8'),
})

const uploadSchema = z.object({
  files: z.array(uploadFileSchema).min(1).max(50),
  targetPath: z.string().min(1),
  commitMessage: z.string().optional(),
})

// ---------------------------------------------------------------------------
// POST — Upload files directly into the skills repo
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/org/[orgId]/import/upload
 * Accept file content directly and commit to the org's skills repo.
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

  const parsed = uploadSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { files: rawFiles, targetPath, commitMessage } = parsed.data

  // Validate target path
  const pathValidation = validateTargetPath(targetPath)
  if (!pathValidation.valid) {
    return NextResponse.json(
      { error: 'Invalid target path', details: pathValidation.errors },
      { status: 400 }
    )
  }

  try {
    // Decode base64 files and normalise to ImportFile[]
    const files: ImportFile[] = rawFiles.map((file) => {
      let content: string

      if (file.encoding === 'base64') {
        try {
          content = Buffer.from(file.content, 'base64').toString('utf-8')
        } catch {
          throw new ImportError(`Failed to decode base64 content for file "${file.name}"`)
        }
      } else {
        content = file.content
      }

      return { name: file.name, content }
    })

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
      commitMessage ?? `import: upload files to ${targetPath}`,
      authResult.userId,
      {
        provider: 'upload',
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
        provider: 'upload',
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

    logger.error('Upload import failed', {
      orgId,
      targetPath,
      fileCount: rawFiles.length,
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json({ error: 'Failed to upload and commit files' }, { status: 502 })
  }
}
