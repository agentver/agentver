export type AgentverErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHORISED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR'
  | 'RATE_LIMITED'
  | 'STORAGE_ERROR'
  | 'INTEGRITY_ERROR'
  | 'NO_FILES'
  | 'SECURITY_BLOCK'
  | 'AMBIGUOUS_SKILL'
  | 'CONFIRMATION_REQUIRED'
  | 'CANCELLED'
  | 'INSTALL_FAILED'
  | 'DEPENDENCY_MISSING'
  | 'CONFLICT_DETECTED'
  | 'BACKUP_FAILED'
  | 'RESTORE_FAILED'

export class AgentverError extends Error {
  readonly code: AgentverErrorCode

  constructor(code: AgentverErrorCode, message: string) {
    super(message)
    this.name = 'AgentverError'
    this.code = code
  }
}
