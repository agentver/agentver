import type { DetectedFileType } from '@agentver/agent-definitions'
import { createLogger } from '@agentver/shared'

const logger = createLogger('google-drive-import')

// ---------------------------------------------------------------------------
// Google Drive API types
// ---------------------------------------------------------------------------

type GoogleDriveFile = {
  id: string
  name: string
  mimeType: string
  parents?: string[]
  modifiedTime: string
  size?: string
}

type GoogleDriveFileList = {
  files: GoogleDriveFile[]
  nextPageToken?: string
}

type GoogleTokenResponse = {
  access_token: string
  expires_in: number
  token_type: string
  scope: string
  refresh_token?: string
}

export type DriveFile = {
  id: string
  name: string
  mimeType: string
  isFolder: boolean
  modifiedTime: string
  size: number
}

export type ScannedDriveFile = {
  path: string
  name: string
  type: 'skill' | 'config' | 'rules'
  detectedType: DetectedFileType
  agentId: string
  fileId: string
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

export async function refreshGoogleToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials not configured')
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    throw new Error(`Google token refresh failed: ${response.status}`)
  }

  const data = (await response.json()) as GoogleTokenResponse
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  }
}

// ---------------------------------------------------------------------------
// File listing
// ---------------------------------------------------------------------------

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'
const GOOGLE_DOC_MIME_TYPE = 'application/vnd.google-apps.document'
const GOOGLE_SHEET_MIME_TYPE = 'application/vnd.google-apps.spreadsheet'
const GOOGLE_SLIDES_MIME_TYPE = 'application/vnd.google-apps.presentation'

export async function listGoogleDriveFiles(
  accessToken: string,
  folderId?: string
): Promise<DriveFile[]> {
  const files: DriveFile[] = []
  let pageToken: string | undefined

  const parentQuery = folderId ? `'${folderId}' in parents` : `'root' in parents`
  const query = `${parentQuery} and trashed = false`

  do {
    const params = new URLSearchParams({
      q: query,
      fields: 'nextPageToken,files(id,name,mimeType,parents,modifiedTime,size)',
      pageSize: '100',
      orderBy: 'folder,name',
    })

    if (pageToken) {
      params.set('pageToken', pageToken)
    }

    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`Google Drive API error: ${response.status}`)
    }

    const data = (await response.json()) as GoogleDriveFileList

    for (const file of data.files) {
      files.push({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        isFolder: file.mimeType === FOLDER_MIME_TYPE,
        modifiedTime: file.modifiedTime,
        size: file.size ? parseInt(file.size, 10) : 0,
      })
    }

    pageToken = data.nextPageToken
  } while (pageToken)

  return files
}

// ---------------------------------------------------------------------------
// Folder scanning — looks for agent config and skill files
// ---------------------------------------------------------------------------

const CONFIG_FILE_NAMES: Array<{ name: string; agentId: string }> = [
  { name: 'CLAUDE.md', agentId: 'claude-code' },
  { name: 'AGENTS.md', agentId: 'codex' },
  { name: 'GEMINI.md', agentId: 'gemini' },
  { name: '.cursorrules', agentId: 'cursor' },
  { name: '.windsurfrules', agentId: 'windsurf' },
  { name: 'copilot-instructions.md', agentId: 'copilot' },
  { name: 'guidelines.md', agentId: 'junie' },
  { name: 'config.yaml', agentId: 'goose' },
  { name: '.aider.conf.yml', agentId: 'aider' },
]

function isMarkdownLike(file: GoogleDriveFile): boolean {
  if (file.mimeType === GOOGLE_DOC_MIME_TYPE) {
    return true
  }

  const name = file.name.toLowerCase()
  return (
    name.endsWith('.md') || name.endsWith('.txt') || name.endsWith('.yaml') || name.endsWith('.yml')
  )
}

function detectConfigFile(
  fileName: string
): { type: 'config' | 'rules'; detectedType: DetectedFileType; agentId: string } | null {
  const match = CONFIG_FILE_NAMES.find((c) => c.name.toLowerCase() === fileName.toLowerCase())

  if (match) {
    return { type: 'config', detectedType: 'AGENT_CONFIG', agentId: match.agentId }
  }

  return null
}

export type GoogleDriveScanResult = {
  files: ScannedDriveFile[]
  skippedPaths: string[]
}

export async function scanGoogleDriveFolder(
  accessToken: string,
  folderId: string
): Promise<GoogleDriveScanResult> {
  const foundFiles: ScannedDriveFile[] = []
  const skippedPaths: string[] = []

  async function scanDirectory(dirId: string, pathPrefix: string): Promise<void> {
    const entries = await listGoogleDriveFiles(accessToken, dirId)

    for (const entry of entries) {
      const fullPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name

      if (entry.isFolder) {
        if (pathPrefix.split('/').length < 4) {
          await scanDirectory(entry.id, fullPath)
        } else {
          skippedPaths.push(fullPath)
        }
        continue
      }

      // Check for known config files
      const configMatch = detectConfigFile(entry.name)
      if (configMatch) {
        foundFiles.push({
          path: fullPath,
          name: entry.name,
          type: configMatch.type,
          detectedType: configMatch.detectedType,
          agentId: configMatch.agentId,
          fileId: entry.id,
        })
        continue
      }

      // Include markdown-like files as potential skills
      if (
        isMarkdownLike({
          id: entry.id,
          name: entry.name,
          mimeType: entry.mimeType,
          modifiedTime: entry.modifiedTime,
        })
      ) {
        foundFiles.push({
          path: fullPath,
          name: entry.name,
          type: 'skill',
          detectedType: 'SKILL',
          agentId: 'generic',
          fileId: entry.id,
        })
      }
    }
  }

  await scanDirectory(folderId, '')

  if (skippedPaths.length > 0) {
    logger.warn(
      `Skipped ${skippedPaths.length} directories beyond depth limit in Google Drive folder ${folderId}`,
      {
        skippedPaths,
      }
    )
  }

  logger.info(`Scanned Google Drive folder ${folderId}`, { filesFound: foundFiles.length })
  return { files: foundFiles, skippedPaths }
}

// ---------------------------------------------------------------------------
// File content download
// ---------------------------------------------------------------------------

export async function fetchGoogleDriveFileContent(
  accessToken: string,
  fileId: string
): Promise<string> {
  // First check if it's a Google Doc — those need to be exported as plain text
  const metaResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=mimeType`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    }
  )

  if (!metaResponse.ok) {
    throw new Error(`Failed to fetch file metadata from Google Drive: ${metaResponse.status}`)
  }

  const meta = (await metaResponse.json()) as { mimeType: string }

  let downloadUrl: string

  if (meta.mimeType === GOOGLE_DOC_MIME_TYPE) {
    // Export Google Docs as plain text
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`
  } else if (meta.mimeType === GOOGLE_SHEET_MIME_TYPE) {
    // Export Google Sheets as CSV
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`
  } else if (meta.mimeType === GOOGLE_SLIDES_MIME_TYPE) {
    // Export Google Slides as plain text
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`
  } else {
    // Download binary/text files directly
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
  }

  const response = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch file from Google Drive: ${response.status}`)
  }

  return response.text()
}
