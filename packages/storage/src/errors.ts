/**
 * Manifest or lockfile on disk is corrupt.
 * Not thrown for missing files (that is expected on first run).
 * Thrown when the file exists but contains invalid JSON or fails
 * schema validation with zero recoverable entries.
 */
export class StorageCorruptionError extends Error {
  override readonly name = 'StorageCorruptionError'
  readonly filePath: string
  readonly reason: 'invalid-json' | 'schema-validation-failed'

  constructor(filePath: string, reason: 'invalid-json' | 'schema-validation-failed') {
    const detail =
      reason === 'invalid-json'
        ? 'could not parse JSON'
        : 'schema validation failed with zero recoverable entries'
    super(`Corrupt storage file at ${filePath} — ${detail}`)
    this.filePath = filePath
    this.reason = reason
  }
}

/**
 * Could not acquire the file lock within the configured timeout.
 * Only thrown in 'exclusive' lock mode.
 */
export class StorageLockError extends Error {
  override readonly name = 'StorageLockError'
  readonly lockPath: string
  readonly holderPid: number | undefined
  readonly timeoutMs: number

  constructor(lockPath: string, holderPid: number | undefined, timeoutMs: number) {
    const holderInfo = holderPid !== undefined ? ` (held by pid ${holderPid})` : ''
    super(
      `Could not acquire storage lock at ${lockPath}${holderInfo} within ${timeoutMs}ms. ` +
        'Another agentver process may be running. ' +
        `If this is a mistake, remove the lock file manually: ${lockPath}`
    )
    this.lockPath = lockPath
    this.holderPid = holderPid
    this.timeoutMs = timeoutMs
  }
}

/**
 * Computed integrity hash does not match expected value.
 * Indicates file tampering or a bug in the registry.
 */
export class IntegrityError extends Error {
  override readonly name = 'IntegrityError'
  readonly packageName: string
  readonly expected: string
  readonly actual: string

  constructor(packageName: string, expected: string, actual: string) {
    super(`Integrity check failed for "${packageName}": expected ${expected}, got ${actual}`)
    this.packageName = packageName
    this.expected = expected
    this.actual = actual
  }
}
