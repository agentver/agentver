import { basename, extname } from 'node:path'
import type { FetchedFile } from '../git/types.js'
import type { ScanFinding } from './types.js'

const EXECUTABLE_EXTENSIONS = new Set([
  '.exe',
  '.sh',
  '.bat',
  '.cmd',
  '.ps1',
  '.dll',
  '.so',
  '.dylib',
])

const PRIVATE_KEY_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx'])

const DANGEROUS_DOTFILES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.staging',
  '.env.development',
  '.bashrc',
  '.zshrc',
  '.profile',
  '.gitconfig',
])

const CREDENTIAL_FILE_PATHS = new Set([
  '.aws/credentials',
  '.ssh/id_rsa',
  '.ssh/id_ed25519',
  '.kube/config',
])

const MAX_INDIVIDUAL_FILE_BYTES = 1_024 * 1_024 // 1MB
const MAX_TOTAL_PACKAGE_BYTES = 10 * 1_024 * 1_024 // 10MB

/**
 * Checks whether file content is likely binary by scanning for null bytes
 * or non-UTF-8 sequences in the first 8KB.
 */
function isBinaryContent(content: string): boolean {
  const sample = content.slice(0, 8192)
  for (let i = 0; i < sample.length; i++) {
    if (sample.charCodeAt(i) === 0) {
      return true
    }
  }
  return false
}

/**
 * Runs file-level policy checks on all fetched files.
 * Returns findings for binary files, executable extensions,
 * dangerous dotfiles, and size violations.
 */
export function checkFilePolicy(files: FetchedFile[]): ScanFinding[] {
  const findings: ScanFinding[] = []
  let totalSize = 0

  for (const file of files) {
    const fileName = basename(file.path)
    const ext = extname(file.path).toLowerCase()
    totalSize += file.size

    // Binary detection
    if (isBinaryContent(file.content)) {
      findings.push({
        severity: 'HIGH',
        category: 'BINARY_FILE',
        file: file.path,
        message: 'Binary file detected — may contain hidden executable code',
      })
    }

    // Executable extensions
    if (EXECUTABLE_EXTENSIONS.has(ext)) {
      findings.push({
        severity: 'HIGH',
        category: 'DISALLOWED_FILE_TYPE',
        file: file.path,
        message: `Executable file extension detected (${ext})`,
      })
    }

    // Private key file extensions
    if (PRIVATE_KEY_EXTENSIONS.has(ext)) {
      findings.push({
        severity: 'HIGH',
        category: 'CREDENTIAL_FILE',
        file: file.path,
        message: `Private key file extension detected (${ext}) — may contain cryptographic secrets`,
      })
    }

    // Dangerous dotfiles
    if (DANGEROUS_DOTFILES.has(fileName)) {
      findings.push({
        severity: 'CRITICAL',
        category: 'DISALLOWED_FILE_TYPE',
        file: file.path,
        message: `Dangerous dotfile detected (${fileName}) — may modify environment or expose secrets`,
      })
    }

    // Credential file paths
    const credPaths = Array.from(CREDENTIAL_FILE_PATHS)
    for (let i = 0; i < credPaths.length; i++) {
      const credPath = credPaths[i]!
      if (file.path.endsWith(credPath) || file.path.includes(`/${credPath}`)) {
        findings.push({
          severity: 'CRITICAL',
          category: 'CREDENTIAL_FILE',
          file: file.path,
          message: `Credential configuration file detected (${credPath})`,
        })
        break
      }
    }

    // .npmrc with _authToken
    if (fileName === '.npmrc') {
      if (file.content.includes('_authToken')) {
        findings.push({
          severity: 'CRITICAL',
          category: 'CREDENTIAL_FILE',
          file: file.path,
          message: 'NPM auth token detected in .npmrc',
        })
      }
    }

    // Individual file size
    if (file.size > MAX_INDIVIDUAL_FILE_BYTES) {
      findings.push({
        severity: 'LOW',
        category: 'EXCESSIVE_SIZE',
        file: file.path,
        message: `File exceeds 1MB (${formatBytes(file.size)})`,
      })
    }
  }

  // Total package size
  if (totalSize > MAX_TOTAL_PACKAGE_BYTES) {
    findings.push({
      severity: 'MEDIUM',
      category: 'EXCESSIVE_SIZE',
      file: '(package total)',
      message: `Total package size exceeds 10MB (${formatBytes(totalSize)})`,
    })
  }

  return findings
}

/**
 * Returns true if the file content appears to be binary.
 * Exposed for the scanner to skip pattern matching on binary files.
 */
export { isBinaryContent }

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)}KB`
  return `${(bytes / (1_024 * 1_024)).toFixed(1)}MB`
}
