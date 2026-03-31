// --- Planning ---

// --- Backup ---
export { createFilesystemBackup, restoreFilesystemBackup } from './backup'
// --- Canonical path resolution ---
export {
  getCanonicalFilePath,
  getCanonicalSkillPath,
  getPlacementPathForCategory,
  isCanonicalInstall,
  isSymlink,
  resolveCanonicalCategory,
  resolvePlacementPath,
  resolveReadPath,
} from './canonical'
// --- Conflict detection ---
export { detectConflicts, isAgentverManagedSymlink } from './conflict'
// --- Execution ---
export { executeInstall, executeRestore, rollbackInstall } from './executor'
// --- Placement ---
export {
  createAgentPlacements,
  createCopy,
  createRelativeSymlink,
  removeAgentPlacements,
} from './placement'
export { classifySource, planInstall, planRestore } from './planner'

// --- Types ---
export type {
  BackupHandle,
  CanonicalCategory,
  ConflictStrategy,
  DetectedConflict,
  FetchedPackage,
  InstallMetadata,
  InstallPlan,
  InstallPolicy,
  InstallRequest,
  InstallResult,
  InstallScope,
  InstallTarget,
  LinkMode,
  PackageType,
  PlacementOperation,
  PlacementResult,
  PlannedBackup,
  PlannedLinkMode,
  PlannedLockfileEntry,
  PlannedManifestEntry,
  RestoreEntry,
  RestoreFetcher,
  RestorePackageResult,
  RestorePlan,
  RestorePolicy,
  RestoreResult,
  RestoreSkip,
  SecurityScanPolicy,
  SourceClassification,
} from './types'
