export type { GitProvider } from './types'
export {
  type CommitEntry,
  type DraftEntry,
  GitFeatureNotAvailable,
  GitProviderConfigError,
  type SkillFile,
  type SkillFileEntry,
  type VersionEntry,
} from './types'

// ---------------------------------------------------------------------------
// Singleton accessor
// ---------------------------------------------------------------------------

import type { GitProvider } from './types'

let cachedProvider: GitProvider | null = null

export function getGitProvider(): GitProvider {
  if (cachedProvider) return cachedProvider

  const forgejoUrl = process.env.FORGEJO_API_URL ?? process.env.FORGEJO_URL ?? ''
  const forgejoToken = process.env.FORGEJO_API_TOKEN ?? process.env.FORGEJO_TOKEN ?? ''

  if (forgejoUrl && forgejoToken) {
    const { ForgejoGitProvider } = require('./providers/forgejo') as {
      ForgejoGitProvider: new (url: string, token: string) => GitProvider
    }
    cachedProvider = new ForgejoGitProvider(forgejoUrl, forgejoToken)
  } else {
    const { FilesystemGitProvider } = require('./providers/filesystem') as {
      FilesystemGitProvider: new () => GitProvider
    }
    cachedProvider = new FilesystemGitProvider()
  }

  return cachedProvider
}
