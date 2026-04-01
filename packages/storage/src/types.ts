export type Scope = 'project' | 'global'

export type LockMode = 'exclusive' | 'advisory' | 'none'

export type LockOptions = {
  mode: LockMode
  /** Timeout before giving up (ms). Only applies to 'exclusive' mode. Default: 10_000. */
  acquireTimeoutMs?: number
  /** Retry interval between lock acquisition attempts (ms). Default: 50. */
  retryIntervalMs?: number
  /** Age after which a lock is considered stale (ms). Default: 30_000. */
  staleThresholdMs?: number
}

export type ReadOptions = {
  /** Called when entries are dropped during per-entry recovery. */
  onWarning?: (message: string) => void
}

export type ReadResult<T> = {
  data: T
}

export type StorageCallbacks = {
  onWarning?: (message: string) => void
  onDebug?: (message: string) => void
}

export type PackageLookupSuccess<T> = {
  ok: true
  key: string
  displayName: string
  pkg: T
}

export type PackageLookupFailure = {
  ok: false
  reason: 'not-found' | 'ambiguous'
  matches: string[]
}

export type PackageLookupResult<T> = PackageLookupSuccess<T> | PackageLookupFailure
