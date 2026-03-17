import type { PackageType } from '@agentver/database'
import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { decryptToken, TokenDecryptionError } from '@/lib/crypto/token-encryption'
import { commitFiles, getDefaultBranch } from '@/lib/github/skills-repo'

const logger = createLogger('import:shared')

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 1_048_576 // 1 MB
const MAX_FILE_COUNT = 50

const ALLOWED_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.yaml',
  '.yml',
  '.json',
  '.toml',
  '.py',
  '.ts',
  '.js',
  '.sh',
  '.bash',
  '.zsh',
  '.css',
  '.html',
  '.xml',
  '.csv',
  '.conf',
  '.cfg',
  '.ini',
  '.env.example',
  '.gitignore',
  '.cursorrules',
  '.windsurfrules',
])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImportFile = {
  name: string
  content: string
}

export type ImportResult = {
  commitSha: string
  branch: string
  packageId: string
  versionId: string
  filesCommitted: number
}

export type ImportOrigin = {
  provider: 'google-drive' | 'onedrive' | 'upload'
  sourceId?: string
  importedAt: string
  importedBy: string
}

export type ValidationResult = {
  valid: boolean
  errors: string[]
}

// ---------------------------------------------------------------------------
// File name sanitisation
// ---------------------------------------------------------------------------

/**
 * Sanitise a file name to a safe kebab-case form.
 * Strips special characters, collapses whitespace, and lowercases.
 */
export function sanitiseFileName(name: string): string {
  // Separate extension
  const lastDot = name.lastIndexOf('.')
  const hasExtension = lastDot > 0
  const baseName = hasExtension ? name.slice(0, lastDot) : name
  const extension = hasExtension ? name.slice(lastDot).toLowerCase() : ''

  const sanitised = baseName
    .toLowerCase()
    .replace(/[^a-z0-9\s._-]/g, '') // Remove special chars
    .replace(/[\s._]+/g, '-') // Collapse whitespace/dots/underscores to hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, '') // Trim leading/trailing hyphens

  if (!sanitised) {
    return `untitled${extension}`
  }

  return `${sanitised}${extension}`
}

// ---------------------------------------------------------------------------
// Skill type detection
// ---------------------------------------------------------------------------

const CONFIG_FILE_NAMES = new Set([
  'claude.md',
  'agents.md',
  'gemini.md',
  '.cursorrules',
  '.windsurfrules',
  'copilot-instructions.md',
  'guidelines.md',
  'config.yaml',
  '.aider.conf.yml',
])

/**
 * Detect the package type from the imported files.
 * If any file matches a known agent config name, it's an AGENT_CONFIG.
 * Otherwise, default to SKILL.
 */
