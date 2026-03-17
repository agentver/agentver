// ---------------------------------------------------------------------------
// GitProvider interface — abstracts git storage behind a common API.
// Implementations: ForgejoGitProvider (cloud), FilesystemGitProvider (self-hosted)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type SkillFile = {
  path: string
  content: string
}

export type SkillFileEntry = {
  name: string
  path: string
  sha: string
  size: number
  type: 'file' | 'dir' | 'symlink'
}

export type CommitEntry = {
  sha: string
  message: string
  author: { name: string; email: string; date: string }
  createdAt: string
}

export type DraftEntry = {
  name: string
  branchName: string
  latestCommitId: string
  latestMessage: string
}

export type VersionEntry = {
  name: string
  tag: string
  commitSha: string
  message: string
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class GitProviderConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitProviderConfigError'
  }
}

export class GitFeatureNotAvailable extends Error {
  constructor(feature: string) {
    super(
      `The "${feature}" feature requires a full git backend (e.g. Forgejo). ` +
        'It is not available with filesystem-only storage.'
    )
    this.name = 'GitFeatureNotAvailable'
  }
}

// ---------------------------------------------------------------------------
// GitProvider interface
// ---------------------------------------------------------------------------

export type GitProvider = {
  // Namespace management
  createNamespace(slug: string, displayName: string): Promise<void>
  deleteNamespace(slug: string): Promise<void>

  // Skill operations
  createSkill(
    namespace: string,
    skillName: string,
    files: SkillFile[],
    message?: string
  ): Promise<{ commitSha: string }>

  updateSkillFile(
    namespace: string,
    skillName: string,
    filePath: string,
    content: string,
    message: string
  ): Promise<{ commitSha: string }>

  getSkillFile(
    namespace: string,
    skillName: string,
    filePath: string,
    ref?: string
  ): Promise<string | null>

  listSkillFiles(namespace: string, skillName: string, ref?: string): Promise<SkillFileEntry[]>

  deleteSkill(namespace: string, skillName: string, message: string): Promise<void>

  // Version control
  getHistory(
    namespace: string,
    skillName: string,
    options?: { limit?: number; ref?: string }
  ): Promise<CommitEntry[]>

  createDraft(namespace: string, skillName: string, draftName: string): Promise<void>
  listDrafts(namespace: string): Promise<DraftEntry[]>
  mergeDraft(namespace: string, draftName: string, message: string): Promise<{ commitSha: string }>
  deleteDraft(namespace: string, draftName: string): Promise<void>

  createVersion(
    namespace: string,
    skillName: string,
    version: string,
    message: string,
    commitSha: string
  ): Promise<void>
  listVersions(namespace: string): Promise<VersionEntry[]>

  // Suggestions (proposals)
  createSuggestionBranch(
    namespace: string,
    proposalId: string
  ): Promise<{ branchName: string; baseSha: string }>

  commitFilesToBranch(
    namespace: string,
    branchName: string,
    files: SkillFile[],
    message: string
  ): Promise<{ commitSha: string }>

  deleteSuggestionBranch(namespace: string, proposalId: string): Promise<void>

  // Utility
  getHeadSha(namespace: string): Promise<string>
  getDiff(namespace: string, base: string, head: string): Promise<string>
}
