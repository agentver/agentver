export {
  cacheFiles,
  getCacheDir,
  getCachedFiles,
} from './cache.js'
export { fetchFiles } from './fetcher.js'
export type { GitRepoCache, LocalGitContext } from './local-context.js'
export {
  createGitRepoCache,
  normaliseRemoteUrl,
  resolveLocalGitContext,
} from './local-context.js'
export { parseGitSource, resolveRef } from './resolver.js'
export type {
  FetchedFile,
  FetchResult,
  FetchStrategy,
  GitHost,
  GitSource,
  ResolvedRef,
} from './types.js'
