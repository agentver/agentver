export type DetectedFileType =
  | 'SKILL'
  | 'AGENT_CONFIG'
  | 'PLUGIN'
  | 'SCRIPT'
  | 'PROMPT'
  | 'AGENT'
  | 'COMMAND'

export type ScannedFile = {
  path: string
  name: string
  type: 'skill' | 'config' | 'rules'
  detectedType: DetectedFileType
  agentId: string
  downloadUrl: string
  preview: string | null
  /** Provider-specific project or repository identifier */
  projectId?: number
  /** Git ref (branch or tag) to fetch from */
  ref?: string
}

export type ImportResult = {
  imported: Array<{ path: string; packageId: string; name: string }>
  errors: Array<{ path: string; error: string }>
  syncStatus?: 'active' | 'failed' | 'not_requested'
}
