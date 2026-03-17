import type { DetectedFileType } from '@agentver/agent-definitions'
import { createLogger } from '@agentver/shared'

const logger = createLogger('onedrive-import')

// ---------------------------------------------------------------------------
// Microsoft Graph / OneDrive API types
// ---------------------------------------------------------------------------

type GraphDriveItem = {
  id: string
  name: string
  file?: { mimeType: string }
  folder?: { childCount: number }
  size: number
  lastModifiedDateTime: string
  parentReference?: { id: string; path: string }
}

type GraphDriveItemCollection = {
  value: GraphDriveItem[]
  '@odata.nextLink'?: string
}

type MicrosoftTokenResponse = {
  access_token: string
  expires_in: number
  token_type: string
  scope: string
  refresh_token?: string
  error?: string
  error_description?: string
}

export type DriveItem = {
  id: string
  name: string
  mimeType: string
  isFolder: boolean
  size: number
  modifiedTime: string
}

export type ScannedOneDriveFile = {
  path: string
  name: string
  type: 'skill' | 'config' | 'rules'
  detectedType: DetectedFileType
  agentId: string
  itemId: string
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

export async function refreshMicrosoftToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const clientId = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Microsoft OAuth credentials not configured')
  }

  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: 'Files.Read.All offline_access',
    }),
  })

  if (!response.ok) {
    throw new Error(`Microsoft token refresh failed: ${response.status}`)
  }

  const data = (await response.json()) as MicrosoftTokenResponse

  if (data.error) {
    throw new Error(`Microsoft token refresh error: ${data.error_description ?? data.error}`)
  }

  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  }
}

// ---------------------------------------------------------------------------
// File listing
// ---------------------------------------------------------------------------

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0/me/drive'

export async function listOneDriveFiles(
  accessToken: string,
  folderId?: string
): Promise<DriveItem[]> {
  const items: DriveItem[] = []

  let url: string | undefined = folderId
    ? `${GRAPH_BASE}/items/${folderId}/children?$top=200&$select=id,name,file,folder,size,lastModifiedDateTime,parentReference`
    : `${GRAPH_BASE}/root/children?$top=200&$select=id,name,file,folder,size,lastModifiedDateTime,parentReference`

  while (url) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`OneDrive API error: ${response.status}`)
    }

    const data = (await response.json()) as GraphDriveItemCollection

    for (const item of data.value) {
      items.push({
        id: item.id,
        name: item.name,
        mimeType: item.file?.mimeType ?? (item.folder ? 'folder' : 'unknown'),
        isFolder: !!item.folder,
        size: item.size,
        modifiedTime: item.lastModifiedDateTime,
      })
    }

    url = data['@odata.nextLink']
  }

  return items
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

function isMarkdownLike(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    lower.endsWith('.md') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.yaml') ||
    lower.endsWith('.yml')
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

export type OneDriveScanResult = {
  files: ScannedOneDriveFile[]
  skippedPaths: string[]
}

export async function scanOneDriveFolder(
  accessToken: string,
  folderId: string
): Promise<OneDriveScanResult> {
  const foundFiles: ScannedOneDriveFile[] = []
  const skippedPaths: string[] = []

  async function scanDirectory(dirId: string, pathPrefix: string): Promise<void> {
    const entries = await listOneDriveFiles(accessToken, dirId)

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
          itemId: entry.id,
        })
        continue
      }

      // Include markdown-like files as potential skills
      if (isMarkdownLike(entry.name)) {
        foundFiles.push({
          path: fullPath,
          name: entry.name,
          type: 'skill',
          detectedType: 'SKILL',
          agentId: 'generic',
          itemId: entry.id,
        })
      }
    }
  }

  await scanDirectory(folderId, '')

  if (skippedPaths.length > 0) {
    logger.warn(
      `Skipped ${skippedPaths.length} directories beyond depth limit in OneDrive folder ${folderId}`,
      {
        skippedPaths,
      }
    )
  }

  logger.info(`Scanned OneDrive folder ${folderId}`, { filesFound: foundFiles.length })
  return { files: foundFiles, skippedPaths }
}

// ---------------------------------------------------------------------------
// File content download
// ---------------------------------------------------------------------------

export async function fetchOneDriveFileContent(
  accessToken: string,
  itemId: string
): Promise<string> {
  const response = await fetch(`${GRAPH_BASE}/items/${itemId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch file from OneDrive: ${response.status}`)
  }

  return response.text()
}
