import { createLogger } from '@agentver/shared'
import type {
  CommitEntry,
  DraftEntry,
  GitProvider,
  SkillFile,
  SkillFileEntry,
  VersionEntry,
} from '../types'
import { GitFeatureNotAvailable } from '../types'

const logger = createLogger('git:filesystem')

// ---------------------------------------------------------------------------
// FilesystemGitProvider
//
// Minimal provider for self-hosted deployments without a Forgejo instance.
// Skill content is stored in the database (Package.readme / PackageVersion)
// rather than a git server. Branch-based features (drafts, suggestions) are
// not available — they throw GitFeatureNotAvailable.
// ---------------------------------------------------------------------------

export class FilesystemGitProvider implements GitProvider {
  // -------------------------------------------------------------------------
  // Namespace management — no-op (orgs exist in the database)
  // -------------------------------------------------------------------------

  async createNamespace(slug: string, _displayName: string): Promise<void> {
    logger.info('Filesystem provider: createNamespace is a no-op', { slug })
  }

  async deleteNamespace(slug: string): Promise<void> {
    logger.info('Filesystem provider: deleteNamespace is a no-op', { slug })
  }

  // -------------------------------------------------------------------------
  // Skill operations — delegate to Package model
  // -------------------------------------------------------------------------

  async createSkill(
    namespace: string,
    skillName: string,
    files: SkillFile[],
    _message?: string
  ): Promise<{ commitSha: string }> {
    const { prisma } = await import('@agentver/database')

    const mainFile = files.find((f) => f.path === 'SKILL.md')
    const content = mainFile?.content ?? files[0]?.content ?? ''

    await prisma.package.updateMany({
      where: {
        name: skillName,
        organisation: { slug: namespace },
      },
      data: {
        readme: content,
      },
    })

    const sha = generateSha(content)
    logger.info('Skill created (filesystem)', { namespace, skillName, fileCount: files.length })
    return { commitSha: sha }
  }

  async updateSkillFile(
    namespace: string,
    skillName: string,
    _filePath: string,
    content: string,
    _message: string
  ): Promise<{ commitSha: string }> {
    const { prisma } = await import('@agentver/database')

    await prisma.package.updateMany({
      where: {
        name: skillName,
        organisation: { slug: namespace },
      },
      data: {
        readme: content,
      },
    })

    const sha = generateSha(content)
    logger.info('Skill file updated (filesystem)', { namespace, skillName })
    return { commitSha: sha }
  }

  async getSkillFile(
    namespace: string,
    skillName: string,
    _filePath: string,
    _ref?: string
  ): Promise<string | null> {
    const { prisma } = await import('@agentver/database')

    const pkg = await prisma.package.findFirst({
      where: {
        name: skillName,
        organisation: { slug: namespace },
      },
      select: { readme: true },
    })

    return pkg?.readme ?? null
  }

  async listSkillFiles(
    namespace: string,
    skillName: string,
    _ref?: string
  ): Promise<SkillFileEntry[]> {
    const { prisma } = await import('@agentver/database')

    const pkg = await prisma.package.findFirst({
      where: {
        name: skillName,
        organisation: { slug: namespace },
      },
      select: { readme: true },
    })

    if (!pkg?.readme) return []

    return [
      {
        name: 'SKILL.md',
        path: 'SKILL.md',
        sha: generateSha(pkg.readme),
        size: Buffer.byteLength(pkg.readme, 'utf-8'),
        type: 'file',
      },
    ]
  }

  async deleteSkill(namespace: string, skillName: string, _message: string): Promise<void> {
    logger.info('Skill deletion (filesystem) — handled by Package model cascade', {
      namespace,
      skillName,
    })
  }

  // -------------------------------------------------------------------------
  // Version control — limited without a git backend
  // -------------------------------------------------------------------------

  async getHistory(
    _namespace: string,
    _skillName: string,
    _options?: { limit?: number; ref?: string }
  ): Promise<CommitEntry[]> {
    return []
  }

  async createDraft(_namespace: string, _skillName: string, _draftName: string): Promise<void> {
    throw new GitFeatureNotAvailable('createDraft')
  }

  async listDrafts(_namespace: string): Promise<DraftEntry[]> {
    return []
  }

  async mergeDraft(
    _namespace: string,
    _draftName: string,
    _message: string
  ): Promise<{ commitSha: string }> {
    throw new GitFeatureNotAvailable('mergeDraft')
  }

  async deleteDraft(_namespace: string, _draftName: string): Promise<void> {
    // No-op — nothing to clean up without branches
  }

  async createVersion(
    _namespace: string,
    _skillName: string,
    _version: string,
    _message: string,
    _commitSha: string
  ): Promise<void> {
    // Versions are tracked via PackageVersion records in the database.
    // No git tag to create without a git backend.
    logger.info('Version creation (filesystem) — tracked via PackageVersion only')
  }

  async listVersions(_namespace: string): Promise<VersionEntry[]> {
    // Versions are queried directly from PackageVersion, not from git tags
    return []
  }

  // -------------------------------------------------------------------------
  // Suggestions — not available without a git backend
  // -------------------------------------------------------------------------

  async createSuggestionBranch(
    _namespace: string,
    _proposalId: string
  ): Promise<{ branchName: string; baseSha: string }> {
    throw new GitFeatureNotAvailable('createSuggestionBranch')
  }

  async commitFilesToBranch(
    _namespace: string,
    _branchName: string,
    _files: SkillFile[],
    _message: string
  ): Promise<{ commitSha: string }> {
    throw new GitFeatureNotAvailable('commitFilesToBranch')
  }

  async deleteSuggestionBranch(_namespace: string, _proposalId: string): Promise<void> {
    // No-op — nothing to clean up
  }

  // -------------------------------------------------------------------------
  // Utility
  // -------------------------------------------------------------------------

  async getHeadSha(_namespace: string): Promise<string> {
    return 'HEAD'
  }

  async getDiff(_namespace: string, _base: string, _head: string): Promise<string> {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateSha(content: string): string {
  const { createHash } = require('node:crypto') as typeof import('node:crypto')
  return createHash('sha1').update(content).digest('hex')
}
