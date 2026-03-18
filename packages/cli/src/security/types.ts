export type ScanSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'

export type ScanCategory =
  | 'DANGEROUS_COMMAND'
  | 'DATA_EXFILTRATION'
  | 'OBFUSCATED_CODE'
  | 'UNICODE_OBFUSCATION'
  | 'SUSPICIOUS_URL'
  | 'BINARY_FILE'
  | 'EXCESSIVE_SIZE'
  | 'CREDENTIAL_EXPOSURE'
  | 'CREDENTIAL_FILE'
  | 'PROMPT_INJECTION'
  | 'DISALLOWED_FILE_TYPE'
  | 'REMOTE_CODE_EXECUTION'

export type ScanFinding = {
  severity: ScanSeverity
  category: ScanCategory
  file: string
  line?: number
  message: string
  evidence?: string
}

export type ScanVerdict = 'PASS' | 'WARN' | 'BLOCK'

export type ScanResult = {
  verdict: ScanVerdict
  findings: ScanFinding[]
  scannedAt: string
  duration: number
  provider: string
}

export type ScanOptions = {
  skipAudit?: boolean
}

export type ScanRule = {
  id: string
  category: ScanCategory
  severity: ScanSeverity
  pattern: RegExp
  message: string
  fileGlob?: string
}