export function detectSkillType(files: Array<{ name: string }>): PackageType {
  for (const file of files) {
    if (CONFIG_FILE_NAMES.has(file.name.toLowerCase())) {
      return 'AGENT_CONFIG'
    }
  }
  return 'SKILL'
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a path segment to prevent path traversal attacks.
 */
function isPathSafe(path: string): boolean {
  const segments = path.split('/')
  for (const segment of segments) {
    if (segment === '..' || segment === '.' || segment === '') {
      return false
    }
    // Block hidden files/directories (except explicitly allowed config files)
    if (segment.startsWith('.') && !CONFIG_FILE_NAMES.has(segment.toLowerCase())) {
      return false
    }
  }
  return true
}

/**
 * Validate import files before committing.
 */
export function validateImportFiles(files: ImportFile[]): ValidationResult {
  const errors: string[] = []

  if (files.length === 0) {
    errors.push('No files provided')
    return { valid: false, errors }
  }

  if (files.length > MAX_FILE_COUNT) {
    errors.push(`Too many files. Maximum is ${MAX_FILE_COUNT}, received ${files.length}.`)
    return { valid: false, errors }
  }

  for (const file of files) {
    if (!file.name || file.name.trim().length === 0) {
      errors.push('File name cannot be empty')
      continue
    }

    const sizeBytes = Buffer.byteLength(file.content, 'utf-8')
    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      errors.push(
        `File "${file.name}" exceeds the maximum size of 1 MB (${Math.round(sizeBytes / 1024)} KB)`
      )
    }

    // Check extension
    const lastDot = file.name.lastIndexOf('.')
    if (lastDot > 0) {
      const ext = file.name.slice(lastDot).toLowerCase()
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        errors.push(`File "${file.name}" has an unsupported extension: ${ext}`)
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Validate the target path for an import.
 */
export function validateTargetPath(targetPath: string): ValidationResult {
  const errors: string[] = []

  if (!targetPath || targetPath.trim().length === 0) {
    errors.push('Target path cannot be empty')
    return { valid: false, errors }
  }

  if (!isPathSafe(targetPath)) {
    errors.push(
      'Target path contains invalid segments (path traversal or hidden directories are not allowed)'
    )
    return { valid: false, errors }
  }

  if (targetPath.length > 256) {
    errors.push('Target path is too long (maximum 256 characters)')
    return { valid: false, errors }
  }

  return { valid: errors.length === 0, errors }
}

// ---------------------------------------------------------------------------
// Org + repo resolution helpers
// ---------------------------------------------------------------------------

type OrgWithRepo = {
  id: string
  name: string
  slug: string
  skillsRepoOwner: string
  skillsRepoName: string
  skillsRepoUrl: string
}

/**
 * Resolve the organisation, verify membership, and ensure a skills repo is connected.
 * Returns the org details or throws.
 */
export async function resolveOrgWithRepo(orgId: string, userId: string): Promise<OrgWithRepo> {
  const org = await prisma.organisation.findUnique({
    where: { id: orgId },
    include: {
      members: { where: { userId } },
    },
  })

  if (!org) {
    throw new ImportError('Organisation not found', 404)
  }

  const membership = org.members[0]
  if (!membership) {
    throw new ImportError('Not a member of this organisation', 403)
  }

  if (!org.skillsRepoUrl || !org.skillsRepoOwner || !org.skillsRepoName) {
    throw new ImportError('No skills repository connected for this organisation', 404)
  }

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    skillsRepoOwner: org.skillsRepoOwner,
    skillsRepoName: org.skillsRepoName,
    skillsRepoUrl: org.skillsRepoUrl,
  }
}

/**
 * Get a connected account token for a specific provider.
 */
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  GITHUB: 'GitHub',
  GITLAB: 'GitLab',
  BITBUCKET: 'Bitbucket',
  GOOGLE: 'Google',
  MICROSOFT: 'Microsoft',
}

export async function getProviderToken(
  userId: string,
  provider: 'GITHUB' | 'GITLAB' | 'BITBUCKET' | 'GOOGLE' | 'MICROSOFT'
): Promise<string> {
  const account = await prisma.connectedAccount.findUnique({
    where: {
      userId_provider: {
        userId,
        provider,
      },
    },
    select: { accessToken: true, refreshToken: true },
  })

  const providerName = PROVIDER_DISPLAY_NAMES[provider] ?? provider

  if (!account?.accessToken) {
    throw new ImportError(
      `No connected ${providerName} account. Please connect your ${providerName} account first.`,
      400
    )
  }

  try {
    return decryptToken(account.accessToken)
  } catch (error) {
    if (error instanceof TokenDecryptionError) {
      throw new ImportError(
        `Connected ${providerName} account credentials are invalid. Please reconnect your account.`,
        400
      )
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// Core commit + record creation
// ---------------------------------------------------------------------------

/**
 * Commit imported files to the org's skills repo and create Package + PackageVersion records.
 */
export async function commitImportedFiles(
  orgId: string,
  files: ImportFile[],
  targetPath: string,
  commitMessage: string,
  userId: string,
  importOrigin?: ImportOrigin
): Promise<ImportResult> {
  // Resolve org + repo
  const org = await resolveOrgWithRepo(orgId, userId)

  // Get the user's GitHub token (skills repos are on GitHub)
  const githubToken = await getProviderToken(userId, 'GITHUB')

  // Determine the default branch
  const defaultBranch = await getDefaultBranch(org.skillsRepoOwner, org.skillsRepoName, githubToken)

  // Build full file paths under the target path
  const commitFileInputs = files.map((file) => ({
    path: `${targetPath}/${sanitiseFileName(file.name)}`,
    content: file.content,
  }))

  // Commit to Git (non-transactional — must happen before DB writes)
  const commitResult = await commitFiles(
    org.skillsRepoOwner,
    org.skillsRepoName,
    commitFileInputs,
    commitMessage,
    defaultBranch,
    githubToken
  )

  // Derive a package name from the target path
  const packageName = targetPath.split('/').filter(Boolean).pop() ?? 'imported-skill'

  const packageSlug = sanitiseFileName(packageName)
  const packageType = detectSkillType(files)

  try {
    const { pkg, version } = await prisma.$transaction(async (tx) => {
      const pkg = await tx.package.upsert({
        where: {
          organisationId_name: {
            organisationId: orgId,
            name: packageName,
          },
        },
        update: {
          updatedAt: new Date(),
        },
        create: {
          name: packageName,
          slug: packageSlug,
          type: packageType,
          organisationId: orgId,
          authorId: userId,
          gitUri: `github.com/${org.skillsRepoOwner}/${org.skillsRepoName}`,
          gitPath: targetPath,
          gitDefaultRef: defaultBranch,
        },
      })

      const version = await tx.packageVersion.create({
        data: {
          packageId: pkg.id,
          version: `0.0.0+${commitResult.sha.slice(0, 7)}`,
          gitRef: defaultBranch,
          gitCommitSha: commitResult.sha,
          changelog: commitMessage,
          fileManifest: importOrigin
            ? { files: commitFileInputs.map((f) => f.path), importOrigin }
            : { files: commitFileInputs.map((f) => f.path) },
        },
      })

      return { pkg, version }
    })

    logger.info('Import committed and recorded', {
      orgId,
      packageId: pkg.id,
      versionId: version.id,
      commitSha: commitResult.sha,
      fileCount: files.length,
      targetPath,
    })

    return {
      commitSha: commitResult.sha,
      branch: commitResult.branch,
      packageId: pkg.id,
      versionId: version.id,
      filesCommitted: files.length,
    }
  } catch (error) {
    logger.error(
      'Database transaction failed after git commit — orphaned commit requires manual cleanup',
      {
        commitSha: commitResult.sha,
        branch: commitResult.branch,
        orgId,
        repoOwner: org.skillsRepoOwner,
        repoName: org.skillsRepoName,
        targetPath,
        packageName,
        error: error instanceof Error ? error.message : String(error),
      }
    )
    throw error
  }
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class ImportError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message)
    this.name = 'ImportError'
  }
}
