import type { LinkMode, LockfileV2, ManifestV2, PackageSource } from '@agentver/shared'
import type { Scope } from '@agentver/storage'

// Re-export Scope under the installer's preferred alias
export type InstallScope = Scope

export type { LinkMode }

export type PackageType =
  | 'SKILL'
  | 'AGENT_CONFIG'
  | 'PLUGIN'
  | 'SCRIPT'
  | 'PROMPT'
  | 'BUNDLE'
  | 'AGENT'
  | 'COMMAND'

export type ConflictStrategy = 'error' | 'backup-and-replace' | 'skip' | 'force'

export type SecurityScanPolicy = 'require' | 'skip' | 'warn-only'

export type CanonicalCategory = 'skills' | 'agents' | 'commands'

// ---------------------------------------------------------------------------
// InstallRequest — the unified input from any surface
// ---------------------------------------------------------------------------

export type InstallTarget = {
  scope: InstallScope
  projectRoot: string
  agents: string[]
}

export type InstallPolicy = {
  conflictStrategy: ConflictStrategy
  preferredLinkMode: LinkMode
  allowFallback: boolean
  dryRun: boolean
  persist: boolean
  securityScanPolicy: SecurityScanPolicy
}

export type InstallMetadata = {
  customPath?: string
  entryFile?: string
  dependsOn?: string[]
  conflictsWith?: string[]
  bundleParentKey?: string
  isUpdate?: boolean
}

export type InstallRequest = {
  packageKey: string
  displayName: string
  packageType: PackageType
  source: PackageSource
  files: Array<{ path: string; content: string }>
  integrity: string
  target: InstallTarget
  policy: InstallPolicy
  metadata?: InstallMetadata
}

// ---------------------------------------------------------------------------
// InstallPlan — what the planner produces
// ---------------------------------------------------------------------------

export type PlannedLinkMode = {
  mode: LinkMode
  isFallback: boolean
  fallbackReason?: string
}

export type PlacementOperation = {
  agentId: string
  destinationPath: string
  linkMode: PlannedLinkMode
}

export type DetectedConflict = {
  agentId: string
  path: string
  kind: 'file' | 'directory'
}

export type PlannedBackup = {
  originalPath: string
  reason: 'conflict-replace' | 'update-replace' | 'config-overwrite'
}

export type PlannedManifestEntry = {
  name: string
  source: PackageSource
  agents: string[]
  installedAt: string
  modified: boolean
  pinned?: boolean
  path?: string
  bundle?: string
  packageType?: PackageType
  entryFile?: string
  dependsOn?: string[]
  conflictsWith?: string[]
}

export type PlannedLockfileEntry = {
  name: string
  source: PackageSource
  integrity: string
  agents: string[]
  linkMode?: LinkMode
  degraded?: boolean
}

export type InstallPlan = {
  request: InstallRequest
  kind: 'fresh' | 'update'
  canonical: {
    path: string
    category: CanonicalCategory
  }
  placements: PlacementOperation[]
  conflicts: DetectedConflict[]
  backupsRequired: PlannedBackup[]
  manifestEntry: PlannedManifestEntry
  lockfileEntry: PlannedLockfileEntry
  skippedAgents: Array<{ agentId: string; reason: string }>
  skippedFiles: Array<{ path: string; reason: string }>
  executable: boolean
  blockedReason?: string
}

// ---------------------------------------------------------------------------
// InstallResult — what the executor returns
// ---------------------------------------------------------------------------

export type PlacementResult = {
  agentId: string
  destinationPath: string
  actualLinkMode: LinkMode
  fallbackUsed: boolean
  fallbackReason?: string
  success: boolean
  error?: string
}

export type BackupHandle = {
  id: string
  backupPath: string
  originalPaths: string[]
  cleanup: () => void
}

export type InstallResult = {
  success: boolean
  error?: {
    code: string
    message: string
  }
  packageKey: string
  displayName: string
  canonicalPath?: string
  placements: PlacementResult[]
  conflictsResolved: Array<{
    agentId: string
    path: string
    resolution: 'backed-up' | 'skipped' | 'overwritten'
  }>
  backups: BackupHandle[]
  manifestWritten: boolean
  lockfileWritten: boolean
  manifestEntry: PlannedManifestEntry
  lockfileEntry: PlannedLockfileEntry
  filesPlacedCount: number
  agentsInstalledCount: number
}

// ---------------------------------------------------------------------------
// Restore types
// ---------------------------------------------------------------------------

export type RestorePolicy = {
  projectRoot: string
  scope: InstallScope
  agents: string[]
  preferredLinkMode: LinkMode
  allowFallback: boolean
  force: boolean
  concurrency: number
  offline: boolean
  securityScanPolicy: SecurityScanPolicy
}

export type SourceClassification =
  | { kind: 'restorable'; fetchStrategy: 'git' | 'well-known' | 'platform' }
  | { kind: 'skip'; reason: string }

export type RestoreEntry = {
  packageKey: string
  displayName: string
  manifestEntry: ManifestV2['packages'][string]
  lockfileEntry?: LockfileV2['packages'][string]
  fetchStrategy: 'git' | 'well-known' | 'platform'
  alreadyInstalled: boolean
}

export type RestoreSkip = {
  packageKey: string
  displayName: string
  reason: string
}

export type RestorePlan = {
  toInstall: RestoreEntry[]
  upToDate: RestoreEntry[]
  toSkip: RestoreSkip[]
  agents: string[]
  policy: RestorePolicy
}

export type FetchedPackage = {
  files: Array<{ path: string; content: string }>
  integrity: string
}

export type RestoreFetcher = (entry: RestoreEntry) => Promise<FetchedPackage>

export type RestorePackageResult = {
  packageKey: string
  displayName: string
  status: 'installed' | 'up-to-date' | 'skipped' | 'failed' | 'integrity-mismatch'
  agents?: string[]
  filesPlacedCount?: number
  reason?: string
  expectedIntegrity?: string
  actualIntegrity?: string
  error?: string
}

export type RestoreResult = {
  packages: RestorePackageResult[]
  installedCount: number
  upToDateCount: number
  skippedCount: number
  failedCount: number
  success: boolean
}
