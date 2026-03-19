export type DetectedFileType = 'SKILL' | 'AGENT_CONFIG' | 'PLUGIN' | 'SCRIPT' | 'PROMPT'

export type ScannedFile = {
  path: string
  name: string
  type: 'skill' | 'config' | 'rules'
  detectedType: DetectedFileType
  agentId: string
  downloadUrl: string
  preview: string | null
  /** GitLab-specific: the project ID within GitLab */
  projectId?: number
  /** GitLab-specific: the git ref (branch/tag) */
  ref?: string
}

export type ImportResult = {
  imported: Array<{ path: string; packageId: string; name: string }>
  errors: Array<{ path: string; error: string }>
  syncStatus?: 'active' | 'failed' | 'not_requested'
}
