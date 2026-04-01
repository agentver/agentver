// --- Re-exports from @agentver/shared ---
export type {
  GitSource,
  LocalSource,
  LockfileV2,
  LockfileV2Package,
  ManifestV2,
  ManifestV2Package,
  PackageSource,
  PlatformSource,
  UnknownSource,
  WellKnownSource,
} from '@agentver/shared'
// --- Errors ---
export {
  IntegrityError,
  StorageCorruptionError,
  StorageLockError,
  TransactionRecoveryError,
} from './errors'
// --- Locking ---
export { acquireLock, withStorageLock } from './file-lock'
// --- File paths ---
export {
  ensureStorageDir,
  getLockfilePath,
  getManifestPath,
  getStorageRoot,
  getStorageTransactionPath,
  writeJsonFileAtomic,
} from './files'
// --- Integrity ---
export {
  computeIntegrity,
  computeIntegrityFromBuffer,
  deriveCommitFromIntegrity,
  verifyIntegrity,
} from './integrity'
export { readLockfile, updateLockfile, writeLockfile } from './lockfile'
export { readManifest, updateManifest, writeManifest } from './manifest'
// --- Package identity ---
export {
  createStablePackageKey,
  getDisplayName,
  getTrackedSourceCommit,
  getTrackedSourceRef,
  isPlatformManagedSource,
  resolveBundleDisplayName,
  resolvePackageQuery,
  setLockfilePackage,
  setManifestPackage,
  toPlatformSource,
} from './package-identity'
// --- Writing (paired) ---
export { updateManifestAndLockfile } from './pair'
// --- Serialisation ---
export { serialiseDeterministic } from './serialise'
// --- Transaction recovery ---
export { recoverPendingStorageTransaction, writeStorageTransaction } from './transaction'
// --- Types ---
export type {
  LockMode,
  LockOptions,
  PackageLookupFailure,
  PackageLookupResult,
  PackageLookupSuccess,
  ReadOptions,
  ReadResult,
  Scope,
  StorageCallbacks,
} from './types'
